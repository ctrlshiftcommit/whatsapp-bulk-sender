const dns = require("dns").promises;

class CampaignScheduler {
  constructor({ database, sender, onProgress }) {
    this.database = database;
    this.sender = sender;
    this.onProgress = onProgress;
    this.running = new Map();
    this.poller = null;
  }

  beginPolling(interval = 30000) {
    if (this.poller) return;
    const check = () => this.database.scheduledCampaignsDue().forEach((campaign) => this.start(campaign.id, JSON.parse(campaign.settings_json || "{}")));
    check();
    this.poller = setInterval(check, interval);
  }

  stopPolling() {
    if (this.poller) clearInterval(this.poller);
    this.poller = null;
  }

  start(campaignId, settings = {}) {
    if (this.running.has(campaignId)) return;
    const state = { paused: false, stopped: false };
    this.running.set(campaignId, state);
    this.database.updateCampaignStatus(campaignId, "Running");
    this.process(campaignId, state, settings).catch((error) => {
      this.database.updateCampaignStatus(campaignId, "Failed");
      this.onProgress({ campaignId, status: "Failed", error: error.message });
    });
  }

  pause(campaignId) {
    const state = this.running.get(campaignId);
    if (state) state.paused = true;
    this.database.updateCampaignStatus(campaignId, "Paused");
  }

  stop(campaignId) {
    const state = this.running.get(campaignId);
    if (state) state.stopped = true;
    this.running.delete(campaignId);
    this.database.updateCampaignStatus(campaignId, "Stopped");
  }

  async process(campaignId, state, settings) {
    const campaign = this.database.getCampaign(campaignId);
    const recipients = this.database.getCampaignRecipients(campaignId);
    const maxSession = Math.min(Number(settings.maxSession || 500), 500);
    const minDelay = Math.max(Number(settings.minDelay || 8), 5) * 1000;
    const maxDelay = Math.max(Number(settings.maxDelay || 15), minDelay / 1000) * 1000;
    const batchSize = Math.max(Number(settings.batch || 40), 1);
    const batchPause = Math.max(Number(settings.pause || 5), 1) * 60 * 1000;
    const retries = Math.min(Math.max(Number(settings.retries || 1), 0), 3);
    let sent = 0;
    for (const contact of recipients.slice(0, maxSession)) {
      while (state.paused && !state.stopped) await wait(1000);
      if (state.stopped) break;
      if (!(await isOnline())) {
        state.paused = true;
        this.database.updateCampaignStatus(campaignId, "Paused");
        this.onProgress({ campaignId, status: "Paused", error: "Internet connection unavailable. Campaign paused automatically." });
        continue;
      }
      try {
        const message = renderMessage(pickMessage(settings.variations, settings.message || campaign.template_body || ""), contact);
        await retry(() => this.sender(contact, { ...settings, message }), retries);
        this.database.logCampaignContact(campaignId, contact.id, "sent");
        sent += 1;
        this.onProgress({ campaignId, contact, sent, total: recipients.length, status: "Running" });
      } catch (error) {
        this.database.logCampaignContact(campaignId, contact.id, "failed", error.message);
      }
      await wait(randomBetween(minDelay, maxDelay));
      if (sent > 0 && sent % batchSize === 0) {
        this.onProgress({ campaignId, sent, total: recipients.length, status: "CoolingDown" });
        await wait(batchPause);
      }
    }
    this.running.delete(campaignId);
    this.database.updateCampaignStatus(campaignId, "Completed");
    this.onProgress({ campaignId, sent, total: recipients.length, status: "Completed" });
    scheduleNextOccurrence(this.database, campaign, settings);
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);
const isOnline = async () => {
  try { await dns.resolve("web.whatsapp.com"); return true; }
  catch { return false; }
};
const pickMessage = (variations, fallback) => {
  const choices = Array.isArray(variations) ? variations.filter(Boolean) : String(variations || "").split("\n---\n").filter(Boolean);
  return choices.length ? choices[Math.floor(Math.random() * choices.length)] : fallback;
};
const renderMessage = (message, contact) => String(message || "").replace(/\{\{(\w+)\}\}/g, (_match, key) => contact[key] || "");
const retry = async (action, count) => {
  let lastError;
  for (let attempt = 0; attempt <= count; attempt += 1) {
    try { return await action(); }
    catch (error) { lastError = error; if (attempt < count) await wait(1500); }
  }
  throw lastError;
};
function scheduleNextOccurrence(database, campaign, settings) {
  if (!settings.recurrence || settings.recurrence === "none") return;
  const next = new Date();
  next.setDate(next.getDate() + (settings.recurrence === "weekly" ? 7 : 1));
  database.rescheduleCampaign(campaign.id, next.toISOString());
}
module.exports = { CampaignScheduler };
