const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

class WasendDatabase {
  constructor(userDataPath) {
    const directory = path.join(userDataPath, "wasend-data");
    fs.mkdirSync(directory, { recursive: true });
    this.db = new Database(path.join(directory, "wasend.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL UNIQUE,
        tags TEXT NOT NULL DEFAULT '[]',
        custom1 TEXT NOT NULL DEFAULT '',
        custom2 TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS contact_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS contact_group_members (
        group_id INTEGER NOT NULL REFERENCES contact_groups(id) ON DELETE CASCADE,
        contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        PRIMARY KEY(group_id, contact_id)
      );
      CREATE TABLE IF NOT EXISTS templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'General',
        body TEXT NOT NULL,
        variables TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS media_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Draft',
        template_id INTEGER REFERENCES templates(id),
        group_id INTEGER REFERENCES contact_groups(id),
        settings_json TEXT NOT NULL DEFAULT '{}',
        scheduled_at TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS campaign_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        error_msg TEXT,
        sent_at TEXT
      );
      CREATE TABLE IF NOT EXISTS blacklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT NOT NULL UNIQUE,
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.ensureColumn("campaigns", "total_contacts", "INTEGER NOT NULL DEFAULT 0");
  }

  ensureColumn(table, column, definition) {
    const exists = this.all(`PRAGMA table_info(${table})`).some((item) => item.name === column);
    if (!exists) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  close() {
    this.db.close();
  }

  all(sql, params = []) {
    try { return this.db.prepare(sql).all(...params); }
    catch (error) { throw new Error(`Database read failed: ${error.message}`); }
  }

  run(sql, params = []) {
    try { return this.db.prepare(sql).run(...params); }
    catch (error) { throw new Error(`Database write failed: ${error.message}`); }
  }

  listContacts() {
    return this.all(`
      SELECT contacts.*,
        COALESCE(json_group_array(json_object('id', contact_groups.id, 'name', contact_groups.name)) FILTER (WHERE contact_groups.id IS NOT NULL), '[]') AS groups_json
      FROM contacts
      LEFT JOIN contact_group_members ON contact_group_members.contact_id = contacts.id
      LEFT JOIN contact_groups ON contact_groups.id = contact_group_members.group_id
      GROUP BY contacts.id
      ORDER BY contacts.created_at DESC
    `).map((row) => ({ ...row, tags: JSON.parse(row.tags || "[]"), groups: JSON.parse(row.groups_json || "[]") }));
  }

  addContact(contact) {
    const phone = normalizePhone(contact.phone);
    if (!phone) throw new Error("Enter a valid phone number with country code.");
    const result = this.run(
      "INSERT INTO contacts(name, phone, tags, custom1, custom2) VALUES (?, ?, ?, ?, ?) ON CONFLICT(phone) DO UPDATE SET name=excluded.name, tags=excluded.tags, custom1=excluded.custom1, custom2=excluded.custom2",
      [contact.name || "", phone, JSON.stringify(contact.tags || []), contact.custom1 || "", contact.custom2 || ""],
    );
    const saved = this.db.prepare("SELECT * FROM contacts WHERE phone = ?").get(phone);
    const groupId = contact.groupId || contact.group_id;
    if (groupId) this.addContactToGroup(groupId, saved.id);
    return { ...saved, tags: JSON.parse(saved.tags || "[]"), phone };
  }

  removeContact(id) {
    return this.run("DELETE FROM contacts WHERE id = ?", [id]);
  }

  removeDuplicateContacts() {
    return this.run("DELETE FROM contacts WHERE id NOT IN (SELECT MIN(id) FROM contacts GROUP BY phone)");
  }

  listGroups() {
    return this.all(`
      SELECT contact_groups.*, COUNT(contact_group_members.contact_id) AS contacts
      FROM contact_groups
      LEFT JOIN contact_group_members ON contact_group_members.group_id = contact_groups.id
      GROUP BY contact_groups.id
      ORDER BY name
    `);
  }
  createGroup(name) {
    const cleaned = String(name || "").trim();
    if (!cleaned) throw new Error("Enter a group name.");
    this.run("INSERT OR IGNORE INTO contact_groups(name) VALUES (?)", [cleaned]);
    return this.db.prepare("SELECT * FROM contact_groups WHERE name = ?").get(cleaned);
  }
  addContactToGroup(groupId, contactId) { return this.run("INSERT OR IGNORE INTO contact_group_members(group_id, contact_id) VALUES (?, ?)", [groupId, contactId]); }

  listTemplates() { return this.all("SELECT * FROM templates ORDER BY created_at DESC"); }
  saveTemplate(template) {
    const name = String(template.name || "").trim();
    const body = String(template.body || "").trim();
    if (!name) throw new Error("Enter a template name.");
    if (!body) throw new Error("Enter a message body.");
    const variables = [...body.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]);
    const params = [name, template.category || "General", body, JSON.stringify(variables)];
    if (template.id) {
      const id = Number(template.id);
      this.run("UPDATE templates SET name = ?, category = ?, body = ?, variables = ? WHERE id = ?", [...params, id]);
      return this.db.prepare("SELECT * FROM templates WHERE id = ?").get(id);
    }
    const result = this.run("INSERT INTO templates(name, category, body, variables) VALUES (?, ?, ?, ?)", params);
    return this.db.prepare("SELECT * FROM templates WHERE id = ?").get(Number(result.lastInsertRowid));
  }
  removeTemplate(id) { return this.run("DELETE FROM templates WHERE id = ?", [id]); }
  duplicateTemplate(id) {
    const result = this.run("INSERT INTO templates(name, category, body, variables) SELECT name || ' copy', category, body, variables FROM templates WHERE id = ?", [id]);
    return this.db.prepare("SELECT * FROM templates WHERE id = ?").get(Number(result.lastInsertRowid));
  }

  listCampaigns() {
    return this.all(`
      SELECT campaigns.*,
        COUNT(campaign_logs.id) AS processed,
        SUM(CASE WHEN campaign_logs.status = 'sent' THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN campaign_logs.status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM campaigns
      LEFT JOIN campaign_logs ON campaign_logs.campaign_id = campaigns.id
      GROUP BY campaigns.id
      ORDER BY campaigns.created_at DESC
    `).map((campaign) => {
      const sent = Number(campaign.sent || 0);
      const failed = Number(campaign.failed || 0);
      const total = Number(campaign.total_contacts || 0);
      return {
        ...campaign,
        total,
        sent,
        failed,
        pending: Math.max(total - sent - failed, 0),
        progress: total ? Math.round(((sent + failed) / total) * 100) : 0,
        date: campaign.scheduled_at || campaign.started_at || campaign.created_at,
      };
    });
  }
  getCampaign(id) { return this.db.prepare("SELECT campaigns.*, templates.body AS template_body FROM campaigns LEFT JOIN templates ON templates.id = campaigns.template_id WHERE campaigns.id = ?").get(id); }
  createCampaign(campaign) {
    const templateId = coerceExistingId(this.db, "templates", campaign.templateId, "Choose a valid message template.");
    const groupId = campaign.groupId ? coerceExistingId(this.db, "contact_groups", campaign.groupId, "Choose a valid contact group.") : null;
    const result = this.run("INSERT INTO campaigns(name, status, template_id, group_id, settings_json, scheduled_at, total_contacts) VALUES (?, ?, ?, ?, ?, ?, ?)", [campaign.name, campaign.status || "Draft", templateId, groupId, JSON.stringify(campaign.settings || {}), campaign.scheduledAt || null, Number(campaign.total || 0)]);
    return { id: Number(result.lastInsertRowid), ...campaign };
  }
  duplicateCampaign(id) {
    const result = this.run(`
      INSERT INTO campaigns(name, status, template_id, group_id, settings_json, scheduled_at, total_contacts)
      SELECT name || ' copy', 'Draft', template_id, group_id, settings_json, NULL, total_contacts
      FROM campaigns WHERE id = ?
    `, [id]);
    return this.getCampaign(Number(result.lastInsertRowid));
  }
  removeCampaign(id) { return this.run("DELETE FROM campaigns WHERE id = ?", [id]); }

  updateCampaignStatus(id, status) {
    this.run("UPDATE campaigns SET status = ?, started_at = CASE WHEN ? = 'Running' THEN COALESCE(started_at, CURRENT_TIMESTAMP) ELSE started_at END, completed_at = CASE WHEN ? = 'Completed' THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE id = ?", [status, status, status, id]);
    return { id, status };
  }

  rescheduleCampaign(id, scheduledAt) {
    return this.run("UPDATE campaigns SET status = 'Scheduled', scheduled_at = ?, started_at = NULL, completed_at = NULL WHERE id = ?", [scheduledAt, id]);
  }

  listCampaignLogs(campaignId) {
    return this.all("SELECT campaign_logs.*, contacts.name, contacts.phone FROM campaign_logs JOIN contacts ON contacts.id = campaign_logs.contact_id WHERE campaign_id = ? ORDER BY campaign_logs.id DESC", [campaignId]);
  }

  getCampaignDeliveryStats(campaignId) {
    const row = this.db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        COUNT(*) AS processed
      FROM campaign_logs
      WHERE campaign_id = ?
    `).get(campaignId);
    return {
      sent: Number(row?.sent || 0),
      failed: Number(row?.failed || 0),
      processed: Number(row?.processed || 0),
    };
  }

  getDashboardSummary(days = 7) {
    const range = Math.min(Math.max(Number(days || 7), 1), 90);
    const contacts = this.db.prepare("SELECT COUNT(*) AS count FROM contacts").get().count;
    const logs = this.db.prepare("SELECT SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed FROM campaign_logs").get();
    const active = this.db.prepare("SELECT COUNT(*) AS count FROM campaigns WHERE status IN ('Running', 'Paused', 'Scheduled')").get().count;
    const timeline = this.all(`
      SELECT date(sent_at) AS day, COUNT(*) AS sent
      FROM campaign_logs
      WHERE status = 'sent' AND sent_at >= date('now', ?)
      GROUP BY date(sent_at)
      ORDER BY day
    `, [`-${range - 1} days`]);
    const sent = Number(logs.sent || 0);
    const failed = Number(logs.failed || 0);
    return { contacts: Number(contacts), activeCampaigns: Number(active), sent, failed, successRate: sent + failed ? Math.round((sent / (sent + failed)) * 1000) / 10 : 0, timeline, range };
  }

  listMedia() { return this.all("SELECT * FROM media_files ORDER BY created_at DESC"); }
  addMedia(file) { return this.run("INSERT INTO media_files(filename, filepath, type) VALUES (?, ?, ?)", [file.filename, file.filepath, file.type]); }
  removeMedia(id) { return this.run("DELETE FROM media_files WHERE id = ?", [id]); }

  listBlacklist() { return this.all("SELECT * FROM blacklist ORDER BY created_at DESC"); }
  addBlacklist(phone, reason = "") {
    const normalized = normalizePhone(phone);
    if (!normalized) throw new Error("Enter a valid phone number with country code.");
    return this.run("INSERT INTO blacklist(phone, reason) VALUES (?, ?) ON CONFLICT(phone) DO UPDATE SET reason=excluded.reason", [normalized, reason]);
  }
  removeBlacklist(id) { return this.run("DELETE FROM blacklist WHERE id = ?", [id]); }

  clearAllData() {
    this.db.exec("DELETE FROM campaign_logs; DELETE FROM campaigns; DELETE FROM contact_group_members; DELETE FROM contact_groups; DELETE FROM contacts; DELETE FROM templates; DELETE FROM media_files; DELETE FROM blacklist; DELETE FROM app_settings;");
    return true;
  }

  scheduledCampaignsDue(now = new Date().toISOString()) {
    return this.all("SELECT * FROM campaigns WHERE status = 'Scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ? ORDER BY scheduled_at", [now]);
  }

  getSettings() {
    return Object.fromEntries(this.all("SELECT key, value FROM app_settings").map(({ key, value }) => [key, JSON.parse(value)]));
  }

  saveSettings(settings) {
    const save = this.db.prepare("INSERT INTO app_settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    const transaction = this.db.transaction((items) => Object.entries(items).forEach(([key, value]) => save.run(key, JSON.stringify(value))));
    transaction(settings);
    return this.getSettings();
  }

  getCampaignRecipients(campaignId) {
    const campaign = this.getCampaign(campaignId);
    const settings = JSON.parse(campaign?.settings_json || "{}");
    const selectedIds = Array.isArray(settings.selectedContactIds) ? settings.selectedContactIds.map(Number).filter(Boolean) : [];
    const groupId = Number(campaign?.group_id || settings.groupId || 0);
    const filters = [
      "c.phone NOT IN (SELECT phone FROM blacklist)",
      "c.id NOT IN (SELECT contact_id FROM campaign_logs WHERE campaign_id = ? AND status = 'sent')",
    ];
    const params = [campaignId];
    if (selectedIds.length) {
      filters.push(`c.id IN (${selectedIds.map(() => "?").join(",")})`);
      params.push(...selectedIds);
    } else if (groupId) {
      filters.push("c.id IN (SELECT contact_id FROM contact_group_members WHERE group_id = ?)");
      params.push(groupId);
    }
    return this.all(`
      SELECT c.* FROM contacts c
      WHERE ${filters.join("\n      AND ")}
      ORDER BY c.id
    `, params);
  }

  getCampaignRecipientDiagnostics(campaignId) {
    const campaign = this.getCampaign(campaignId);
    if (!campaign) return { totalContacts: 0, targetContacts: 0, alreadySent: 0, blacklisted: 0, eligible: 0 };
    const settings = JSON.parse(campaign.settings_json || "{}");
    const selectedIds = Array.isArray(settings.selectedContactIds) ? settings.selectedContactIds.map(Number).filter(Boolean) : [];
    const groupId = Number(campaign.group_id || settings.groupId || 0);
    const targetFilters = [];
    const targetParams = [];
    if (selectedIds.length) {
      targetFilters.push(`c.id IN (${selectedIds.map(() => "?").join(",")})`);
      targetParams.push(...selectedIds);
    } else if (groupId) {
      targetFilters.push("c.id IN (SELECT contact_id FROM contact_group_members WHERE group_id = ?)");
      targetParams.push(groupId);
    }
    const targetWhere = targetFilters.length ? `WHERE ${targetFilters.join(" AND ")}` : "";
    const targetContacts = this.all(`SELECT c.id, c.phone FROM contacts c ${targetWhere}`, targetParams);
    const targetIds = targetContacts.map((contact) => Number(contact.id));
    const alreadySent = targetIds.length ? this.db.prepare(`
      SELECT COUNT(DISTINCT contact_id) AS count
      FROM campaign_logs
      WHERE campaign_id = ? AND status = 'sent' AND contact_id IN (${targetIds.map(() => "?").join(",")})
    `).get(campaignId, ...targetIds).count : 0;
    const targetPhones = targetContacts.map((contact) => contact.phone).filter(Boolean);
    const blacklisted = targetPhones.length ? this.db.prepare(`
      SELECT COUNT(DISTINCT phone) AS count
      FROM blacklist
      WHERE phone IN (${targetPhones.map(() => "?").join(",")})
    `).get(...targetPhones).count : 0;
    return {
      totalContacts: Number(this.db.prepare("SELECT COUNT(*) AS count FROM contacts").get().count || 0),
      targetContacts: targetContacts.length,
      alreadySent: Number(alreadySent || 0),
      blacklisted: Number(blacklisted || 0),
      eligible: this.getCampaignRecipients(campaignId).length,
      mode: selectedIds.length ? "selected" : groupId ? "group" : "all",
    };
  }

  logCampaignContact(campaignId, contactId, status, error = null) {
    this.run("INSERT INTO campaign_logs(campaign_id, contact_id, status, error_msg, sent_at) VALUES (?, ?, ?, ?, CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE NULL END)", [campaignId, contactId, status, error, status]);
  }
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

function coerceExistingId(db, table, value, message) {
  const id = Number(value || 0);
  if (!Number.isInteger(id) || id <= 0) throw new Error(message);
  const exists = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
  if (!exists) throw new Error(message);
  return id;
}

module.exports = { WasendDatabase, normalizePhone };
