# Damla

Download videos from Instagram, X, Facebook and YouTube with one click from Safari.

Damla is a Safari extension plus a small background app that runs [yt-dlp](https://github.com/yt-dlp/yt-dlp) locally. Nothing leaves your Mac except the requests yt-dlp makes to the sites you download from.

## Install

1. Download `Damla-<version>.dmg` from the [latest release](https://github.com/kaanrkaraman/damla/releases/latest).
2. Open it and drag Damla to Applications, then launch it from there.
3. In Safari: Settings › Extensions › enable Damla and allow it on the sites you use.

Requires macOS 14 or later on Apple Silicon. Available in English, Türkçe and Deutsch. The app is signed with a Developer ID and notarized by Apple. It updates itself (Sparkle) and keeps yt-dlp current.

## Privacy

The helper listens only on `127.0.0.1:7560` and accepts writes only from the Safari extension. There is no analytics or telemetry. Update checks go to GitHub and yt-dlp's releases.

## Layout

- `extension/`: Safari web extension (Manifest V3)
- `helper/server.py`: local download helper (Python standard library only)
- `Damla/`: Xcode project for the app and extension wrapper
- `packaging/`: reproducible build, signing, notarization and release scripts (see `packaging/README.md`)

## Development

```sh
git config core.hooksPath .githooks
python3 scripts/check.py
```

`scripts/check.py` runs before every commit. It keeps the version in `VERSION`, `manifest.json`, the Xcode project and `CHANGELOG.md` in sync, checks that the helper port and API version match the extension, validates the manifest, and verifies that every localized string exists in every language and is used.

Strings live in `extension/_locales/<lang>/messages.json` (extension) and `Damla/Damla/Localizable.xcstrings` (app). To add a language, add it to both and to `knownRegions` in the Xcode project.

## Build

```sh
./packaging/build.sh
```

Without signing variables it produces an ad hoc signed build for local use. Releases need your own Developer ID, notarization profile and Sparkle key, see `packaging/README.md`. If you fork this, generate your own Sparkle key and replace `SUPublicEDKey` and `SUFeedURL` in `Damla/Damla/Info.plist`.

## License

MIT. Bundled components keep their own licenses (yt-dlp: Unlicense, ffmpeg: LGPL, Sparkle: MIT, CPython: PSF), shipped inside the app under `Contents/Resources/licenses`.
