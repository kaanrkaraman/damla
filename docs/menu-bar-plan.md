# Menu bar plan

Status: proposed. Nothing here is built.

## Goal

An optional Damla item in the macOS menu bar. Paste a link, pick resolution and format, download, and watch progress without opening Safari. A switch in Settings, "Show in menu bar", turns it on; it is off by default.

## What the menu shows

1. A link field. It fills itself from the clipboard when that holds an http(s) URL. Return starts the download.
2. Resolution (Best, 1080p, 720p, Audio) and format (Auto, Compatible) selectors, the same controls as the popup.
3. Active downloads with a progress ring and cancel, then the last five finished ones with Show in Finder and retry.
4. Footer: open the download folder, check for updates, quit.

Quality and format chosen in the menu apply to that download only. Changing them in Settings keeps changing the defaults.

## Design

- **UI.** A SwiftUI `MenuBarExtra` with the window style. The app entry moves from the `Launcher` enum to a SwiftUI `App` with `@NSApplicationDelegateAdaptor(AppDelegate.self)`, so the helper supervisor, login item and Sparkle stay where they are. `LSUIElement` stays on. On macOS 26 the window picks up Liquid Glass without extra code.
- **Talking to the helper.** The app calls the same HTTP API. The helper accepts writes only from the extension origin, so the app and helper share a token: Damla generates 32 random bytes at launch, passes them in `DAMLA_TOKEN`, and sends them as a bearer header. The helper compares in constant time. Without the token nothing changes for the extension.
- **State.** A `HelperClient` (async `URLSession`) and an `@Observable` `DownloadStore`. Polls `/jobs` once a second while the menu is open or a job is active, and backs off when the helper is down.
- **Setting sync.** `menubar` is a boolean in the helper settings. After a settings change the helper runs `open -g -a Damla.app damla://settings-changed`, the same mechanism as `damla://check-for-updates`, and the app re-reads `/settings`. No polling.
- **Per-download overrides.** `POST /jobs` items accept optional `quality` and `codec`, validated by `clean_settings` and merged over the settings snapshot taken when the job starts.
- **Localization.** New strings go into `Localizable.xcstrings` in English, Türkçe and Deutsch; `scripts/check.py` fails if one is missing or unused.

## Steps

1. **Helper:** token auth, per-item overrides, `menubar` setting and the `settings-changed` notification, each with a pytest test.
2. **App shell:** SwiftUI entry, `MenuBarExtra` gated by the setting, `HelperClient`, `DownloadStore`.
3. **Menu UI:** link field, selectors, download list, footer.
4. **Extension:** the "Show in menu bar" switch, three-language strings, changelog entry.
5. **Verify:** build, notarize, install, check the signature seal after a run, test against a real link.

## Risks

- `MenuBarExtra` windows in an `LSUIElement` app need an explicit `NSApp.activate` for the text field to take focus.
- The item can be hidden behind the notch on crowded menu bars; nothing to do but document it.
- The token must never be logged. The helper log redacts the header.
