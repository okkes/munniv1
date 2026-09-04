# Getting the native apps running — your one-time checklist

Status 2026-07-15: **steps 1–3 are DONE** (repo variables set, native
Logto app created, Firebase json committed + FCM key on the NAS is the
only piece left there). What remains is finishing Play (step 4) and,
later, Apple (step 5).

## 1. GitHub repository variables — DONE ✓

`NATIVE_API_URL`, `NATIVE_PUBLIC_ORIGIN`, `NATIVE_LOGTO_ENDPOINT`,
`NATIVE_LOGTO_APP_ID`, `NATIVE_LOGTO_RESOURCE` are set. The resource is
the **API resource indicator** — the identifier of the API in Logto's
"API resources" (here `https://munni-api.<your-domain>`), which the
app requests access tokens FOR. Same value the web build uses as
`VITE_LOGTO_RESOURCE`.

Every master merge now produces, under **Actions → Native Android →
Artifacts**: `munni-android-debug` (sideloadable APK) and
`munni-android-release` (Play-ready signed .aab).

## 2. Logto — DONE ✓ (with a correction)

You were right to create a **separate Native-type application** instead
of reusing the SPA app — Logto validates redirect types per app kind,
and `munni://auth-callback` only fits a native app. The original
instruction here said otherwise; corrected. `NATIVE_LOGTO_APP_ID` now
carries the native app's id. One follow-up inside Logto: if the API
resource uses role-based access control, grant the native app the same
role as the SPA — without RBAC nothing more is needed.

## 3. Firebase — DONE ✓ (one NAS step left)

`google-services.json` is committed and the shell builds with the FCM
plugin active. Remaining: put the **service-account key** (Project
settings → Service accounts → Generate new private key) into the NAS
`.env` as ONE line, **wrapped in single quotes** (the JSON contains
spaces, which otherwise break scripts that read the file):

```
FCM_SERVICE_ACCOUNT_JSON='{"type": "service_account", "project_id": "munni-fb316", ...}'
```

Keep the `\n` sequences inside `private_key` exactly as Google exported
them. Then redeploy the api container and check
`https://munni-api.<domain>/health` — it reports `"fcm": true` only
when the key parses (project_id + client_email + private_key present).
Until then native devices register fine but receive no pushes.

## 3b. iOS push (added 2026-07-16) — your checklist

The "enable notifications → hangs → stays off" iOS bug is fixed in code
(AppDelegate now forwards the APNs registration callbacks the Capacitor
plugin waits for). For pushes to actually ARRIVE on iOS, Firebase needs
to know the iOS apps:

1. Firebase console → Project settings → **Add app → iOS**, bundle id
   **`app.munni`** → download `GoogleService-Info.plist` and replace the
   committed placeholder at
   `apps/native/ios/App/App/GoogleService-Info.plist`.
2. Repeat for **`app.munni.dev`** → save as
   `apps/native/ios/App/App/GoogleService-Info-Dev.plist` (CI swaps it
   in for the staging build).
3. Firebase console → Project settings → **Cloud Messaging → Apple app
   configuration**: upload an **APNs authentication key** (create at
   developer.apple.com → Keys → “+” → Apple Push Notifications service;
   one key covers both apps).

Until 1–3 are done the app degrades gracefully: registration succeeds
with a raw APNs token, but the server's FCM sender cannot deliver to it.

## 4. Google Play — account exists; three steps left

Signing is fully handled: an upload keystore was generated, lives in
the repo secrets (`ANDROID_KEYSTORE_*`) and as a local copy at
`deploy/env/upload.keystore` (gitignored; password in
`deploy/env/.env.local`). CI already produces the signed .aab.

1. **Create the app** in the Play Console (your Jinbu account): Create
   app → name "munni" → package name will bind on first upload. Note:
   the old `com.okkes.munni.preview` / `com.ashblossom.munni.preview`
   entries are the legacy prototype — this is a NEW app with package
   **`app.munni`**. Also register `app.munni` under the "Android
   developer verification" banner you're seeing.
2. **Upload the first .aab by hand** (Play's API cannot create apps):
   download `munni-android-release` from the latest master Actions run
   and drop it into Internal testing → Create release. Enable **Play
   App Signing** when asked (default) — our key is then just the upload
   key and can be reset if ever lost.
3. **Service account for CI uploads**: Play Console → Setup → API
   access → link a Google Cloud project → create a service account with
   the "Release manager" role → download its JSON key → save it as the
   repo secret `PLAY_SERVICE_ACCOUNT_JSON`. From then on every master
   merge publishes to the internal track automatically.

## 5. iOS — DONE ✓ (TestFlight uploads work end-to-end)

Verified 2026-07-15: archive → cloud signing → TestFlight upload all
green on CI (run 29414308155). Two hard-won requirements are baked into
the workflow: the ASC key must be **Admin** role (see step 2), and
uploads must be built with the iOS 26 SDK — the workflow selects the
newest installed Xcode on the runner because the default is too old.
The steps below are kept for reference / re-setup:

1. **App record**: [App Store Connect](https://appstoreconnect.apple.com)
   → Apps → **+ New App** → platform iOS, name "munni", bundle ID
   `app.munni` (register it as an explicit App ID when prompted), SKU
   `munni`.
2. **API key**: App Store Connect → Users and Access → **Integrations →
   App Store Connect API** → Team Keys → generate, role **Admin**. Note
   the Key ID + Issuer ID and download the `.p8` (one chance!).
   > ⚠ The role must be **Admin**, not App Manager. CI signs the build
   > with a *cloud-managed distribution certificate*, which only an
   > Admin key may create — an App Manager key fails the export with
   > "Cloud signing permission error / No signing certificate 'iOS
   > Distribution' found" (this is what the first TestFlight run hit).
   > Also make sure any pending agreements are accepted under
   > Business / Agreements, Tax, and Banking, or cert creation is blocked.
3. **Repo secrets**: `ASC_KEY_ID` (key id), `ASC_ISSUER_ID` (issuer),
   `ASC_KEY_P8` (the .p8 file base64-encoded:
   `base64 -w0 AuthKey_XXXX.p8`), `APPLE_TEAM_ID` (Membership page).
4. Flip the repo variable **`IOS_BUILD_ENABLED=true`** — the next
   master merge archives, signs and uploads build N to TestFlight.
   (With the variable on but no secrets, CI only does a cheap unsigned
   smoke build.)

Push on iOS additionally needs: Apple portal → Keys → create an
**APNs key**, upload it in Firebase → Project settings → Cloud
Messaging → Apple app configuration (add an iOS app with bundle
`app.munni` there first, and drop its `GoogleService-Info.plist` into
`apps/native/ios/App/App/` — tell me when it exists and I wire it in).

## 5b. Stop the "certificate revoked" emails — automated, no Mac (updated 2026-07-16)

Each CI run used to mint a fresh Apple Development certificate and a
cleanup script revoked the old ones — every revocation triggers an
Apple email. With a persistent certificate in the repo secrets, CI
reuses it and nothing is minted or revoked anymore.

No Mac needed (you don't have one): the **"Mint Apple signing
certificate"** workflow (`mint-apple-cert.yml`, manual dispatch) makes
the key + CSR with openssl, has the App Store Connect API sign it, and
uploads the encrypted `.p12` as a 1-day artifact. The
`APPLE_DEV_CERT_PASSWORD` secret was generated and set already; after a
dispatch, the artifact content goes into `APPLE_DEV_CERT_P12`
(`gh secret set APPLE_DEV_CERT_P12 < APPLE_DEV_CERT_P12.b64`). This was
run once on 2026-07-16 — rerun it only if the cert ever expires
(1 year) or gets revoked.

## 6. The dedicated staging apps (`app.munni.dev`) — your checklist

The code side is DONE: an Android `dev` product flavor and an iOS
bundle-id override build **app.munni.dev** ("munni dev", deep-link
scheme `munni-dev://`) from every dev push — installable side by side
with the production app. It all activates with one switch: the repo
variable **`NATIVE_DEV_CHANNEL=true`**. Until then, dev pushes keep
building the prod flavor as artifacts and publish nothing.

Do these in order BEFORE flipping the variable:

1. **Firebase** (console → project munni-fb316 → Project settings →
   Your apps): **Add app → Android**, package name `app.munni.dev`.
   Then **re-download `google-services.json`** (it now contains both
   apps) and replace `apps/native/android/app/google-services.json` in
   the repo (commit it — tell me and I'll do it if you drop the file in
   the repo root). Without this the dev-flavor Gradle build fails.
2. **Play Console**: Create app → name **"munni dev"** → this app binds
   to package `app.munni.dev` on first upload. Then, like last time:
   download the `munni-android-release` artifact from a dev-branch
   Actions run (AFTER step 1 + the variable are done — or ask me to
   dispatch one) and upload it by hand to Internal testing → Create
   release, enabling Play App Signing. Finally Setup → API access →
   grant your existing CI service account **Release manager** on this
   app too (same `PLAY_SERVICE_ACCOUNT_JSON`, no new secret).
3. **App Store Connect**: Apps → **+ New App** → iOS, name **"munni
   dev"**, bundle ID `app.munni.dev` (register it as a new explicit App
   ID when prompted), SKU `munni-dev`. Nothing else — the same ASC API
   key signs and uploads it; TestFlight builds of the staging app land
   in this record.
4. **Logto** (admin console → the native application): add a second
   redirect URI **`munni-dev://auth-callback`**. (If you later create a
   separate Logto app for staging, put its id in the **staging GitHub
   Environment** as `NATIVE_LOGTO_APP_ID` — see below.)
5. Flip the variable **`NATIVE_DEV_CHANNEL=true`** (repo level, or in
   the staging environment) — the next dev push builds, signs and
   publishes app.munni.dev to its own Play internal track + TestFlight
   app.

**Per-stack configuration lives in GitHub Environments** (Settings →
Environments → `production` / `staging`): dev-branch jobs run in
`staging`, master jobs in `production`, and a variable defined there
overrides the repo-level variable of the SAME name (no more `_DEV`
suffixes). To point dev builds at the staging stack, define in the
staging environment: `NATIVE_API_URL=https://munni-test-api.<your-domain>`,
`NATIVE_PUBLIC_ORIGIN=https://munni-test.<your-domain>`,
`NATIVE_LOGTO_RESOURCE=https://munni-test-api.<your-domain>`.
When a name is absent there, the repo-level (production) value applies.

Export compliance: answered once and encoded — Info.plist carries
`ITSAppUsesNonExemptEncryption=false` ("None of the algorithms": munni
only uses the OS's TLS/crypto), so the TestFlight popup won't return.

## 7. Crash reporting per platform (GlitchTip) — your checklist

CI bakes a GlitchTip DSN into each build, so crashes separate cleanly
by project. In GlitchTip (org **munni** → Create new project, platform
"Browser JavaScript" for the clients, ".NET" for the api), create:

| Project | DSN goes into | Scope |
|---|---|---|
| `pwa-production` | variable `VITE_GLITCHTIP_DSN` | env production |
| `pwa-staging` | variable `VITE_GLITCHTIP_DSN` | env staging |
| `android-production` | variable `NATIVE_GLITCHTIP_DSN_ANDROID` | env production |
| `android-staging` | variable `NATIVE_GLITCHTIP_DSN_ANDROID` | env staging |
| `ios-production` | variable `NATIVE_GLITCHTIP_DSN_IOS` | env production |
| `ios-staging` | variable `NATIVE_GLITCHTIP_DSN_IOS` | env staging |
| `api-production` | secret `NAS_API_SENTRY_DSN` | env production |
| `api-staging` | secret `NAS_API_SENTRY_DSN` | env staging |

DSNs are not secret (client ones ship inside public JS bundles), so
variables are fine; only the api's rides the env render, which reads
secrets — hence `NAS_API_SENTRY_DSN` stays a secret. If a repo-level
`NAS_API_SENTRY_DSN` exists, delete it after adding the env-scoped
ones. Missing/empty DSN = that platform simply doesn't report.

Note the telemetry policy still applies on top: offline/demo identities
never send anything; signed-in users queue crash reports offline.

## 8. Separate Logto apps per platform — prepared

The workflows now prefer per-platform variables and fall back to the
shared `NATIVE_LOGTO_APP_ID` until you create the apps:

1. Logto console → Create application → **Native**, name "munni
   Android", redirect URIs `munni://auth-callback` AND
   `munni-dev://auth-callback` → its App ID becomes repo variable
   **`NATIVE_LOGTO_APP_ID_ANDROID`**.
2. Same again as "munni iOS" → **`NATIVE_LOGTO_APP_ID_IOS`**.
3. Delete the old shared `NATIVE_LOGTO_APP_ID` variable (and the old
   shared native app in Logto once no released build still uses it —
   safest a release cycle later).

Repo-level is fine for these (same app id serves prod + staging;
scope them per environment only if you later want staging-only Logto
apps).

## 9. The LOCAL store channels (added 2026-08-28) — wizard-managed

Every LOCAL ENVIRONMENT is its own store identity beside prod and dev:
**`app.munni.local.<env>`** ("munni <env>", `munni-local[-<env>]://`,
the staging icon) — Android product flavor `local` (own
`src/local/google-services.json` stub; replace it with a real Firebase
download to activate push), rebranded per environment by CI (`sed` over
the stub + shortcuts before the build; iOS generalizes the bundle-id
rebrand the same way, associated domains stripped — the LAN app claims
no universal links; auth returns ride the scheme).

Both native workflows accept `environment: local` + `localEnv: <env>`
(+ Android: `publish: auto|skip`) on dispatch and then build against
the machine's LAN family. The wizard's local track drives everything:
it turns on **LAN mode** — the family re-renders onto REAL https
hostnames `https://munni-<env>.<ip-dashed>.sslip.io` behind one family
Caddy with a locally-minted CA (localhost keeps working alongside;
Enable Banking consents work locally because the redirect is genuine
https) — writes `NATIVE_API_URL`/`NATIVE_PUBLIC_ORIGIN`/
`NATIVE_LOGTO_*`/DSNs into the GitHub environment `local`, dispatches
the build — and DELIVERY GOES THROUGH THE STORES like every other
channel:

- **Android** → Play **internal testing** track, auto-published once
  `NATIVE_LOCAL_CHANNEL_<ENV>=true` (env `local` variable, the wizard's
  per-environment "Enable auto-publish" button; the wizard resolves it
  into the dispatch's `publish` input — until then builds pass with the
  upload skipped, no red runs). The store-mandated first upload stays
  manual ONCE PER ENVIRONMENT: the wizard downloads the signed `.aab`
  from the first green build → Play Console → create app
  `app.munni.local.<env>` → Internal testing → upload → grant the CI
  service account.
- **iOS** → TestFlight, after the one-time App Store Connect record per
  environment (New App, bundle `app.munni.local.<env>`).

Phones must trust the family's CA once per device (download
`http://ca.<ip-dashed>.sslip.io` → install root.crt; iPhone also
enables it under Certificate Trust Settings). The local Android flavor
ships a `network_security_config` that trusts user-installed CAs for
exactly this; hosted flavors stay system-CAs-only.

Caveats, stated in the wizard too: the build bakes the LAN hostnames (a
DHCP change changes them — reserve the address), and it only works on
that wifi. Deleting an environment cascades: containers + volumes, its
GoCardless consents, its vault folder, its auto-publish flag — only the
store apps themselves are manual (the stores have no delete API).

## What works today

The debug APK runs fully offline (demo/offline identities), keeps data
forever (app-scoped storage), uses munni:// deep links, and — once the
FCM key is on the NAS — receives pushes. Native sign-in works as soon
as the app is built with the new `NATIVE_LOGTO_APP_ID` (next master
merge).
