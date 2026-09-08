# @munni/native — the Capacitor shell

Real installed Android/iOS apps around the one web codebase
(`docs/native-apps-design.md`). The built `apps/web/dist` bundle ships
INSIDE the binary; WebView storage is app-scoped and never evicted.

## Build locally

```bash
npm run sync -w @munni/native   # builds the web app + copies it into both shells
npm run open:android -w @munni/native   # Android Studio (needs Android SDK)
npm run open:ios -w @munni/native       # Xcode (macOS only; pod install runs there)
```

Shell builds must point at the hosted stack (the webview's own origin is
localhost): set `VITE_API_URL`, `VITE_PUBLIC_ORIGIN` (e.g.
`https://munni.okkes.synology.me`) and the `VITE_LOGTO_*` vars before
`sync`. CI (`.github/workflows/native-android.yml`) reads them from
repository variables `NATIVE_*` and uploads a debug APK.

## What's wired

- **Deep links**: `munni://` is registered on both platforms;
  `lib/platform.ts` re-enters `/gc-callback` and `/auth-callback` in the
  running app. The bank redirect stays https to the hosted page (which
  completes anonymously via the reference token) — so consent works even
  when the return lands in a browser.
- **Push**: the app registers its FCM/APNs token as a `kind: fcm`
  subscription; the API fans out per kind (FCM HTTP v1).
- **Storage**: `navigator.storage.persist()` is skipped natively — the
  WebView's storage is application data already.

## One-time user prerequisites (not yet done)

1. **Logto**: add `munni://auth-callback` to the app's redirect URIs —
   until then native sign-in bounces (demo/offline work regardless).
2. **Firebase** (free): create a project, add the Android app
   (`app.munni`), drop `google-services.json` into
   `android/app/`, and put the service-account JSON into the API env
   (`FCM_SERVICE_ACCOUNT_JSON`) — until then native push is silently off.
3. **Apple Developer Program** ($99/yr) for TestFlight; Play Console
   ($25 one-time) or sideload the CI APK from the NAS.

## Regenerating icons/splash

`assets/logo.png` (from the PWA icon) is the source:
`npx @capacitor/assets generate --android --ios --iconBackgroundColor '#faf6ee' --iconBackgroundColorDark '#1a1a17' --splashBackgroundColor '#faf6ee' --splashBackgroundColorDark '#1a1a17'`
