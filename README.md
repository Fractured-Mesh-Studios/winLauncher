# Windows App Launcher (OpenDeck Plugin)

A Windows-only OpenDeck plugin that launches programs and shortcuts from a Stream Deck key.

## Overview

This plugin is configured for production on Windows using a compiled executable:

- Plugin UUID: `com.local.winlauncher`
- Windows entry point: `com.local.winlauncher-win.exe`
- Manifest key used for runtime startup: `CodePathWin`

The plugin does not require Node.js on the target machine because it runs as a packaged `.exe`.

---

## Prerequisites

For building a production release:

- Windows 10 or newer
- Node.js 18+ and npm
- OpenDeck-compatible plugin folder structure (already present in this repository)

Optional but recommended:

- Git
- Zip tool (7-Zip or built-in Windows compression)

---

## Project Structure (Important Files)

- `manifest.json` → OpenDeck plugin metadata and runtime configuration
- `plugin.js` → Plugin runtime source entrypoint
- `inspector.html` → Property Inspector UI
- `src/` → Runtime service modules
- `package.json` → Build scripts and dependencies

Production executable output:

- `com.local.winlauncher-win.exe`

---

## Build for Production (Windows)

From the plugin root folder, run:

1. Install dependencies

```bash
npm install
```

2. Build Windows executable

```bash
npm run build:win
```

3. Confirm output exists

- `com.local.winlauncher-win.exe` must be present in the plugin root.

### One-command release package for OpenDeck

Run this command to build and prepare an install-ready package in one step:

```bash
npm run package
```

This command:

- Rebuilds `com.local.winlauncher-win.exe`
- Creates `release/<UUID>.sdPlugin/` (staging folder, from `manifest.json`)
- Creates `release/<UUID>.sdPlugin.zip` (installable archive)

Available scripts:

- `npm run build` → Alias for `build:win`
- `npm run build:win` → Builds Windows executable using `pkg`
- `npm run package` → Builds and creates OpenDeck-ready release artifacts under `release/`
- `npm run prepare:opendeck` → Alias for `package`
- `npm run clean` → Removes the generated `.exe`

---

## Manifest Requirements for OpenDeck

The production manifest must include these Windows-focused values:

- `CodePathWin`: `com.local.winlauncher-win.exe`
- `OS`: Windows platform with minimum version
- `UUID` and `PluginUUID`: `com.local.winlauncher`

Current manifest is already configured accordingly.

---

## Publish Checklist

Before publishing, verify all items:

- Version updated in `manifest.json` and `package.json`
- `com.local.winlauncher-win.exe` rebuilt from latest source
- `manifest.json` points to the same executable filename
- Plugin icon files are present (`icon.png`, `icon@2x.png`)
- Plugin loads in OpenDeck and action appears correctly
- Action launches selected app/shortcut as expected

---

## Packaging for Distribution

Preferred method:

```bash
npm run package
```

Use the generated archive:

- `release/<UUID>.sdPlugin.zip`

Alternative manual method:

Create a release package containing the plugin folder content.

Include:

- `manifest.json`
- `com.local.winlauncher-win.exe`
- `inspector.html`
- `icon.png`, `icon@2x.png`
- Any required static files used by the plugin

Do not include (recommended):

- `node_modules/`
- Source control metadata (`.git/`)
- Temporary or local development files

Suggested package name format:

- `com.local.winlauncher-1.0.0-win.zip`

---

## Quick Validation in OpenDeck

1. Install/copy the plugin package into OpenDeck plugins directory.
2. Restart OpenDeck.
3. Add action **Open Program** to a key.
4. Select a target executable or shortcut in Property Inspector.
5. Press the key and confirm the app starts.

---

## Troubleshooting

### Build fails with unsupported Node target in `pkg`

Use the configured script exactly:

```bash
npm run build:win
```

This project is set to `node18-win-x64`, which is supported by `pkg@5.8.1`.

### OpenDeck does not start plugin

Check:

- `manifest.json` has correct `CodePathWin`
- Executable filename matches exactly
- Plugin UUID is unique in your OpenDeck environment

### Action icon not updating

Rebuild executable and restart OpenDeck to ensure latest runtime is loaded.

---

## Release Notes Template (Optional)

Use this format for each release:

- Version: `x.y.z`
- Date: `YYYY-MM-DD`
- Changes: short bullet list
- Compatibility: Windows minimum version
- Known issues: if any

---

## License

Set your preferred license in `package.json` and repository metadata before public distribution.
