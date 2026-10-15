# Changelog

All notable changes to Damla. Each release section is shown to users in the update dialog and on the GitHub release page.

## [Unreleased]

## [0.7.1] - 2026-10-15

### Fixed
- Damla crashed right after launching, which stopped the helper from restarting, "Check for updates" and the Safari extension prompt.

## [0.7.0] - 2026-10-15

### Changed
- The extension is rebuilt in TypeScript.
- The bundled Python is 3.14.

## [0.6.1] - 2026-10-15

### Changed
- Switches in Settings follow the system accent color.

## [0.6.0] - 2026-10-15

### Added
- German translation; the extension and the app follow the system language.
- A warning in the popup when the extension and the helper do not match.
- "What's new" link in Settings and release notes in the update dialog.

### Changed
- The helper listens on port 7560.
- The folder picker prompt follows the system language.

### Fixed
- Safari could refuse to load the extension after the app had run, because Python wrote cache files into the signed app and broke its signature.
- Reloading the extension no longer logs "duplicate variable" errors on open pages.

## [0.5.0] - 2026-10-15

### Added
- Manual "Check for updates" under the version footer in Settings.
- The toolbar icon dims on pages without videos.

### Changed
- Resolution and format share one Video group; every selector slides between options.
- The video codec follows what the Mac plays natively; VP9 is never downloaded.
- Settings keep the size of the video list and no longer explain every option.

## [0.4.1] - 2026-10-15

### Fixed
- The extension could not reach the helper because its sandbox lacked network access.

## [0.4.0] - 2026-10-15

### Added
- First release: Safari extension and local yt-dlp helper for Instagram, X, Facebook and YouTube.
- Signed and notarized app with automatic updates.
