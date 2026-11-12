# Changelog

## 1.1.0 - 2026-11-12

### Added
- UI section in the property inspector to show the selected launch target path (`Target path`).
- Forced icon refresh option on app selection, with priority processing to avoid delayed icon updates.
- Safety timeout in app discovery to prevent the inspector from staying in a perpetual loading state.

### Improved
- Executable selection heuristics now prioritize likely GUI binaries over CLI/helper binaries.
- Better replacement logic when a selected file is a helper executable (tries current and parent directories).
- Start app and uninstall-entry normalization for more reliable launch targets.

### Fixed
- Fixed cases where helper binaries were selected as launch targets (examples: `courgette*`, `gameoverlay*`, `steamwebhelper*`, updater/crash/helper executables).
- Prevented `.ico` files from being used as launch targets.
- Filtered installer and package artifacts from discovery/launch targets (examples: `.msi`, `.msp`, `.msix`, `.appx`, `.cab`, `setup`/`installer` style artifacts).
- Filtered package-cache and installer locations (examples: `ProgramData\\Package Cache`, `Windows\\Installer`, Visual Studio package paths).
- Filtered web/html targets (`.html`, `.htm`, `.url`, `http(s)://`, `appx:http(s)`).
- Excluded non-launchable framework/system entries from list results (including .NET runtime/framework/host variants, targeting/developer/language packs, SDK entries, Visual C++ redistributables, common driver/component entries, and `vs_*` Visual Studio package-style items).

### Changed
- Version bumped to `1.1.0` in plugin manifest and package metadata.
