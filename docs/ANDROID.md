# Android packaging (APK) — build, sign, publish

This wraps the web app in a tiny **offline WebView** Android app and ships it as a
signed APK for **Obtainium** and **IzzyOnDroid**. It is scaffolding: it builds in
CI, but you must create a signing key and add a few secrets once.

## What's here

```
android/                         self-contained Gradle/Android project
  app/
    build.gradle                 applicationId, SDK levels, versionCode/Name, syncWebAssets
    src/main/
      AndroidManifest.xml        no INTERNET permission — fully offline
      java/.../MainActivity.java  one full-screen WebView -> file:///android_asset/index.html
      res/                        app name, theme, adaptive launcher icon (club on green)
      assets/                     (git-ignored) the web app, copied in at build time
  gradlew, gradle/wrapper/        Gradle 8.7 wrapper (AGP 8.5.2)
.github/workflows/android-release.yml   tag v* -> build, sign, attach APK to the Release
vendor/react*.production.min.js  React/React-DOM bundled locally (no CDN) so the app is offline
```

- **applicationId:** `dev.cribbage.cutthroat` (name-free). It is **permanent once
  published** — change it in `android/app/build.gradle` *before* your first release
  if you want something else.
- **No network permission**, no third-party libraries, no trackers — chosen to pass
  IzzyOnDroid's scanners and to work on de-Googled devices.

## Source of truth & the asset sync

The built web pages live at the **repo root** (`index.html`, `trainer.html`,
`play.html`, `vendor/`), produced by `./build.sh`. The Gradle task `:app:syncWebAssets`
copies them into `android/app/src/main/assets/` before each build, so the APK always
ships the current site. If you change `src/*.jsx`, run `./build.sh` and commit the
regenerated root HTML *before* tagging a release.

## Build it

Prereqs: JDK 17+, Android SDK (set `ANDROID_SDK_ROOT`, or add `android/local.properties`
with `sdk.dir=/path/to/Android/Sdk`). Then:

```bash
./build.sh                       # regenerate the web app at the repo root
cd android
./gradlew assembleRelease        # -> app/build/outputs/apk/release/app-release-unsigned.apk
```

(The first `gradlew` run downloads Gradle 8.7 and the Android Gradle Plugin.)

## Create a signing key (once, keep it forever)

Updates only install if every release is signed with the **same** key. Back it up.

```bash
keytool -genkey -v -keystore release.jks -alias cribbage \
  -keyalg RSA -keysize 2048 -validity 10000
```

Sign a local build:

```bash
BT=$ANDROID_SDK_ROOT/build-tools/<version>
$BT/zipalign -p -f 4 app-release-unsigned.apk aligned.apk
$BT/apksigner sign --ks release.jks --ks-key-alias cribbage --out cribbage.apk aligned.apk
$BT/apksigner verify --print-certs cribbage.apk
```

> Never commit `release.jks` / passwords — `.gitignore` already blocks `*.jks`,
> `*.keystore`, and `android/keystore.properties`.

## Phone-friendly: generate the key in CI (no local keytool)

If you can't run `keytool` (e.g. you're on a phone), use the one-off
`.github/workflows/bootstrap-signing.yml` — it generates the keystore in CI and
writes the four signing secrets for you. All steps are taps in the GitHub web UI:

1. Create a fine-grained PAT (github.com/settings/personal-access-tokens/new) on
   `ghug/cribbage-trainer` with **Secrets: Read and write** (+ Metadata).
2. Add it as a repo secret named **`BOOTSTRAP_PAT`** (Settings → Secrets and
   variables → Actions).
3. Actions tab → **Bootstrap signing key** → **Run workflow** (keep alias `cribbage`).
4. When it's green, **delete `BOOTSTRAP_PAT`** and revoke that token. Optionally
   delete the `bootstrap-signing.yml` workflow (single-use).

`KEYSTORE_BASE64 / KEYSTORE_PASSWORD / KEY_PASSWORD / KEY_ALIAS` are now set, so the
release workflow below just works. Caveat: the key lives only as a secret (not
readable back), so there is **no off-device backup** — re-run the bootstrap to make a
new one if it's ever lost (users reinstall once). Prefer a backup? Use the manual
`keytool` route above from a browser terminal (e.g. GitHub Codespaces).

## Automated releases (CI)

`.github/workflows/android-release.yml` builds + signs + attaches the APK to a GitHub
Release on every `v*` tag. Add these **repository secrets** once (Settings → Secrets
and variables → Actions) on the repo the workflow runs in:

| Secret | Value |
|---|---|
| `KEYSTORE_BASE64` | `base64 -w0 release.jks` |
| `KEYSTORE_PASSWORD` | keystore password |
| `KEY_ALIAS` | e.g. `cribbage` |
| `KEY_PASSWORD` | key password |

Then cut a release:

```bash
# bump versionCode (+1) and versionName in android/app/build.gradle first
git tag v1.0.0 && git push origin v1.0.0
```

The Action produces `cribbage-v1.0.0.apk` on the GitHub Release.

## Publish to Obtainium (no approval)

Users open Obtainium → **Add App** → paste the repo URL
(`https://github.com/ghug/cribbage-trainer`) → it tracks Releases and installs/updates
the APK. Nothing else required beyond signed releases existing.

## Publish to IzzyOnDroid (FOSS review)

1. Have signed `v*` releases on GitHub (above) and a FOSS license — done
   (`LICENSE`, The Unlicense).
2. Confirm the APK is clean: no INTERNET permission, no trackers (it has neither).
3. File a **Request For Packaging (RFP)** on their GitLab
   (`gitlab.com/IzzyOnDroid/repo`, RFP issue template). They add metadata that pulls
   your release APK and records your signing certificate.
4. Maintain: **increment `versionCode` every release**; keep `targetSdk` current.

## Listing text (fastlane metadata)

F-Droid / IzzyOnDroid auto-import the store listing from
`fastlane/metadata/android/en-US/`:

```
title.txt               app name
short_description.txt    one line, <= 80 chars
full_description.txt     the long description
changelogs/<code>.txt    per-release notes, named by versionCode (1.txt, 2.txt, …)
images/phoneScreenshots/ 1.png, 2.png, … (add your own from the running app)
```

Per release: bump `versionCode` and add a matching `changelogs/<code>.txt`. Drop a
few PNG screenshots into `images/phoneScreenshots/` to fill out the listing (the icon
comes from the APK's adaptive icon, so no `icon.png` is needed).

## Caveat: WebView age

The UI uses CSS **container queries** (`container-type` / `cqw`), which need
**WebView ≥ 105** (late 2022). On older/de-Googled devices with a stale system
WebView, card sizing can break. `minSdk` is 26, but the WebView version matters more
than the OS — consider documenting it or adding a non-`cqw` fallback before a wide
release.
