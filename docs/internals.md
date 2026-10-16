# Internals

Decisions that are not obvious from the code. The code carries no comments, so the reasons live here.

## Helper

- **No bytecode in the bundle.** The helper runs with `-B` and `PYTHONDONTWRITEBYTECODE=1`, and the standard library is precompiled at build time. Python writing `__pycache__` into `Damla.app` invalidates the code signature ("a sealed resource is missing or invalid") and Safari then refuses the extension. Check with `codesign --verify --deep --strict --verbose=4 /Applications/Damla.app`.
- **Origin rules.** Safari sends no `Origin` header on extension `GET` requests but does on `POST` and `PUT`. Reads without an origin are allowed only when `Host` is the local helper address; writes need a `safari-web-extension://` or `chrome-extension://` origin. The origin also picks the browser yt-dlp reads cookies from.
- **Port 7560 and `API_VERSION`.** The port is fixed on purpose. `API_VERSION` and the popup's `REQUIRED_API` must match; bump both when a request or reply changes shape. `scripts/check.py` enforces the pairing.
- **Exits with the app.** A bundled helper polls its parent and exits when Damla quits; the app restarts it with exponential backoff.
- **Codec choice.** `-S vcodec:h264,res,...` puts the codec first because resolution first picks VP9 reels that QuickTime cannot open. "Auto" filters formats to codecs the Mac decodes natively (H.264, HEVC, plus AV1 from the M3), then sorts by resolution. Anything else is converted to H.264 after the download.
- **yt-dlp runs as a zipapp** on the bundled Python. The PyInstaller binary starts in about 5 s, the zipapp in 0.3 s. Updates download the zipapp to `~/Library/Application Support/Damla/bin`, which wins over the bundled copy.
- **ffmpeg is built from source as LGPL** (`--disable-gpl --disable-nonfree`) so it can be redistributed. Prebuilt binaries are often `--enable-nonfree`.

## Extension

- **Network entitlement.** The extension sandbox needs `com.apple.security.network.client` to reach the helper. Without it Safari reports "The background content failed to load".
- **In-page buttons** live in a detached shadow-DOM layer on `<html>`, positioned from `getBoundingClientRect`. Attaching them inside the page would trigger Instagram's hold-to-pause handlers.
- **Content script isolation.** Each bundle is an IIFE, so re-injecting after an extension reload cannot redeclare top-level names; the new script removes the old layer.
- **Chrome.** Chrome exposes the promise-based API as `chrome`, so `compat.ts` aliases it to `browser` and is imported first in every entry point. Message listeners answer through `sendResponse` because Chrome ignores a promise returned from the listener.
- **Toolbar icon.** The content script reports whether the page has videos; the background script swaps the per-tab icon.

## Packaging and updates

- **Ad-hoc builds** are signed with `tool.entitlements` (library validation off) because strict validation rejects ad-hoc Sparkle. Developer ID builds use strict validation.
- **Sparkle reads `appcast.xml`** from the latest GitHub release, so the repository must stay public. Release notes come from the matching `CHANGELOG.md` section. The EdDSA private key lives only in the login keychain; back it up with `generate_keys -x`.
- **Login item.** The app registers itself with `SMAppService.mainApp`, refuses to run from a disk image or from App Translocation, and asks for consent once.
