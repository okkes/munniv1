# Redirect flows — the unified best-practices plan

Status: **APPROVED** (2026-07-22). User mandate: *"best practices come
first, user experience second"* — for EVERY redirect in the product
(login, logout, bank consent), on native, PWA and web, we implement
the platform-sanctioned mechanism and accept whatever system UI that
brings. This document supersedes the earlier popup-only scope.

## Why the popup survived (context)

The universal-link work fixed WHICH app answers — but not the popup.
Two iOS rules make the Safari-redirect login structurally popup-bound:

1. **Universal links need a user tap.** Logto's return to
   `/native-auth` is a server redirect chain; iOS deliberately does not
   auto-open apps from redirects/JS navigations (anti-hijack).
2. **Same-domain links never universal-link.** The hosted page's
   custom-scheme bounce (`munni-dev://native-auth…`) always gets the
   "Open in …?" confirm.

Right app ✓, popup ✗ — unfixable inside a Safari-redirect flow.

## The redirect matrix (policy of record)

RFC 8252 (OAuth for Native Apps) is the governing best practice: native
apps MUST use an external user-agent, never a webview, and SHOULD use
the platform's dedicated auth session API.

| Flow | iOS native | Android native | PWA / web |
|---|---|---|---|
| Login / logout | `ASWebAuthenticationSession` (system auth sheet, shares Safari cookies, callback scheme handed straight back — no end-of-flow popup; one system consent alert at start is the sanctioned trade) | Chrome Custom Tabs (`androidx.browser`) + scheme callback — no confirm dialogs at all | Full-page same-tab OIDC redirect (no popups — popup flows fight blockers and mobile browsers) |
| Bank consent (GoCardless / EnableBanking) | System browser via `openUrl` — NOT the auth session: PSD2 app-to-app requires the bank page to be able to hand off to the bank's own app, which auth-session sheets suppress. Return = universal link `/gc-callback` (the bank's "return to munni" is a real user tap, so it opens the app directly) | Same: external browser / bank app, return via App Link `/gc-callback` | Same-tab redirect out, same-tab return to `/gc-callback` inside the PWA scope |
| Invite / join links (`/splits/join`) | Universal link (external tap — exactly what ULs are for) | App Link | Normal navigation |

Principles the matrix encodes:
- **Auth session APIs for first-party auth, external browser for
  third-party (bank) auth**, universal/app links only for flows that
  begin with an external user tap.
- Never a webview for credentials (RFC 8252 §8.12); never a popup
  window on web.
- Callback URLs are scheme-based on native (`munni(-dev)://…`) and
  path-based on web — both derived from the channel config
  (`config.ts` nativeScheme), never hardcoded.

## Slices

- NA1 **Capacitor plugin**: ~60-line Swift `AuthSession` plugin
  exposing `start(url, callbackScheme) → Promise<callbackUrl>` via
  ASWebAuthenticationSession (`prefersEphemeralWebBrowserSession:
  false` so the Logto cookie persists → subsequent logins are
  instant). Android twin on Custom Tabs — same JS API.
- NA2 **Web wiring**: on native, `signIn` builds the Logto authorize
  URL with redirect `munni(-dev)://auth-callback` and runs it through
  the plugin instead of navigating the webview; the returned callback
  URL feeds the existing `NativeCallbackScreen` handleSignInCallback
  path unchanged. Sign-out same shape (end-session in the session,
  callback `…://signed-out`).
- NA3 **Bank-consent audit**: verify GC/EB consent launches use
  `openUrl` (not webview navigation) on both platforms and that
  `/gc-callback` returns land via universal/app link into the running
  app; fix any drift. Web stays same-tab.
- NA4 **Cleanup**: the hosted `/native-auth` scheme-bounce stays as
  fallback for old builds, then retires; drop `/native-auth` from the
  AASA once no old build matters (`/gc-callback` and `/splits/join`
  stay — external-tap flows are where universal links shine).

Carried over from the (retired) universal-links plan — one pending
user action: the **app.munni.dev** Play app's own signing-key SHA-256
(Play Console → App integrity) still needs adding to
assetlinks.dev.json for Play-installed dev builds.

Result: login never leaves the app and ends popup-free on both
platforms; bank consent keeps full app-to-app capability; web keeps
plain redirects everywhere.
