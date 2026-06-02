# WASend Desktop

WASend is an offline-first Electron desktop application for managing opt-in WhatsApp campaigns. It combines a React + Tailwind renderer with SQLite storage and a Puppeteer-powered WhatsApp Web session in the Electron main process.

> Important: use WASend only for contacts who have explicitly opted in. Unsolicited or high-volume messaging can violate WhatsApp policies and lead to account restrictions. The app includes conservative delay defaults, a per-session cap, blacklist support, and a confirmation step before campaign creation.

## Features

- WhatsApp Web connection with persistent local browser session and QR scan state
- Contact management, duplicate-safe E.164 normalization, CSV/Excel/paste import helpers
- Reusable message templates with `{{variable}}` detection
- Media library UI for image, document, video, and audio attachments
- Six-step campaign creation flow with opt-in confirmation
- SQLite campaign logs, blacklist exclusions, scheduling-ready campaign storage
- Conservative sending scheduler with configurable delay range and a maximum session cap
- Dashboard, reports, onboarding, settings, notifications, and local-only persistence

## Install the ready-made Windows app

Use these steps if someone has sent you the WASend installer and you only want to use the app:

1. Download `WASend Setup 1.0.0.exe`.
2. Double-click the downloaded installer.
3. Follow the Windows prompts to install WASend.
4. Open **WASend** from the Start menu.
5. Click **Connect WhatsApp** in WASend.
6. WASend opens its own separate Chromium browser window. Scan the QR code in that browser window using WhatsApp on your phone.
7. Keep the separate Chromium window open while sending messages.

You do **not** need to install Node.js, npm, Chrome, or Brave when using the ready-made Windows installer. The installer includes the Chromium browser that WASend needs.

Windows may warn you before opening an unsigned installer. Only continue if the installer came from a source you trust.

## Run the project from source

Use this section only if you are developing WASend or building the installer yourself.

### 1. Install Node.js

Install **Node.js 20 LTS or newer** from the official download page:

- [Download Node.js](https://nodejs.org/en/download)

Choose the Windows `.msi` installer, open it, and keep the default options. Node.js includes `npm`, so you do not install npm separately.

After installation, open a new PowerShell window and confirm that both commands work:

```powershell
node --version
npm --version
```

### 2. Install Git if needed

If you downloaded the project as a ZIP file, skip this step. If you want to clone the project from GitHub, install Git:

- [Download Git for Windows](https://git-scm.com/download/win)

Clone the repository, or extract the ZIP file, then open PowerShell inside the project folder.

### 3. Install project dependencies

Run:

```powershell
npm install
```

The first install downloads the packages and Puppeteer's compatible Chromium browser. Chromium is stored in the project-level `puppeteer-cache` folder, outside `node_modules`. Deleting and reinstalling `node_modules` will not download Chromium again while that cache folder remains in place.

If the Chromium download was interrupted, run:

```powershell
npx puppeteer browsers install chrome
```

### 4. Start the desktop app

Run:

```powershell
npm run dev
```

WASend opens as a desktop application. Use the **Connect WhatsApp** button to launch the separate Chromium window and scan the real WhatsApp Web QR code.

### 5. Optional browser-only UI preview

To preview the React interface without Electron, run:

```powershell
npm run dev:web
```

Then open [http://127.0.0.1:5173/](http://127.0.0.1:5173/) in a browser. The browser-only preview cannot access SQLite or Puppeteer. Use the Electron desktop app for real data and WhatsApp connections.

## Build a Windows installer

After completing `npm install`, run:

```powershell
npm run package
```

The Windows installer is written to:

```text
release/WASend Setup 1.0.0.exe
```

The installer includes Puppeteer's managed Chromium resource. People installing WASend do not need a system Chrome or Brave browser.

## Project structure

```text
electron/
  main.cjs                 Electron entry and IPC handlers
  preload.cjs              Context-isolated renderer bridge
  services/
    database.cjs           SQLite schema and queries
    importer.cjs           CSV, Excel, and pasted contact parsing
    scheduler.cjs          Campaign pacing and session limits
    whatsapp.cjs           Puppeteer WhatsApp Web session
src/
  App.jsx                  React desktop interface
  styles.css               Tailwind layers and shared primitives
.puppeteerrc.cjs            Stable Puppeteer browser-cache location
puppeteer-cache/            Downloaded managed Chromium browser
```

## Storage and privacy

SQLite data and the WhatsApp Web browser profile are stored under Electron's local user-data directory. The app works offline except when WhatsApp Web is connected. Disconnecting clears the locally persisted WhatsApp Web session directory.

## Tunable values

- WhatsApp automation always launches Puppeteer's bundled Chromium in a separate visible window. WASend does not use an installed Chrome or Brave browser.
- The Windows installer includes the Puppeteer-managed Chromium build as an application resource, so installed copies do not depend on a browser download during first launch.
- Sending limits are stored in the local `app_settings` table.
- Defaults are intentionally conservative: at least five seconds between sends and at most 500 messages per session.

## Notes on WhatsApp Web changes

WhatsApp Web is not a public automation API and its DOM may change. The Puppeteer service uses fallback selectors and wraps connection state transitions defensively. Validate the selectors after WhatsApp Web updates before running a campaign.
