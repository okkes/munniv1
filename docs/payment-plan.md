# Paying for munni — pay-what-you-want subscription plan

Status: **DESIGN — awaiting approval** (2026-07-22). User principles,
verbatim in spirit:
- No ads, ever. Subscription only.
- **Monthly only — no yearly.** And we SAY why: munni exists to help
  people financially; locking them into a prepaid year is the opposite
  of that. You pay only for the months you actually use, and leaving
  must always feel free. (This is a marketing asset, not a limitation
  — state it proudly on the paywall.)
- **Pay what you want** within a range (RocketMoney model): the user
  picks their own price on a slider.
- A referral loop should reward inviting others.

## 1. Business design

### Pricing model

- Slider: **€2 – €10 / month**, default handle at **€4**. Copy:
  "Pick what munni is worth to you. Every tier gets the same app —
  no feature ladder, no premium lock-outs."
- Same features at every price. Feature-gating by price contradicts
  the "pay for what you use" ethos and triples the QA matrix. What
  the slider buys is honesty; what keeps people paying is the app.
- **Free tier stays real**: offline mode and demo stay free forever
  (they cost us nothing). A SYNCING account is the paid thing —
  bank connections, sync, shared spaces, push are marginal-cost
  features (GoCardless quotas, NAS, support).
- **Trial**: first 30 days free on every new syncing account, card
  optional up front (ask at the end, not the start — pressure-free
  evaluation converts better and matches the brand).
- Cancel = instant, self-serve, no retention flow beyond one honest
  screen ("your data stays; you drop to offline-style local use or
  export everything"). A canceled account keeps read access + export
  forever; sync and bank refresh stop at period end. **OO4 (shipped
  2026-07-24): the "keep using munni offline" option on that screen is
  the real Go-offline conversion** (Global settings → Go offline):
  identity rebind adopting the local store, bank accounts flip to the
  manual tier, per-space snapshot triage — not a degraded mode.
- Lapsed payment → 14-day grace (full function + gentle banner), then
  read-only sync until fixed. Never hold data hostage.

### Why-no-yearly copy (shown on the paywall, all three languages)

> "No yearly plan, on purpose. munni is here to improve your
> finances, not to become another subscription trap. You pay month
> by month, only while it's useful — and if you leave, you leave
> free, with your data."

### Referral loop

- **Give a month, get a month**: your invite link gives the invitee
  an extra free month (60 days total trial); when they convert to a
  paid month, you get one credit month. Credits stack, cap at 12
  banked months; credits pause billing, they never convert to cash.
- Natural surfaces munni already has: split invites and shared-space
  invites ARE referrals — when an invited split member signs up and
  converts, the inviter earns the same credit. No spammy "share to
  unlock" walls; the share moments are organic (you invite people to
  split costs anyway).
- Fraud guards: credit granted on the referred user's first PAID
  month (not signup), one credit per unique payment identity, self-
  referral blocked by payment fingerprint + sub linkage.

## 2. Technical design

### Payment rails

- **Web/PWA: Stripe Billing.** Pay-what-you-want = one Product with a
  metered-free price ladder is wrong; instead ONE subscription Price
  per euro step (2–10 = 9 Prices) OR a single Price with
  `quantity = chosen euros` (1 Price, quantity 2–10 — simpler, picked).
  Stripe Checkout (hosted) keeps PCI scope zero; Customer Portal
  gives self-serve cancel/card change for free. VAT via Stripe Tax
  (NL moss). Webhooks: `invoice.paid`, `customer.subscription.
  deleted`, `invoice.payment_failed`.
- **Native apps: store rules apply.** A subscription bought in-app on
  iOS/Android MUST use StoreKit/Play Billing (30/15% cut) — but
  reader-app-style "sign up on the web" is allowed for us as long as
  the apps don't link to the external paywall (Apple external-link
  entitlements are regional and shifting; we launch with **web-only
  purchase, native apps read entitlement state silently** — the same
  model Netflix used for years). Store IAP can come later as a
  convenience at the same price points (PriceTier product per euro).
- The API is the single entitlement authority either way.

### Server model (new `Billing` area)

- `SubscriptionRow { sub, provider (stripe|appstore|play|credit), status (trialing|active|grace|readonly|canceled), amountCents, currentPeriodEnd, creditMonths }`
- `ReferralRow { code, ownerSub, invitedSub?, state (clicked|signedup|converted), creditedAt? }`
- Endpoints: `POST /billing/checkout` (Stripe session for the chosen
  amount), `POST /billing/portal`, `GET /me/entitlement` (status +
  periodEnd + trial days left — cached client-side, offline-tolerant),
  `POST /billing/webhook` (Stripe signature-verified), referral:
  `GET /me/referral` (my code + stats), invite links gain
  `?ref=<code>`.
- Entitlement enforcement server-side at the expensive edges only:
  new GoCardless/EB consents, sync push/pull, share invites. Reads
  and exports always work (the "leave free" promise).
- Clock skew / offline: entitlement carries a signed `validUntil`;
  the client trusts it offline until +14 days past period end (grace)
  — local-first must not brick in a tunnel.

### Client

- Paywall screen (end of trial + Settings → "Support munni"): the
  slider, the same-features statement, the why-no-yearly block, the
  referral card ("give a month, get a month" + share via the existing
  share sheet). EN/NL/TR from day one.
- Status surfaces: Settings row with plan + next renewal + banked
  credit months; grace/readonly banners reuse the offline-banner
  pattern. Demo/offline identities NEVER see billing UI.
- No dark patterns: no pre-selected higher amount, no countdown
  timers, cancel reachable in ≤2 taps from Settings.

## 3. Rollout slices

- PAY1 Stripe account + Products/Price + webhook endpoint + entitlement
  model & `GET /me/entitlement` (feature-flagged, everyone `active`)
- PAY2 client paywall + settings surfaces + i18n + tests
- PAY3 trial lifecycle + grace/readonly enforcement at the edges
- PAY4 referral codes on split/space invites + credit ledger + fraud
  guards
- PAY5 store-compliance pass for the native shells (entitlement-read
  only), later optional native IAP
- Legal: Terms + refund policy page, VAT registration check (Stripe
  Tax report), privacy page update (Stripe as processor).

## Open questions

1. Range €2–€10 with €4 default — happy with those numbers?
2. Should existing early users get a permanent founder discount/free
   status, and how long is "early"?
3. Trial 30 days (60 via referral) — right lengths?
4. Is read-only-after-cancel generous enough, or should canceled
   accounts keep full LOCAL editing (data forks from sync)?
