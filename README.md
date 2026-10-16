# Damla

Download videos from Instagram, X, Facebook and YouTube with one click from Safari.

Damla is a Safari extension plus a small background app that runs [yt-dlp](https://github.com/yt-dlp/yt-dlp) locally. Nothing leaves your Mac except the requests yt-dlp makes to the sites you download from.

## Install

1. Download `Damla-<version>.dmg` from the [latest release](https://github.com/kaanrkaraman/damla/releases/latest).
2. Open it and drag Damla to Applications, then launch it from there.
3. In Safari: Settings › Extensions › enable Damla and allow it on the sites you use.

### Chrome

The Damla app from steps 1 and 2 must be installed and running; the Chrome extension talks to the same local helper and cannot download anything on its own.

The Chrome extension is not in the Chrome Web Store yet, so you build it yourself:

1. Install [Node.js](https://nodejs.org) 22.18 or later. Check with `node --version` in Terminal.
2. Get the source: `git clone https://github.com/kaanrkaraman/damla.git`, or on GitHub click Code › Download ZIP and unzip it.
3. In Terminal, go into the folder and build the extension:

   ```sh
   cd damla
   npm ci
   npm run build
   ```

   This creates `extension/dist`.
4. Open `chrome://extensions`, turn on Developer mode (top right), click "Load unpacked" and choose the `extension/dist` folder.
5. Open a video on Instagram, X, Facebook or YouTube and click the download button on the video, or the Damla icon in the toolbar.

To update, get the new source (`git pull`, or download the ZIP again), run `npm ci` and `npm run build` again, then click the reload button on Damla in `chrome://extensions`.

If downloads stop right after you click, check that the Damla app is running and up to date.

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
npm ci
uv sync
scripts/lint.sh
```

- `scripts/format.sh` formats Python (ruff), TypeScript and JSON (Biome) and Swift (swift-format).
- `scripts/lint.sh` runs ruff, ty, pytest, tsc, Biome, swift-format, shellcheck and `scripts/check.py`. `scripts/check.py` keeps `VERSION`, `manifest.json`, the Xcode project and `CHANGELOG.md` in sync, checks that the helper port and API version match the extension, validates the manifest and verifies that every localized string exists in every language and is used.
- The pre-commit hook runs `scripts/check_staged.py` (secrets, generated files, size) and `scripts/lint.sh`. The commit-msg hook requires [Conventional Commits](https://www.conventionalcommits.org): `type(scope): subject` with `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore` or `revert`.
- The extension is TypeScript in `extension/src`. `npm run build` bundles it into `extension/dist`, which the Xcode project packages; `packaging/build.sh` does this for you.

Strings live in `extension/_locales/<lang>/messages.json` (extension) and `Damla/Damla/Localizable.xcstrings` (app). To add a language, add it to both and to `knownRegions` in the Xcode project. Decisions that are not obvious from the code are in [docs/internals.md](docs/internals.md); the menu bar proposal is in [docs/menu-bar-plan.md](docs/menu-bar-plan.md).

## Build

```sh
./packaging/build.sh
```

Without signing variables it produces an ad hoc signed build for local use. Releases need your own Developer ID, notarization profile and Sparkle key, see `packaging/README.md`. If you fork this, generate your own Sparkle key and replace `SUPublicEDKey` and `SUFeedURL` in `Damla/Damla/Info.plist`.

## License

MIT. Bundled components keep their own licenses (yt-dlp: Unlicense, ffmpeg: LGPL, Sparkle: MIT, CPython: PSF), shipped inside the app under `Contents/Resources/licenses`.
