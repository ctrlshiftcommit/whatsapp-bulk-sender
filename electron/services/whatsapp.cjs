const path = require("path");
const fs = require("fs");
const packagedBrowserCache = path.join(process.resourcesPath || path.join(__dirname, "../.."), "puppeteer-cache");
const developmentBrowserCache = path.join(__dirname, "../../puppeteer-cache");
process.env.PUPPETEER_CACHE_DIR ||= fs.existsSync(packagedBrowserCache) ? packagedBrowserCache : developmentBrowserCache;
const puppeteer = require("puppeteer");
const SEND_SELECTOR = '[data-testid="send"], [data-testid="compose-btn-send"], [data-testid="media-editor-send"], button[aria-label="Send"], span[data-icon="send"], span[data-icon="wds-ic-send-filled"]';

class WhatsAppSession {
  constructor({ userDataPath, onStatus }) {
    this.userDataPath = userDataPath;
    this.userDataDir = path.join(userDataPath, "whatsapp-session");
    this.onStatus = onStatus;
    this.status = { status: "disconnected" };
    this.browser = null;
    this.page = null;
    this.connecting = null;
    this.watching = false;
  }

  async connect() {
    if (this.connecting) return this.connecting;
    if (this.browser) {
      await this.preparePage();
      return this.status;
    }
    this.connecting = this.open();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async open() {
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
              "--disable-extensions",
              "--disable-sync",
              "--disable-component-update",
              "--disable-features=Translate,MediaRouter,OptimizationHints,AutofillServerCommunication",
              "--process-per-site",
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
      this.startWatching();
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
    if (this.handleDisconnected) this.browser.off?.("disconnected", this.handleDisconnected);
    this.handleDisconnected = () => {
      this.browser = null;
      this.page = null;
      this.watching = false;
      this.update({ status: "disconnected" });
    };
    this.browser.on("disconnected", this.handleDisconnected);
    const pages = await this.browser.pages();
    this.page = await this.pickSingleWhatsAppPage(pages);
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
    await this.closeExtraPages();
  }

  async pickSingleWhatsAppPage(pages = []) {
    const whatsappPages = pages.filter((page) => page.url().includes("web.whatsapp.com"));
    const usableWhatsApp = [];
    for (const page of whatsappPages) {
      const body = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
      if (!/open in another window/i.test(body)) usableWhatsApp.push(page);
    }
    if (usableWhatsApp[0]) return usableWhatsApp[0];
    if (whatsappPages[0]) return whatsappPages[0];
    const blank = pages.find((page) => page.url() === "about:blank");
    return blank || await this.browser.newPage();
  }

  async closeExtraPages() {
    if (!this.browser || !this.page) return;
    const pages = await this.browser.pages();
    for (const page of pages) {
      if (page === this.page) continue;
      const url = page.url();
      if (url === "about:blank" || url.includes("web.whatsapp.com")) {
        await page.close().catch(() => {});
      }
    }
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

  startWatching() {
    if (this.watching) return;
    this.watching = true;
    this.watch().catch((error) => this.update({ status: "disconnected", error: error.message }));
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
    this.watching = false;
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
    let phone = String(contact.phone || "").replace(/[\s\-()+]/g, "");
    if (phone.startsWith("0")) phone = phone.substring(1);
    if (!phone) throw new Error("The contact does not have a valid phone number.");
    const text = String(message || "");
    if (mediaPath) return this.sendMessageWithMedia({ phone, message: text, mediaPath });
    try {
      await this.useHereIfNeeded();
      const url = `https://web.whatsapp.com/send/?phone=${phone}&text&type=phone_number&app_absent=0`;
      console.log(`Navigating to: ${url}`);
      await this.page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      await this.page.waitForTimeout(3000);
      await this.useHereIfNeeded();

      let inputFound = false;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        inputFound = await this.page.evaluate(() => {
          const selectors = [
            'div[contenteditable="true"][data-tab="10"]',
            'div[contenteditable="true"][data-tab="1"]',
            '[data-testid="conversation-compose-box-input"]',
            'footer div[contenteditable="true"]',
            'div[title="Type a message"]',
            'div[aria-label="Type a message"]',
            'div[aria-placeholder="Type a message"]',
          ];
          return selectors.some((selector) => Boolean(document.querySelector(selector)));
        });
        if (inputFound) break;

        const hasError = await this.page.evaluate(() => {
          return Boolean(document.querySelector('[data-testid="popup-contents"]')) ||
            Boolean(document.querySelector('div[data-animate-modal-body="true"]')) ||
            [...document.querySelectorAll('div[role="dialog"]')].some((element) => /invalid|not on whatsapp|phone number shared via url/i.test(element.textContent || ""));
        });
        if (hasError) {
          await this.page.keyboard.press("Enter");
          await this.page.waitForTimeout(500);
          throw new Error(`Number +${phone} is not registered on WhatsApp.`);
        }

        console.log(`Attempt ${attempt + 1}: input not found yet, waiting...`);
        await this.page.waitForTimeout(1500);
      }

      if (!inputFound) throw new Error(`Could not find message input for +${phone} after 10 attempts.`);

      const invalidText = await this.invalidNumberDialogText();
      if (invalidText) throw new Error(`Number +${phone} is not available on WhatsApp. ${invalidText}`);
      if (typingSimulation && text) await wait(randomDelay(1000, 3000));

      const inputSelector = await this.findComposerSelector();
      console.log(`Using selector: ${inputSelector}`);
      const inputBox = await this.page.$(inputSelector);
      await inputBox.click();
      await this.page.waitForTimeout(500);
      await this.insertComposerText(text);
      await this.page.waitForTimeout(500);
      const beforeSend = await this.captureSendState();
      await this.clickSend();
      await this.waitForSendConfirmation(beforeSend, { media: false });
      console.log(`Message sent to +${phone} successfully`);
    } catch (error) {
      await this.debugScreenshot("send-failed").catch(() => {});
      throw new Error(`Could not send to +${phone}: ${error.message}`);
    }
  }

  async sendMessageWithMedia({ phone, message, mediaPath }) {
    if (!this.page || this.status.status !== "connected") throw new Error("WhatsApp is not connected.");
    if (!fs.existsSync(mediaPath)) throw new Error(`Attachment file was not found: ${mediaPath}`);

    let cleanPhone = String(phone || "").replace(/[\s\-()+]/g, "");
    if (cleanPhone.startsWith("0")) cleanPhone = cleanPhone.substring(1);
    if (!cleanPhone) throw new Error("The contact does not have a valid phone number.");

    try {
      await this.useHereIfNeeded();
      const url = `https://web.whatsapp.com/send/?phone=${cleanPhone}&text&type=phone_number&app_absent=0`;
      console.log(`Navigating to: ${url}`);
      await this.page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      await this.page.waitForTimeout(3000);
      await this.useHereIfNeeded();

      let inputFound = false;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        inputFound = await this.page.evaluate(() => {
          const selectors = [
            'div[contenteditable="true"][data-tab="10"]',
            'div[contenteditable="true"][data-tab="1"]',
            '[data-testid="conversation-compose-box-input"]',
            'footer div[contenteditable="true"]',
            'div[aria-label="Type a message"]',
          ];
          return selectors.some((selector) => Boolean(document.querySelector(selector)));
        });
        if (inputFound) break;
        await this.page.waitForTimeout(1500);
      }
      if (!inputFound) throw new Error(`Chat did not load for +${cleanPhone}`);

      const invalidText = await this.invalidNumberDialogText();
      if (invalidText) throw new Error(`Number +${cleanPhone} is not available on WhatsApp. ${invalidText}`);

      const ext = path.extname(mediaPath).toLowerCase();
      const isImage = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext);
      const isVideo = [".mp4", ".mov", ".avi", ".mkv"].includes(ext);
      const usePhotoOption = isImage || isVideo;

      await this.page.waitForTimeout(500);
      const clipClicked = await this.page.evaluate(() => {
        const selectors = [
          '[data-testid="attach-menu-plus"]',
          '[data-testid="clip"]',
          'span[data-icon="attach-menu-plus"]',
          'span[data-icon="clip"]',
          'div[title="Attach"]',
          'button[aria-label="Attach"]',
        ];
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) {
            const target = element.closest("button,[role='button']") || element;
            target.click();
            return true;
          }
        }
        return false;
      });
      if (!clipClicked) throw new Error("Could not find attach button.");

      await this.page.waitForTimeout(800);
      let fileInputFound = false;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        fileInputFound = await this.page.evaluate((isPhoto) => {
          const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
          console.log("Found file inputs:", inputs.map((input) => input.accept));
          if (isPhoto) return inputs.some((input) => input.accept.includes("image") || input.accept.includes("video"));
          return inputs.some((input) => !input.accept.includes("image") || input.accept === "*" || input.accept === "");
        }, usePhotoOption);
        if (fileInputFound) break;
        await this.page.waitForTimeout(600);
      }

      const allInputs = await this.page.$$('input[type="file"]');
      console.log(`Found ${allInputs.length} file inputs`);
      if (!allInputs.length) throw new Error("No file input found after opening attach menu.");
      const targetInput = await this.pickAttachmentInput(allInputs, usePhotoOption);
      if (!targetInput) throw new Error("Target file input not found.");

      await targetInput.uploadFile(mediaPath);
      console.log(`File uploaded: ${mediaPath}`);
      await this.page.waitForTimeout(2000);

      let previewLoaded = false;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        previewLoaded = await this.page.evaluate(() => {
          return Boolean(document.querySelector('[data-testid="media-editor"]')) ||
            Boolean(document.querySelector('[data-testid="media-caption-input-container"]')) ||
            Boolean(document.querySelector('div[data-testid="photo-editor"]')) ||
            Boolean(document.querySelector('div._2jCH9')) ||
            Boolean(document.querySelector('span[data-icon="send"]'));
        });
        if (previewLoaded) break;
        await this.page.waitForTimeout(800);
      }

      const caption = String(message || "");
      if (caption.trim()) {
        await this.page.waitForTimeout(500);
        const captionTyped = await this.page.evaluate((msg) => {
          const selectors = [
            '[data-testid="media-caption-input-container"] div[contenteditable]',
            'div[contenteditable="true"][data-tab="7"]',
            'div[aria-label="Add a caption"]',
            'div[title="Add a caption"]',
            'div[data-tab="7"]',
          ];
          for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
              element.click();
              element.focus();
              document.execCommand("insertText", false, msg);
              return true;
            }
          }
          return false;
        }, caption);
        if (!captionTyped) console.warn("Could not find caption input, sending without caption.");
        await this.page.waitForTimeout(500);
      }

      await this.page.waitForTimeout(300);
      const beforeSend = await this.captureSendState();
      const mediaSent = await this.page.evaluate(() => {
        const selectors = [
          '[data-testid="send"]',
          '[data-testid="compose-btn-send"]',
          'div[aria-label="Send"]',
          'span[data-icon="send"]',
          'button[aria-label="Send"]',
        ];
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) {
            const target = element.closest("button,[role='button']") || element;
            target.click();
            return true;
          }
        }
        return false;
      });
      if (!mediaSent) await this.page.keyboard.press("Enter");

      await this.waitForSendConfirmation(beforeSend, { media: true });
      console.log(`Media message sent to +${cleanPhone}`);
    } catch (error) {
      await this.debugScreenshot("send-media-failed").catch(() => {});
      throw new Error(`Could not send media to +${cleanPhone}: ${error.message}`);
    }
  }

  async pickAttachmentInput(inputs, usePhotoOption) {
    for (const input of inputs) {
      const accept = await input.evaluate((element) => element.accept || "").catch(() => "");
      const isPhotoInput = accept.includes("image") || accept.includes("video");
      if (usePhotoOption && isPhotoInput) return input;
      if (!usePhotoOption && (!accept.includes("image") || accept === "*" || accept === "")) return input;
    }
    return usePhotoOption ? inputs[0] : inputs[inputs.length - 1];
  }

  async findComposerSelector() {
    const selector = await this.page.evaluate(() => {
      const selectors = [
        'div[contenteditable="true"][data-tab="10"]',
        'div[contenteditable="true"][data-tab="1"]',
        '[data-testid="conversation-compose-box-input"]',
        'footer div[contenteditable="true"]',
        'div[title="Type a message"]',
        'div[aria-label="Type a message"]',
        'div[aria-placeholder="Type a message"]',
      ];
      return selectors.find((item) => Boolean(document.querySelector(item))) || null;
    });
    if (!selector) throw new Error("Could not find message input selector.");
    return selector;
  }

  async insertComposerText(message) {
    const lines = String(message || "").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      await this.page.evaluate((text) => {
        const element = document.querySelector(
          'div[contenteditable="true"][data-tab="10"], ' +
          'div[contenteditable="true"][data-tab="1"], ' +
          '[data-testid="conversation-compose-box-input"], ' +
          'footer div[contenteditable="true"], ' +
          'div[title="Type a message"], ' +
          'div[aria-label="Type a message"], ' +
          'div[aria-placeholder="Type a message"]',
        );
        if (element) {
          element.focus();
          document.execCommand("insertText", false, text);
        }
      }, lines[index]);
      if (index < lines.length - 1) {
        await this.page.keyboard.down("Shift");
        await this.page.keyboard.press("Enter");
        await this.page.keyboard.up("Shift");
      }
    }
  }

  async debugScreenshot(label = "debug") {
    if (!this.page) return null;
    const directory = path.join(this.userDataPath, "wasend-data", "debug");
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, `${label}-${Date.now()}.png`);
    await this.page.screenshot({ path: filePath, fullPage: true });
    console.log(`Screenshot saved: ${filePath}`);
    return filePath;
  }

  async invalidNumberDialogText() {
    return this.page.evaluate(() => {
      const dialog = [...document.querySelectorAll('[data-testid="popup-contents"], div[role="dialog"]')]
        .find((element) => /invalid|not on whatsapp|phone number shared via url/i.test(element.textContent || ""));
      return dialog ? dialog.textContent.trim().replace(/\s+/g, " ") : "";
    });
  }

  async clickSend() {
    const send = await this.page.waitForSelector(SEND_SELECTOR, { timeout: 10000 }).catch(() => null);
    if (send) {
      await send.evaluate((element) => {
        const target = element.closest("button,[role='button']") || element;
        target.click();
      });
      return;
    }
    await this.page.keyboard.press("Enter");
  }

  async captureSendState() {
    return this.page.evaluate(() => {
      const composer = document.querySelector(
        'div[contenteditable="true"][data-tab="10"], ' +
        'div[contenteditable="true"][data-tab="1"], ' +
        '[data-testid="conversation-compose-box-input"], ' +
        'footer div[contenteditable="true"], ' +
        'div[title="Type a message"], ' +
        'div[aria-label="Type a message"], ' +
        'div[aria-placeholder="Type a message"]',
      );
      return {
        outgoingCount: document.querySelectorAll('.message-out, [data-id^="true_"], div[class*="message-out"]').length,
        composerText: (composer?.innerText || composer?.textContent || "").trim(),
        mediaPreviewOpen: Boolean(
          document.querySelector('[data-testid="media-editor"]') ||
          document.querySelector('[data-testid="media-caption-input-container"]') ||
          document.querySelector('div[data-testid="photo-editor"]') ||
          document.querySelector('div._2jCH9'),
        ),
      };
    });
  }

  async waitForSendConfirmation(before, { media = false } = {}) {
    try {
      await this.page.waitForFunction((prior, expectMedia) => {
        const composer = document.querySelector(
          'div[contenteditable="true"][data-tab="10"], ' +
          'div[contenteditable="true"][data-tab="1"], ' +
          '[data-testid="conversation-compose-box-input"], ' +
          'footer div[contenteditable="true"], ' +
          'div[title="Type a message"], ' +
          'div[aria-label="Type a message"], ' +
          'div[aria-placeholder="Type a message"]',
        );
        const outgoingCount = document.querySelectorAll('.message-out, [data-id^="true_"], div[class*="message-out"]').length;
        const composerText = (composer?.innerText || composer?.textContent || "").trim();
        const mediaPreviewOpen = Boolean(
          document.querySelector('[data-testid="media-editor"]') ||
          document.querySelector('[data-testid="media-caption-input-container"]') ||
          document.querySelector('div[data-testid="photo-editor"]') ||
          document.querySelector('div._2jCH9'),
        );
        if (outgoingCount > prior.outgoingCount) return true;
        if (expectMedia && prior.mediaPreviewOpen && !mediaPreviewOpen) return true;
        if (!expectMedia && prior.composerText && !composerText) return true;
        return false;
      }, { timeout: 12000 }, before, media);
      await this.page.waitForTimeout(500);
    } catch {
      throw new Error("WhatsApp did not confirm the message was sent.");
    }
  }

  update(value) {
    this.status = value;
    this.onStatus(value);
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

module.exports = { WhatsAppSession };
