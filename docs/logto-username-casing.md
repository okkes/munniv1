# Logto username auto-capitalization — advice (2026-07-24)

Problem: on mobile, the Logto hosted sign-in capitalizes the first
letter of the username field (OS keyboard autocapitalize), and users
who typed `okkes` at sign-up then fail to sign in as `Okkes`. The
hosted UI offers no knob to disable autocapitalize on that input.

Options, ranked:

1. **RECOMMENDED — treat usernames as case-insensitive at the edge.**
   Logto itself stores usernames case-sensitively and its hosted UI
   can't be patched, but sign-IN identifiers can be normalized before
   they reach it in our native/PWA flows: our `native-auth` and web
   sign-in entries pass the identifier along — lowercase it there, and
   lowercase at REGISTRATION too (Management API hook or a one-time
   migration lowercasing existing usernames; you have few users, this
   is a five-minute migration). Result: `Okkes`, `okkes`, `OKKES` all
   work, nothing user-visible changes.
2. **Switch the primary identifier to email.** Email fields don't get
   autocapitalized by mobile keyboards, and Logto supports
   email-or-username sign-in simultaneously — enabling email sign-in
   sidesteps the problem without removing usernames. Slightly bigger
   account-settings surface (email verification flows).
3. **Custom sign-in UI** (Logto "bring your own UI"): full control,
   including `autocapitalize="none"`, but we'd own the whole auth
   surface — password reset, error states, WebAuthn later. Too much
   for this bug.

Decision (user, 2026-07-24): **option 1**. Shipped: admin endpoint
`POST /admin/logto/lowercase-usernames` — a one-shot Management-API
migration lowercasing every existing username (collisions skipped and
reported, never merged). Run it once from the admin console/curl after
deploy. Caveat kept honest: the HOSTED sign-up UI cannot be patched, so
a future user registering `Okkes` would reintroduce a mixed-case name —
rerun the endpoint, or revisit option 2 (email sign-in) if it recurs.
