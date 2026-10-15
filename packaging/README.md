# Packaging

`./packaging/build.sh` builds `packaging/build/Damla-<VERSION>.dmg`.

Without environment variables it signs ad hoc (runs locally; Safari needs "Allow Unsigned Extensions"; Gatekeeper rejects it elsewhere).

## Release build

One-time setup:

1. Paid Apple Developer Program account.
2. A "Developer ID Application" certificate **with its private key** in the login keychain. A `.cer` alone is not enough.
   Generate a CSR on this Mac (private key stays in the keychain), upload it at developer.apple.com > Certificates > Developer ID Application (G2 Sub-CA), download the `.cer` and double-click it.
3. Notarization credentials: `xcrun notarytool store-credentials damla-notary --apple-id <id> --team-id <TEAM_ID> --password <app-specific-password>`
4. The Sparkle EdDSA private key lives in the login keychain (created by `packaging/cache/Sparkle/bin/generate_keys`). Back it up: `generate_keys -x damla-sparkle-key` and keep the file in a password manager. Losing it means installed copies can never update.

Release:

```sh
python3 scripts/bump_version.py 0.5.0   # edit the new section in CHANGELOG.md, then commit
SIGN_ID="Developer ID Application: <Name> (<TEAM_ID>)" NOTARY_PROFILE=damla-notary ./packaging/release.sh
PUBLISH=1 SIGN_ID=... NOTARY_PROFILE=... ./packaging/release.sh   # also runs gh release create
```

`release.sh` runs `scripts/check.py`, builds, signs, notarizes, writes `appcast.xml` (signed with the EdDSA key, release notes taken from the matching `CHANGELOG.md` section) and, with `PUBLISH=1`, uploads the DMG and `appcast.xml` to the GitHub release with the same notes. The notes appear in the Sparkle update dialog. The app reads `https://github.com/<repo>/releases/latest/download/appcast.xml`.

## How updates work

- Damla.app stays running in the background (Login Item). It starts and supervises the helper and runs Sparkle (daily check, standard update dialog).
- The helper still asks GitHub for the latest release so the extension can show the red dot; the "Update" button in the extension opens `damla://check-for-updates`, which makes the app run a Sparkle check.
- yt-dlp updates itself: the helper downloads the latest zipapp into `~/Library/Application Support/Damla/bin`, which wins over the bundled copy.
- Opening Damla.app again while it runs shows a status dialog (check for updates, quit).

## What is bundled

- CPython 3.13 (python-build-standalone), pruned
- yt-dlp zipapp, run by the bundled Python
- ffmpeg built from source by `build-ffmpeg.sh` as LGPL (`--disable-gpl --disable-nonfree`), VideoToolbox for H.264 re-encoding
- Sparkle 2 (without XPC services; the app is not sandboxed)
- `fetch-tools.sh` pins every download in `checksums.txt`

Apple Silicon only. Licenses are in `Contents/Resources/licenses`.
