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

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- Google Chrome installed, or `CHROME_PATH` set to a Chromium-compatible executable

## Development

```powershell
npm install
npm run dev
```

To work on the renderer in a normal browser:

```powershell
npm run dev:web
```

The browser preview uses renderer fallback data. Run through Electron for SQLite and Puppeteer IPC.

## Production build

Build the renderer:

```powershell
npm run build
```

Package the desktop app for the current operating system:

```powershell
npm run package
```

`electron-builder` writes installers to `release/`. Windows uses NSIS and macOS uses DMG.

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
  data.js                  Browser-preview seed data
  styles.css               Tailwind layers and shared primitives
```

## Storage and privacy

SQLite data and the WhatsApp Web browser profile are stored under Electron's local user-data directory. The app works offline except when WhatsApp Web is connected. Disconnecting clears the locally persisted WhatsApp Web session directory.

## Tunable values

- Set `CHROME_PATH` when Chrome is installed in a non-standard location.
- Sending limits are stored in the local `app_settings` table.
- Defaults are intentionally conservative: at least five seconds between sends and at most 500 messages per session.

## Notes on WhatsApp Web changes

WhatsApp Web is not a public automation API and its DOM may change. The Puppeteer service uses fallback selectors and wraps connection state transitions defensively. Validate the selectors after WhatsApp Web updates before running a campaign.
