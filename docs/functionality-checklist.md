# munni — functionality checklist

The high-level manual test inventory (#194): the CORE things to walk to
know each feature works — not a changelog. Feature changes update the
affected line (or add one only for a genuinely new core flow); details,
fixes and internals never become items. The rule lives in the
assistant's memory alongside the guide/tour maintenance rules.

## Identity & onboarding
- [ ] Sign in (web + native return), demo mode, offline profile
- [ ] Fresh signup walks onboarding (name, avatar, country) and an interrupted one resumes
- [ ] Session survives restarts; an expired session recovers or says so honestly
- [ ] App lock: set up, unlock with PIN and passkey, disable; a refresh honors the configured auto-lock delay

## Spaces & sharing
- [ ] Create a space (period, currency, start date); edit its identity; switch spaces
- [ ] Invite-lock toggle gates all sharing; invite an existing friend with a role; invite a new person from the members screen (accept joins the space)
- [ ] Members: view, change role, remove; the removed member is told once and lands in another space; a read-only member keeps pulling quietly (no eviction popup, writes park)
- [ ] Leave a space; history start date moves with honest consequences

## Home
- [ ] Balance band modes and per-account picks; blocks render, reorder, hide; a sparse desktop home centers one wider column
- [ ] Quick-add FAB reaches all six doors
- [ ] Review nudge, new transactions, upcoming costs and notifications reflect reality; see-all lands on the Upcoming page (recurring + loan dues together)

## Transactions
- [ ] List: search (title + amount, highlighted), quick filters, filter sheet; filters survive a detail detour
- [ ] Transfer pairs collapse to one row; per-account view keeps both legs
- [ ] Add/edit a manual transaction end to end (amount math, account, category, counterparty — required for movement categories, date guard)
- [ ] Detail: recategorize, rename, counterparty set/remove, recurring/event links, notes, receipt, customize sections, delete
- [ ] Split a transaction into parts; edit parts; un-split; split categories (€ and %) on rows and parts
- [ ] Reimbursements: link both directions (with clamping errors), parts included; unlink restores

## Review
- [ ] Walk the queue: category, counterparty (movement confirms require one), counter-transaction, recurring, event, notes, split — confirm and skip
- [ ] Memory pre-fills return; bulk "apply to similar" applies what it promised; the per-sibling counter queue holds the deck and counts down

## Categories
- [ ] Browse and search the picker (parent names match, ◆ filter); manage: create/edit/delete customs with impact warnings; locked families refuse subs
- [ ] Account-typed rows only offer categories that fit

## Recurring & debts
- [ ] Detection inbox → accept walks the occurrence review; linked charges take the category
- [ ] Ranges (period/next/year) tell the truth; the year chart plots paid-to-now and estimate-from-now with tappable dots
- [ ] A loan account shows debt, plan, payments and payoff; lender detection lands on Debts

## Accounts & banks
- [ ] Global overview: two segments — the global pool and collapsible per-space cards (closed by default); defaults fold, echoes jump to the real row, archived shares say who stopped sharing; an unattached account offers "Attach to this space"
- [ ] Connect a bank (choice, consent, callback, nightly fetch, reconnect); imports (bank chooser, preview, progress, result → explicit attach); an import beside a bank link stays its OWN account until the explicit merge (which runs the reconcile)
- [ ] Attach/detach per space with type (the attach door lands on the final step; shared spaces warn before attach); rename locally vs globally; type change re-reviews that space only
- [ ] Edit an account (a manual balance edit records an adjustment transaction); delete manual and bank-fed accounts cleanly

## Plans (budgets, goals, allocation, events)
- [ ] Budget lifecycle: create with categories, thresholds warn, carry-over works
- [ ] Goals fund and progress; allocation envelopes fill per period
- [ ] Events: create, attach transactions (select-all screen), per-day costs and drill

## Portfolio, insights & receipts
- [ ] Holdings buy/sell and valuation; overview/trends/insights drill correctly
- [ ] Receipt capture (camera/webcam/upload) links to transactions; shopping connections pull receipts

## Splits (bill splitting) & friends
- [ ] Split session with a friend end to end (invite, expenses, settle)
- [ ] Friends: add by ID, accept, profile sheet (copy ID, remove)

## Settings & platform
- [ ] Space settings rows all lead somewhere sane; global settings: profile (account deletion narrates its progress), devices, language (EN/NL/TR), appearance cycle, export, push, tips
- [ ] Scrolling a search list dismisses the keyboard; multi-field forms keep it while scrolling
- [ ] PWA installs and updates; native shells build, deep-link back and capture photos
- [ ] Native deployment from the wizard: Android/iOS feature toggles; hosted track dispatches CI + downloads the signed .aab/.apk artifacts in-page for the store-mandated first upload; local track = LAN mode (family on https://munni-<env>.<ip-dashed>.sslip.io hostnames behind one local-CA Caddy — real https, so Enable Banking consents work locally; localhost twin kept for sign-in/CORS; CA download at http://ca.<base> for phones) + a store channel PER environment app.munni.local.<env> — CI builds against the GitHub environment `local` (localEnv + publish inputs; per-env NATIVE_LOCAL_CHANNEL_<ENV> gate, first upload manual once per env, skipped-not-red until then) and delivers via the Play internal track and TestFlight
- [ ] Vault secrets grouped in per-environment folders (shared/prod/…): plain item names, folder = environment; every item carries an explanatory note (what it is for, wizard-generated vs operator-entered, rotation); re-sync refreshes, environment delete drops its folder + its GlitchTip org
- [ ] Admin portal + munni-control distinguish "not on the admin list" (a real 403) from an unreachable/blocked API (network/CORS/5xx get their own message)
- [ ] Delete everything forgets the environments completely (registry + per-env stores; production included) — Set up & start recreates production automatically; master buttons follow the family state (no Delete/Stop before anything exists, Set up disabled while everything runs)
- [ ] Certificate trust is part of setup, not a separate card: Set up/LAN-on installs the family root on this PC automatically (one Windows consent); phone install hints live in the Android/iOS cards
- [ ] Store readiness is polled, not clicked: with the step-3 Play service account / ASC key stored, the wizard detects the one-time manual store upload by itself and flips per-env auto-publish (no Enable button)
- [ ] The local Android app trusts the family CA out of the box (CI bakes the machine's root into the build via NATIVE_FAMILY_CA_PEM); phone-side root.crt install is only for browser use — INCLUDING the sign-in hop (OIDC opens the system browser, which ignores the app's bundled anchor) — and for iOS; the wizard prints the exact dashed ca.<ip-dashed>.sslip.io link
- [ ] LOCAL builds show a "Trust this network's certificate" button + hint on the login screen (EN/NL/TR; derived from the sslip public origin, absent everywhere else); the ca site serves root.crt as an application/x-x509-ca-cert attachment so phones download it for the installer instead of rendering PEM text
- [ ] A nonexistent repo name is created as a fork (different owner) or a template-generate copy (same account — forks cannot land in their own account), all branches included
- [ ] Hosted web/admin read their config at runtime (/runtime-config.js from container env) — one public image serves prod, staging, the iac pair and the local stacks, each pointing at its own API/Logto/GlitchTip
- [ ] Operator consoles are two separate apps: the admin PORTAL (per environment: users, diagnosis, admin grants, own-env bank consents with foreign-count note, quota) and the munni-CONTROL cockpit (shared level: every environment's consents grouped by origin, read-only, plus quota/health) — control never offers delete, the portal refuses deleting another environment's consent
- [ ] Local family: shared services (GlitchTip with its own db, https vault behind a local-CA Caddy, OCR, control, pgAdmin over every server) + ANY number of environments from the wizard's registry (+ Add with a 2-5 letter name and a dev/main release channel; prod slot 0 and dev slot 1 are the defaults) — each env has its own Logto AND its own uniquely-named postgres under its own password (plain "postgres" must never register on the shared network: service names collide across envs there); env cards are state-aware (Start OR Stop), shared always runs (only Stop/Delete everything touch it), deleting an env purges its GoCardless consents and forgets it
- [ ] The local network mode is fully automatic (no manual LAN/localhost buttons): plain localhost is the default; ticking Android/iOS/Enable Banking flips the family to LAN https (and starts the CI build for native, queued until GitHub connects when needed); unticking them all drops it back to localhost — reconciled on toggle and once per wizard load. LAN-on also installs the family CA into this PC's user store via certutil (one Windows consent; redo button on the card)
- [ ] Offline end to end: everything works, syncs on return, conflicts converge
