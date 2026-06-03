const path = require("path");
const fs = require("fs");
const packagedBrowserCache = path.join(process.resourcesPath || path.join(__dirname, "../.."), "puppeteer-cache");
const developmentBrowserCache = path.join(__dirname, "../../puppeteer-cache");
process.env.PUPPETEER_CACHE_DIR ||= fs.existsSync(packagedBrowserCache) ? packagedBrowserCache : developmentBrowserCache;
const puppeteer = require("puppeteer");

class WhatsAppSession {
  constructor({ userDataPath, onStatus }) {
    this.userDataDir = path.join(userDataPath, "whatsapp-session");
    this.onStatus = onStatus;
    this.status = { status: "disconnected" };
    this.browser = null;
    this.page = null;
  }

  async connect() {
    if (this.browser) {
      if (this.page && !this.page.isClosed()) await this.page.bringToFront();
      return this.status;
    }
    this.update({ status: "opening-browser" });
    try {
      this.browser = await this.attachExistingBrowser().catch(() => null);
      if (!this.browser) {
        try {
          this.browser = await puppeteer.launch({
            headless: false,
            userDataDir: this.userDataDir,
            defaultViewport: null,
            args: [
              "--no-sandbox",
              "--disable-setuid-sandbox",
              "--disable-infobars",
              "--window-size=1280,800",
              "--window-position=100,100",
            ],
            ignoreDefaultArgs: ["--enable-automation"],
          });
        } catch (error) {
          this.browser = await this.attachExistingBrowser(10).catch(() => null);
          if (!this.browser) throw error;
        }
      }
      await this.preparePage();
      this.update({ status: "waiting-for-scan" });
      this.watch().catch((error) => this.update({ status: "disconnected", error: error.message }));
      return this.status;
    } catch (error) {
      this.browser = null;
      this.page = null;
      this.update({ status: "disconnected", error: `Could not open the bundled Chromium browser: ${error.message}` });
      throw error;
    }
  }

  async attachExistingBrowser(retries = 3) {
    const endpointFile = path.join(this.userDataDir, "DevToolsActivePort");
    for (let attempt = 0; attempt < retries; attempt += 1) {
      if (fs.existsSync(endpointFile)) {
        const [port, browserPath] = fs.readFileSync(endpointFile, "utf8").trim().split(/\r?\n/);
        if (port && browserPath) {
          try {
            return await puppeteer.connect({
              browserWSEndpoint: `ws://127.0.0.1:${port}${browserPath}`,
              defaultViewport: null,
            });
          } catch {
            // The existing browser may still be starting; retry below.
          }
        }
      }
      await wait(250);
    }
    return null;
  }

  async preparePage() {
    this.browser.on("disconnected", () => {
      this.browser = null;
      this.page = null;
      this.update({ status: "disconnected" });
    });
    const pages = await this.browser.pages();
    this.page = pages.find((page) => page.url().includes("web.whatsapp.com")) || pages[0] || await this.browser.newPage();
    await this.page.bringToFront();
    if (!this.page.url().includes("web.whatsapp.com")) {
      try {
        await this.page.goto("https://web.whatsapp.com", { waitUntil: "domcontentloaded" });
      } catch (error) {
        const freshPages = await this.browser.pages();
        this.page = freshPages.find((page) => page.url().includes("web.whatsapp.com")) || await this.browser.newPage();
        await this.page.bringToFront();
        if (!this.page.url().includes("web.whatsapp.com")) {
          await this.page.goto("https://web.whatsapp.com", { waitUntil: "domcontentloaded" });
        }
      }
    }
    await this.useHereIfNeeded();
  }

  async useHereIfNeeded() {
    try {
      const button = await this.page.evaluateHandle(() => {
        return [...document.querySelectorAll("button")].find((element) => /use here/i.test(element.textContent || ""));
      });
      const element = button.asElement();
      if (element) {
        await element.click();
        await wait(2500);
      }
      await button.dispose();
    } catch {
      // WhatsApp only shows this when the account is active in another Web window.
    }
  }

  async watch() {
    while (this.page && !this.page.isClosed()) {
      try {
        await this.useHereIfNeeded();
        const connected = await this.page.$('[data-testid="chat-list"], #pane-side, [aria-label="Chat list"], [data-testid="default-user"], [data-testid="intro-title"]');
        this.update({ status: connected ? "connected" : "waiting-for-scan" });
      } catch (error) {
        this.update({ status: "disconnected", error: `WhatsApp Web status check failed: ${error.message}` });
      }
      await wait(2500);
    }
  }

  async disconnect() {
    if (this.browser) await this.browser.close();
    this.browser = null;
    this.page = null;
    fs.rmSync(this.userDataDir, { recursive: true, force: true });
    if (this.status.status !== "disconnected") this.update({ status: "disconnected" });
    return this.status;
  }

  async sendMessage(contact, { message, mediaPath, typingSimulation }) {
    if (!this.page || this.status.status !== "connected") throw new Error("WhatsApp is not connected.");
    const phone = String(contact.phone || "").replace(/\D/g, "");
    if (!phone) throw new Error("The contact does not have a valid phone number.");
    try {
      await this.useHereIfNeeded();
      await this.page.goto(`https://web.whatsapp.com/send?phone=${phone}&text=&app_absent=0`, { waitUntil: "domcontentloaded" });
      await this.useHereIfNeeded();
      await this.page.waitForFunction(() => {
        const input = document.querySelector('[data-testid="conversation-compose-box-input"], div[contenteditable="true"][data-tab="10"], footer div[contenteditable="true"]');
        const invalidDialog = [...document.querySelectorAll('[data-testid="popup-contents"], div[role="dialog"]')]
          .some((element) => /invalid|not on whatsapp|phone number shared via url/i.test(element.textContent || ""));
        return input || invalidDialog;
      }, { timeout: 20000 });
      const invalidText = await this.invalidNumberDialogText();
      if (invalidText) throw new Error(`Number +${phone} is not available on WhatsApp. ${invalidText}`);
      if (typingSimulation && message) await wait(randomDelay(1000, 3000));
      if (mediaPath) {
        await this.attachMedia(mediaPath, message || "");
        return;
      }
      const input = await this.page.waitForSelector('[data-testid="conversation-compose-box-input"], div[contenteditable="true"][data-tab="10"], footer div[contenteditable="true"]', { timeout: 10000 });
      await input.click();
      await typeMultiline(this.page, input, message || "");
      await this.clickSend();
      await wait(500);
    } catch (error) {
      throw new Error(`Could not send to +${phone}: ${error.message}`);
    }
  }

  async attachMedia(mediaPath, caption) {
    const clip = await this.page.$('[data-testid="attach-menu-plus"], [data-testid="clip"], span[data-icon="attach-menu-plus"]');
    if (!clip) throw new Error("WhatsApp attachment button was not found.");
    await clip.click();
    await wait(500);
    const input = await this.page.waitForSelector('input[type="file"]', { timeout: 10000 });
    await input.uploadFile(mediaPath);
    await wait(1500);
    if (caption) {
      const captionInput = await this.page.$('[data-testid="media-caption-input-container"] div[contenteditable], div[contenteditable="true"][data-tab="7"]');
      if (captionInput) await typeMultiline(this.page, captionInput, caption);
    }
    await this.clickSend();
    await wait(1000);
  }

  async invalidNumberDialogText() {
    return this.page.evaluate(() => {
      const dialog = [...document.querySelectorAll('[data-testid="popup-contents"], div[role="dialog"]')]
        .find((element) => /invalid|not on whatsapp|phone number shared via url/i.test(element.textContent || ""));
      return dialog ? dialog.textContent.trim().replace(/\s+/g, " ") : "";
    });
  }

  async clickSend() {
    const send = await this.page.$('[data-testid="send"], [data-testid="compose-btn-send"], button[aria-label="Send"], span[data-icon="send"]');
    if (send) await send.click();
    else await this.page.keyboard.press("Enter");
  }

  update(value) {
    this.status = value;
    this.onStatus(value);
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
async function typeMultiline(page, input, message) {
  const lines = String(message).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    await input.type(lines[index], { delay: 15 });
    if (index < lines.length - 1) {
      await page.keyboard.down("Shift");
      await page.keyboard.press("Enter");
      await page.keyboard.up("Shift");
    }
  }
}

module.exports = { WhatsAppSession };
