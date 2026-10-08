# Android phone

Jair's phone runs **T3 Code Preview** (`com.t3tools.t3code.preview`), a local release build. It connects to the MacBook or Omarchy service over T3 Connect, so server changes reach it through the service install. Rebuild the APK only for mobile or shared client changes, or when Jair asks.

## Updating in place keeps settings

Android installs an APK over the existing app, keeping its data, only when all three hold:

- Same package: build the `preview` variant (`APP_VARIANT=preview`).
- Same signing key: local Expo builds sign release with the React Native template's `android/app/debug.keystore`, which `expo prebuild` writes identically on every machine. Its SHA-256 is `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. Never sign with EAS or another keystore.
- versionCode not lower than the installed one: prebuild writes `versionCode 1`, and an equal versionCode installs as an update.

Never tell Jair to uninstall first; uninstalling erases the app's pairings and settings. If Android reports a package conflict, stop and investigate the signature rather than uninstalling.

## T3 Connect

The phone has no other route to the Mac, so the APK must include the Connect sign-in. `app.config.ts` reads it from the checkout's root `.env` (see [SKILL.md](SKILL.md)); confirm `T3CODE_RELAY_URL` and `T3CODE_CLERK_PUBLISHABLE_KEY` are set there before prebuild. An APK built without them installs and opens, but cannot sign in to Connect. On the phone, Jair signs in to the same Connect account and picks the Mac or PC from the list; no pairing QR code is needed.

## Toolchain

The build needs JDK 17 and the Android SDK. On the MacBook they came from Homebrew (`openjdk@17` and the `android-commandlinetools` cask) with the SDK at `~/Library/Android/sdk`; on Omarchy use the distro's JDK 17 and an SDK at `~/Android/Sdk`. Accept licenses once with `sdkmanager --sdk_root=<sdk> --licenses` and install `platform-tools`; Gradle downloads the platform, build tools, NDK, and CMake it needs on first build.

```bash
# MacBook
export JAVA_HOME=/opt/homebrew/opt/openjdk@17 PATH=/opt/homebrew/opt/openjdk@17/bin:$PATH
export ANDROID_HOME=$HOME/Library/Android/sdk ANDROID_SDK_ROOT=$ANDROID_HOME
```

## Build

From `apps/mobile` (the `android/` directory is gitignored and regenerated):

```bash
APP_VARIANT=preview EXPO_NO_GIT_STATUS=1 vp exec expo prebuild --clean --platform android --no-install
cd android
APP_VARIANT=preview NODE_ENV=production ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon
```

- The phone is arm64, so build only `arm64-v8a`. A first build on a machine takes a long time while Gradle downloads the SDK pieces and compiles native modules; later builds reuse the cache.
- Start Gradle detached (`nohup ... &`, recording the PID) and wait on that PID. A T3 server restart kills harness-tracked background commands, and a killed build has to redo its compile steps.
- The APK lands at `android/app/build/outputs/apk/release/app-release.apk`.

## Verify, then hand off

Check the package and signer before handing the APK over:

```bash
BT=$(ls -d "$ANDROID_HOME"/build-tools/* | tail -1)
"$BT/aapt2" dump badging app-release.apk | head -1   # package name, versionCode
"$BT/apksigner" verify --print-certs app-release.apk  # SHA-256 must match the digest above
```

Copy it to `~/Downloads/t3code-preview-<sha>.apk`. Jair sends it with LocalSend himself; there is no LocalSend CLI on his machines, so do not launch the LocalSend app from a shell. On the phone he opens the received file and taps **Update**; the first time, Android asks him to allow installs from LocalSend.
