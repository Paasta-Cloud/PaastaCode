# PaastaCode Android

The Android client uses Google's Android Browser Helper (TWA), opening
`https://code.paasta.cloud/?platform=android`. It reuses the real hosted interface,
browser account session and download handling. It does not embed Node, OpenCode,
an HTTP listener, credentials or a WebView JavaScript bridge in the APK.

## Build and test

Use JDK 21, Android SDK 36 and Node.js 22+. From `extensions/paastacode`:

```sh
npm ci
npm run check
node --test test/android.test.mjs test/hosted.test.mjs
node test/android-browser.mjs
node test/browser.mjs
node test/cloud-hub-browser.mjs
cd android
./gradlew assembleDebug lintDebug
```

Windows: use `gradlew.bat`. The APK is
`android/app/build/outputs/apk/debug/app-debug.apk`. GitHub's **PaastaCode Android**
workflow builds the same APK and retains lint and browser-test reports.

The debug package is `cloud.paasta.code.debug`; production is `cloud.paasta.code`.
An unassociated debug build opens a Custom Tab with browser chrome. This is an
expected fallback, **not evidence that release TWA validation passed**. Do not
publish a debug certificate on the production domain. The host website must be
deployed separately; building an APK does not update the hosted UI or enable cloud
workspaces. Android 7+ and a TWA-capable browser are required for the intended UI.

## Sign a release

Set all four environment variables from the publisher's existing secure signing
configuration. Keep the keystore outside the repository and retain an encrypted
backup; every update must retain the same signing identity.

- `PAASTACODE_ANDROID_KEYSTORE`: absolute keystore path
- `PAASTACODE_ANDROID_STORE_PASSWORD`
- `PAASTACODE_ANDROID_KEY_ALIAS`
- `PAASTACODE_ANDROID_KEY_PASSWORD`

Run `./gradlew assembleRelease bundleRelease` from `android/`. Release packaging
refuses missing/partial signing configuration. Increase `versionCode` before each
store update. Inspect the actual signed APK with Android's
`apksigner verify --print-certs`; use that SHA-256 certificate fingerprint below,
not the APK file hash, SHA-1, upload certificate or debug certificate.

## Bazaar association

Follow the [official Bazaar TWA guide](https://developers.cafebazaar.ir/fa/guidelines/feature/trusted-web-application#faq).
The manifest includes `android.support.customtabs.trusted.DEFAULT_URL` and the
app-to-site `asset_statements`. Create the site-to-app association from the client
directory:

```sh
node scripts/android-release.mjs --fingerprint="YOUR_RELEASE_SHA256" --existing=existing-assetlinks.json
node scripts/android-release.mjs --verify --fingerprint="YOUR_RELEASE_SHA256"
```

The first command writes `dist/android-web/.well-known/assetlinks.json`. Omit
`--existing` only when the domain has no previous associations. Multiple
`--fingerprint` arguments support an intentional certificate transition. The
generator retains other packages and previous fingerprints for this package.
Review this file before deployment; it grants a domain-to-app association.

Serve it as `application/json`, HTTP 200, without authentication or redirects at
`https://code.paasta.cloud/.well-known/assetlinks.json`. It includes both:

- `delegate_permission/common.handle_all_urls` with `android_app`, the package
  name and the actual signing certificate's SHA-256 fingerprint;
- `check_validation` with `cafebazaar_twa` and the same package name.

Do not put placeholder fingerprints in a live file. Authentication on
`console.paasta.cloud` intentionally retains browser origin chrome; that domain
is not claimed as a second verified origin.

## Hosting and acceptance gates

Deploy `web/manifest.webmanifest`, `web/pwa.js`, `web/sw.js`, `web/offline.*`,
`web/icons/*` and the changed shared web files through the platform's existing
asset allowlist. The worker must be served at `/sw.js` with root scope (or
`Service-Worker-Allowed: /` when internally rewritten); the CSP must allow
`worker-src 'self'` and `manifest-src 'self'`. The offline cache contains only the
offline page, its CSS, the open font and brand image. It never caches account/API
responses, conversations, projects or export downloads and never replays writes.

Before any store submission, verify on a physical signed Android build:

1. Domain association and true TWA launch, including fresh browser installation.
2. Real account login, workspace selection and account switching/logout.
3. An authorized isolated cloud workspace: prompt, review, tool execution,
   file diff, project export and reconnection after the app is backgrounded.
4. Touch keyboard, file attachment, Back, downloads, and 320px/390px layouts.
5. Offline launch **after a first successful online load**; a first-ever offline
   launch cannot install the service worker and uses the browser's error screen.
6. Store-specific payment approval, privacy policy, support details, screenshots
   and reviewer access. The existing web checkout is not certified by this work.

The Bazaar FAQ explicitly points TWA developers to **BazaarPay** and developer
support for payment integration. No production merchant configuration or payment
SDK is invented here. Myket's approval is separate; Bazaar's `check_validation`
record does not assert Myket compatibility or approval.

Cloud execution is gated by the platform's real catalogue and runtime readiness.
This client does not enable provisioning or silently charge a wallet. If the
catalogue is disabled, Android explains that state and does not offer the
computer-only loopback connection. A green APK build is not a live-service or
marketplace acceptance result.

## Attribution

PaastaCode remains an independent MIT fork powered by OpenCode. Existing source,
brand and font notices remain in `../THIRD_PARTY_NOTICES.md` and `../licenses/`.
Android Browser Helper and the Gradle wrapper are Apache-2.0 components; their
upstream licenses are retained under `licenses/`.

## Offline publisher signing

CI also builds an explicitly **unsigned**, non-installable release APK/AAB with
`-PprepareUnsignedRelease=true`. This opt-in never substitutes a debug certificate.
Ordinary release packaging still fails without publisher credentials, and CI
checks that guard. The artifact is named `PaastaCode-Android-UNSIGNED-offline-signing`.
It includes the Android SDK apksigner JAR and APK metadata for local verification.

Keep the permanent private key on the publisher's machine. Sign the aligned APK
locally using `java -jar apksigner.jar sign --ks /private/release.p12
--ks-key-alias paastacode-release --ks-pass env:PAASTACODE_SIGN_PASS
--out PaastaCode-release.apk app-release-unsigned.apk`, then run
`java -jar apksigner.jar verify --verbose --print-certs PaastaCode-release.apk`.
Compare its certificate SHA-256 with the saved publisher certificate and deployed
assetlinks.json. Use JDK jarsigner to sign/verify the AAB separately; an AAB is not
an installable APK. Never upload private signing keys or passwords as artifacts.
