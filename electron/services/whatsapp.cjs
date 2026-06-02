const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer-core");

class WhatsAppSession {
  constructor({ userDataPath, onStatus }) {
    this.userDataDir = path.join(userDataPath, "whatsapp-session");
    this.onStatus = onStatus;
    this.status = { status: "disconnected" };
    this.browser = null;
    this.page = null;
  }

  async connect() {
    if (this.browser) return this.status;
    this.update({ status: "scanning" });
    this.browser = await puppeteer.launch({
      headless: false,
      userDataDir: this.userDataDir,
      executablePath: resolveChromePath(),
      args: ["--no-first-run", "--disable-dev-shm-usage"],
    });
    this.page = await this.browser.newPage();
    await this.page.goto("https://web.whatsapp.com", { waitUntil: "domcontentloaded" });
    this.watch().catch(() => this.update({ status: "disconnected" }));
    return this.status;
  }

  async watch() {
    while (this.page && !this.page.isClosed()) {
      const connected = await this.page.$('[data-testid="chat-list"], #pane-side, [aria-label="Chat list"]');
      if (connected) {
        this.update({ status: "connected", profileName: "WhatsApp account", phone: "Linked device" });
      } else {
        const qr = await this.page.$("canvas");
        const qrDataUrl = qr ? await qr.evaluate((canvas) => canvas.toDataURL()) : null;
        this.update({ status: "scanning", qrDataUrl });
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
  }

  async disconnect() {
    if (this.browser) await this.browser.close();
    this.browser = null;
    this.page = null;
    fs.rmSync(this.userDataDir, { recursive: true, force: true });
    this.update({ status: "disconnected" });
    return this.status;
  }

  async sendMessage(contact, { message, mediaPath, typingSimulation }) {
    if (!this.page || this.status.status !== "connected") throw new Error("WhatsApp is not connected.");
    const phone = contact.phone.replace(/\D/g, "");
    await this.page.goto(`https://web.whatsapp.com/send?phone=${phone}${mediaPath ? "" : `&text=${encodeURIComponent(message || "")}`}`, { waitUntil: "domcontentloaded" });
    if (typingSimulation && message) await wait(Math.min(message.length * 24, 2500));
    if (mediaPath) {
      const input = await this.page.waitForSelector('input[type="file"]', { timeout: 15000 });
      await input.uploadFile(mediaPath);
      if (message) {
        const caption = await this.page.waitForSelector('[contenteditable="true"][data-tab], div[contenteditable="true"]', { timeout: 10000 });
        await caption.type(message);
      }
    }
    const send = await this.page.waitForSelector('[data-testid="send"], button[aria-label="Send"], span[data-icon="send"]', { timeout: 15000 });
    await send.click();
  }

  update(value) {
    this.status = value;
    this.onStatus(value);
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function resolveChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Google Chrome was not found. Install Chrome or set CHROME_PATH.");
  return found;
}

module.exports = { WhatsAppSession };
