# Apple + Google sign-in through Logto — step-by-step

Status: UPDATED 2026-07-23 — for the IaC pair this is now CODE
(infra/modules/logto.mjs applySocialConnectors; console steps in
infra/README.md Part C). This document remains the manual guide for
the EXISTING prod/staging Logto only, until prod adopts the IaC path.
Originally: PLAN 2026-07-17. All app-side code already supports this —
Logto renders whatever connectors are enabled, and our sign-in flow
(system browser + `munni://auth-callback` deep link on native) is
exactly the flow Google/Apple require. The remaining work is console
configuration with YOUR accounts; nothing here can be done for you.

## Google (do this first — it's 10 minutes)

1. https://console.cloud.google.com → create (or reuse) a project.
2. **APIs & Services → OAuth consent screen**: External; app name
   `munni`; support email; authorized domain `<your-domain>`.
   Publish the app (stays in "production" with basic scopes — no
   verification needed for email/profile).
3. **Credentials → Create credentials → OAuth client ID** → type
   *Web application*:
   - Authorized redirect URI: open the Logto admin console →
     **Connectors → Social → Add → Google** — it displays the exact
     callback URI (`https://logto.<your-domain>/callback/<id>`).
     Paste that.
4. Copy the Client ID + Client secret into the Logto Google connector
   and save.
5. **Sign-in experience → Sign-up and sign-in → Social sign-in** → add
   Google.
6. Test on web + native. Native works because the authorize page opens
   in the system browser (Google refuses embedded webviews — our flow
   already avoids that).

## Apple

Prereq: your Apple Developer membership (same one that signs the app).

1. developer.apple.com → **Certificates, Identifiers & Profiles →
   Identifiers → + → Services ID** (e.g. `me.okkes.munni.signin`).
   Enable **Sign in with Apple** on it → Configure:
   - Primary App ID: the munni iOS App ID.
   - Domains: `logto.<your-domain>`
   - Return URL: the callback URI shown by the Logto **Apple**
     connector (same shape as Google's).
2. **Keys → + → Sign in with Apple** → download the `.p8` once, note
   the Key ID and your Team ID.
3. Logto admin → Connectors → Social → **Apple**: Client ID = the
   Services ID; where asked, the Key ID / Team ID / `.p8` contents
   feed the client-secret generation.
4. Add Apple to the sign-in experience (next to Google).
5. App Store rule: offering Google login on iOS **requires** Sign in
   with Apple too — enabling both together keeps review happy.

## Notes

- Account linking: Logto links social identities to accounts by
  verified email by default — signing in with Google using the same
  address as an existing password account joins them, no data loss
  (identityKey stays the Logto `sub`).
- Staging: repeat the two connector configs in the staging Logto if
  you want social login there too (separate callback URIs).
- Nothing to deploy from the repo — when the connectors are live they
  appear on the hosted sign-in page immediately.
