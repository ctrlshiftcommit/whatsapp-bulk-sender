const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { WasendDatabase } = require("./services/database.cjs");
const { parseCsv, parseCsvRows, parseWorkbook, parseWorkbookRows, parsePasted, parseGoogleSheet, exportCsv } = require("./services/importer.cjs");
const { CampaignScheduler } = require("./services/scheduler.cjs");
const { WhatsAppSession } = require("./services/whatsapp.cjs");

let mainWindow;
let database;
let whatsapp;
let scheduler;
const appIcon = path.join(__dirname, "../assets/wasend-icon.png");
app.setName("WASend");
app.setAppUserModelId("com.wasend.desktop");

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#f5f7fb",
    icon: appIcon,
    title: "WASend",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
  if (!app.isPackaged) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
}

function registerIpc() {
  const getCampaignSettings = (id) => {
    const campaign = database.getCampaign(id);
    return { ...database.getSettings(), ...JSON.parse(campaign.settings_json || "{}") };
  };
  const assertCampaignReady = (id) => {
    const campaign = database.getCampaign(id);
    if (!campaign) throw new Error("Campaign was not found.");
    const settings = getCampaignSettings(id);
    const message = String(settings.message || campaign.template_body || "").trim();
    const recipients = database.getCampaignRecipients(id);
    if (!message && !settings.mediaPath) throw new Error("Choose a message template or add campaign text before launching.");
    if (!recipients.length) throw new Error("Add at least one non-blacklisted contact before launching.");
    if (campaign.status !== "Scheduled" && whatsapp.status.status !== "connected") throw new Error("Connect WhatsApp Web before launching a campaign.");
    return settings;
  };
  ipcMain.handle("whatsapp:status", () => whatsapp.status);
  ipcMain.handle("whatsapp:connect", () => whatsapp.connect());
  ipcMain.handle("whatsapp:disconnect", () => whatsapp.disconnect());
  ipcMain.handle("settings:get", () => database.getSettings());
  ipcMain.handle("settings:save", (_event, settings) => database.saveSettings(settings));
  ipcMain.handle("contacts:list", () => database.listContacts());
  ipcMain.handle("contacts:add", (_event, contact) => database.addContact(contact));
  ipcMain.handle("contacts:remove", (_event, id) => database.removeContact(id));
  ipcMain.handle("contacts:export", async () => {
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: "wasend-contacts.csv", filters: [{ name: "CSV file", extensions: ["csv"] }] });
    if (result.canceled) return false;
    fs.writeFileSync(result.filePath, exportCsv(database.listContacts()), "utf8");
    return true;
  });
  ipcMain.handle("contacts:import", async (_event, { type, content, defaultCountryCode, mapping, groupId, groupName }) => {
    const group = groupName ? database.createGroup(groupName) : groupId ? { id: groupId } : null;
    const contacts = type === "csv" ? parseCsv(content, defaultCountryCode, mapping) : type === "xlsx" ? await parseWorkbook(Buffer.from(content), defaultCountryCode, mapping) : type === "sheets" ? await parseGoogleSheet(content, defaultCountryCode) : parsePasted(content, defaultCountryCode);
    return contacts.map((contact) => database.addContact({ ...contact, groupId: group?.id }));
  });
  ipcMain.handle("contacts:preview-file", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"], filters: [{ name: "Contact lists", extensions: ["csv", "xlsx"] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = result.filePaths[0];
    const extension = path.extname(source).toLowerCase();
    const content = fs.readFileSync(source);
    const parsed = extension === ".csv" ? parseCsvRows(content.toString("utf8")) : await parseWorkbookRows(content);
    return {
      source,
      extension,
      headers: parsed.headers,
      rows: parsed.rows.slice(0, 5),
      totalRows: parsed.rows.length,
    };
  });
  ipcMain.handle("contacts:import-file", async (_event, { source, extension, defaultCountryCode, mapping, groupId, groupName }) => {
    if (!source) return [];
    const group = groupName ? database.createGroup(groupName) : groupId ? { id: groupId } : null;
    const content = fs.readFileSync(source);
    const contacts = extension === ".csv" ? parseCsv(content.toString("utf8"), defaultCountryCode, mapping) : await parseWorkbook(content, defaultCountryCode, mapping);
    return contacts.map((contact) => database.addContact({ ...contact, groupId: group?.id }));
  });
  ipcMain.handle("groups:list", () => database.listGroups());
  ipcMain.handle("groups:create", (_event, name) => database.createGroup(name));
  ipcMain.handle("templates:list", () => database.listTemplates());
  ipcMain.handle("templates:save", (_event, template) => database.saveTemplate(template));
  ipcMain.handle("templates:remove", (_event, id) => database.removeTemplate(id));
  ipcMain.handle("templates:duplicate", (_event, id) => database.duplicateTemplate(id));
  ipcMain.handle("campaigns:list", () => database.listCampaigns());
  ipcMain.handle("dashboard:summary", (_event, days) => database.getDashboardSummary(days));
  ipcMain.handle("campaigns:create", (_event, campaign) => database.createCampaign(campaign));
  ipcMain.handle("campaigns:start", (_event, id) => scheduler.start(id, assertCampaignReady(id)));
  ipcMain.handle("campaigns:resume", (_event, id) => scheduler.resume(id, assertCampaignReady(id)));
  ipcMain.handle("campaigns:pause", (_event, id) => scheduler.pause(id));
  ipcMain.handle("campaigns:stop", (_event, id) => scheduler.stop(id));
  ipcMain.handle("campaigns:duplicate", (_event, id) => database.duplicateCampaign(id));
  ipcMain.handle("campaigns:remove", (_event, id) => {
    scheduler.stop(id);
    return database.removeCampaign(id);
  });
  ipcMain.handle("campaigns:logs", (_event, id) => database.listCampaignLogs(id));
  const withMediaPreview = (file) => ({ ...file, previewUrl: file.filepath ? pathToFileURL(file.filepath).toString() : "" });
  ipcMain.handle("media:list", () => database.listMedia().map(withMediaPreview));
  ipcMain.handle("media:add", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"], filters: [{ name: "Supported media", extensions: ["jpg", "jpeg", "png", "gif", "webp", "pdf", "docx", "xlsx", "mp4", "mp3"] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = result.filePaths[0];
    const mediaDirectory = path.join(app.getPath("userData"), "wasend-data", "media");
    fs.mkdirSync(mediaDirectory, { recursive: true });
    const destination = path.join(mediaDirectory, `${Date.now()}-${path.basename(source)}`);
    fs.copyFileSync(source, destination);
    database.addMedia({ filename: path.basename(source), filepath: destination, type: path.extname(source).slice(1).toLowerCase() });
    return withMediaPreview(database.listMedia()[0]);
  });
  ipcMain.handle("media:remove", (_event, id) => {
    const file = database.all("SELECT * FROM media_files WHERE id = ?", [id])[0];
    const result = database.removeMedia(id);
    if (file?.filepath) fs.rmSync(file.filepath, { force: true });
    return result;
  });
  ipcMain.handle("blacklist:list", () => database.listBlacklist());
  ipcMain.handle("blacklist:add", (_event, phone, reason) => database.addBlacklist(phone, reason));
  ipcMain.handle("blacklist:remove", (_event, id) => database.removeBlacklist(id));
  ipcMain.handle("reports:csv", async (_event, campaignId) => {
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: `campaign-${campaignId || "all"}-report.csv`, filters: [{ name: "CSV file", extensions: ["csv"] }] });
    if (result.canceled) return false;
    const rows = campaignId ? database.listCampaignLogs(campaignId) : database.all("SELECT campaign_logs.*, contacts.name, contacts.phone FROM campaign_logs JOIN contacts ON contacts.id = campaign_logs.contact_id ORDER BY campaign_logs.id DESC");
    fs.writeFileSync(result.filePath, exportCsv(rows.map((row) => ({ name: row.name, phone: row.phone, tags: [row.status], custom1: row.error_msg || "", custom2: row.sent_at || "" }))), "utf8");
    return true;
  });
  ipcMain.handle("reports:pdf", async () => {
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: "wasend-report.pdf", filters: [{ name: "PDF file", extensions: ["pdf"] }] });
    if (result.canceled) return false;
    fs.writeFileSync(result.filePath, await mainWindow.webContents.printToPDF({ printBackground: true }));
    return true;
  });
  ipcMain.handle("app:reset", () => database.clearAllData());
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  database = new WasendDatabase(app.getPath("userData"));
  whatsapp = new WhatsAppSession({
    userDataPath: app.getPath("userData"),
    onStatus: (status) => mainWindow?.webContents.send("whatsapp:status", status),
  });
  scheduler = new CampaignScheduler({
    database,
    sender: (contact, settings) => whatsapp.sendMessage(contact, settings),
    canSend: () => whatsapp.status.status === "connected",
    onProgress: (progress) => mainWindow?.webContents.send("campaign:progress", progress),
  });
  scheduler.beginPolling();
  registerIpc();
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
