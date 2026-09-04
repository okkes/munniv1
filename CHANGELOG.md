# Changelog

## [2.27.0](https://github.com/okkes/munnimok/compare/v2.26.0...v2.27.0) (2026-08-02)


### ✨ Features

* **accounts:** device-batch 2 — counterparty create door, space-accounts redesign, Mina wrap fix ([fece21a](https://github.com/okkes/munnimok/commit/fece21a9a34fb4036f4cc6ab361b2af66ff5e647))
* **accounts:** edit manual accounts in place, choose the balance sign, account picker field ([784bc92](https://github.com/okkes/munnimok/commit/784bc924ec0c5e8a753d67ab1766564fb1843f68))
* **accounts:** name the two account screens by scope (arc 9) ([ad82cdb](https://github.com/okkes/munnimok/commit/ad82cdb979a46dd21d3ac8cc69a96ea97214e335))
* **auth:** multiple offline profiles + Mina's second-world ask (arc 8) ([398aecb](https://github.com/okkes/munnimok/commit/398aecb6c497afff4f5895fdcb2d28252ce81610))
* **cats:** locked transfer-family doors with sign-picked subs (arc 2 core) ([498d274](https://github.com/okkes/munnimok/commit/498d27473d5d05f4de6adeff15687cfd0be24426))
* **cats:** the "no counter account" exit + family-sub back-fill (arc 2 finish) ([191eb87](https://github.com/okkes/munnimok/commit/191eb87597d7e22b51913480b17aa67fb99e2598))
* **debts:** loans v2 — the liability account IS the debt ([f8ad48b](https://github.com/okkes/munnimok/commit/f8ad48b3be29fe6950c377482c08e973403915df))
* **debts:** merged Loan form, payment cadence + estimates, unassigned bucket (arc 3) ([a03839a](https://github.com/okkes/munnimok/commit/a03839a558a2af46f1f18f6c3005ecabdd07b384))
* **loans:** balance coupling + payment matching; band modes; tutorial and desktop fixes ([c09994b](https://github.com/okkes/munnimok/commit/c09994b24c19957f237a3eadcdd8bef348c5befc))
* **notifs:** in-app notifications center + bell badge (arc 6) ([22b74ee](https://github.com/okkes/munnimok/commit/22b74eee67a084302adebc2eb3e160722019b955))
* **recurring:** detection reads past the start date; 2-year bank history; GlitchTip triage ([accbae1](https://github.com/okkes/munnimok/commit/accbae1e281dd455c28bdbfc8d0686e13820c7cf))
* **spaces:** full create form + private invite lock (arc 4) ([a5570eb](https://github.com/okkes/munnimok/commit/a5570ebc2970bcabc7bbf6be43a6752ed6cb7f14))
* **spaces:** per-space attention pills + avatar dot (arc 7) ([66f554e](https://github.com/okkes/munnimok/commit/66f554e6c53b815ca7df3029df8683d3b9e2bcf0))
* **spaces:** start-date mechanics — gate, counted moves, refusal (arc 5) ([9344b6d](https://github.com/okkes/munnimok/commit/9344b6dc998d806a4638768cf220208abd4dc4e7))
* **tx:** the FUNDING type - money to/from another space's pot ([42950c7](https://github.com/okkes/munnimok/commit/42950c73db9f9030e79795d938ce07eba79a9f11))
* **tx:** the pair is ONE row - collapse, mirror write, peer row, unpair (arc 1) ([9eebded](https://github.com/okkes/munnimok/commit/9eebdedc04a9062406fe46793bb33563d313a09a))
* **tx:** transfer legs pair up - the matcher spans spaces (arc 1 slice 1) ([bc69c2b](https://github.com/okkes/munnimok/commit/bc69c2bba895f0d928d3f12edb10b9501113a93b))
* **ux:** device-batch 2026-07-29 - debt surfaces, handoff ask, tour hardening ([b70b4d6](https://github.com/okkes/munnimok/commit/b70b4d68b2e3569792e109e237bfe75aa6cffb04))


### 🐞 Bug Fixes

* **app:** device-batch 3 — sign-safe predictions, wheel gesture, dirty guard, Mina locks ([83d5d6f](https://github.com/okkes/munnimok/commit/83d5d6fef7036e74ee99eb9c433c2ad6ed80efe5))
* **auth:** never wipe fresh Logto keys after login; self-heal tokenless 401s ([1ac2fc6](https://github.com/okkes/munnimok/commit/1ac2fc6a3f1698a3af58e93fcb314c734de91ae6))
* **core:** device-batch 1 — start-date gate on imports, funding as transfer member, debt catalog, sheet gestures ([6346d21](https://github.com/okkes/munnimok/commit/6346d21cda4b7d11f5b5ddb34c910fc734e19260))
* **mina:** pick-step double-advance, sheet-closed self-heal, glow travel; weekly nudge throttle ([15bf084](https://github.com/okkes/munnimok/commit/15bf084d204c9763e522463ed2a4b8e86788316a))
* **tx:** release the transfer peer from the store, not the live snapshot ([dc839c6](https://github.com/okkes/munnimok/commit/dc839c6f1daebd65ef54fc7f5ed63295fb04561f))
* **ux:** list sheets drag via header only; iOS keyboard slack; search reveal tuning ([3309733](https://github.com/okkes/munnimok/commit/3309733eb7d396884682db8381bc965f6988827a))

## [2.26.0](https://github.com/okkes/munnimok/compare/v2.25.0...v2.26.0) (2026-07-28)


### ✨ Features

* **accounts:** mirror server-side space links the client never saw ([df68e25](https://github.com/okkes/munnimok/commit/df68e2584320a989350131f53739e2750a692cb6))
* **accounts:** the global overview says where every account lives ([8ce46f8](https://github.com/okkes/munnimok/commit/8ce46f8a9efabedcc9fc937cc529a9b3138a2615))
* **debts:** a debt is always backed by a loan account ([6385f58](https://github.com/okkes/munnimok/commit/6385f58e673b3a37191dbf9a6ffd43b554c084cc))
* **debts:** payments derive from the backing account; weekly rate nudge ([b362f62](https://github.com/okkes/munnimok/commit/b362f62962190bf993fd72b0bb781a261824574c))
* **debts:** the recurring form's Debt kind hands off into debt creation ([f25378e](https://github.com/okkes/munnimok/commit/f25378e2e1f16aa7b6e7f48e1a7a8b9a1d450a08))
* **recurring:** recurring costs own a category and re-file their transactions ([600fb12](https://github.com/okkes/munnimok/commit/600fb125876487c53daa85c23f0c08b7c3d68f56))
* **recurring:** the category lock reaches review, detail and linking ([10fd3ec](https://github.com/okkes/munnimok/commit/10fd3ec1acd20eae52e52ba6a2f3e04bc964ea8e))
* **tx:** full account setup door in the transfer counterparty picker ([7186e40](https://github.com/okkes/munnimok/commit/7186e40d6658a5c419bd185c00e20927d4e675aa))


### 🐞 Bug Fixes

* **accounts:** import preview matches manual accounts again + e2e follows the space door ([b611435](https://github.com/okkes/munnimok/commit/b611435b94a82698d55225b5ffe554a1ec6decec))
* **mina:** onboarding-kill dormancy, cleanup rework, rounded instant shade ([08e10f4](https://github.com/okkes/munnimok/commit/08e10f4e4af567b043b31764a32e132ea70d5b31))
* **sonar:** unnest diagnose template literals, cover the probe path ([984c539](https://github.com/okkes/munnimok/commit/984c53918a2528e61096a59d2d18c5eeb83ee3e2))

## [2.25.0](https://github.com/okkes/munnimok/compare/v2.24.0...v2.25.0) (2026-07-28)


### ⚠ BREAKING CHANGES

* **ui:** replace vaul with react-modal-sheet as the sheet engine

### ✨ Features

* **mina:** design pass from the first device run -- glow, travel, no overlap ([0e9e227](https://github.com/okkes/munnimok/commit/0e9e227eb5eb54dc75cf13c143318feea4d4d017))
* **mina:** retire the welcome tour, help-index replay, Mina test suite ([5e0e52f](https://github.com/okkes/munnimok/commit/5e0e52f1fc21241b26f3be22e99d80af8477225d))
* **mina:** tutorial engine + no-space first-run (M1-M4 core) ([d231e56](https://github.com/okkes/munnimok/commit/d231e56248b4a46e8c3fb00e970591db49426b3f))
* **tx,review,ui:** device-run batch 3 -- reimb link screen, iOS fixes, invariants ([d94ec8a](https://github.com/okkes/munnimok/commit/d94ec8a803b482eaae5fade6687e992a92a7f5ee))
* **tx:** simplified kinds -- standard / transfer / adjustment ([756e351](https://github.com/okkes/munnimok/commit/756e351666eaaef540a96129247e4b8b6029bb29))


### 🐞 Bug Fixes

* **deps:** update android minor & patch ([#104](https://github.com/okkes/munnimok/issues/104)) ([a1a0887](https://github.com/okkes/munnimok/commit/a1a088788aacad50acd524fb8afc953b232e3fb2))
* **mina,review,ui:** quick batch 4 + v2.25.0 what's new ([7b377ff](https://github.com/okkes/munnimok/commit/7b377ff5ff5f184cafd0224e882981a0ea29b0fe))
* **mina,tx,ui:** second device-run batch -- resume, act race, reimburse rules ([6ec7014](https://github.com/okkes/munnimok/commit/6ec70148057f1c3c0d326446345f80f2551c9678))
* **mina:** publish the space-name suggestion synchronously ([f260158](https://github.com/okkes/munnimok/commit/f260158498b0a9a73dab181e4174953dec84cc32))
* **mina:** re-entrant bootstrap ambush + e2e passage through the tutorial ([9b2e930](https://github.com/okkes/munnimok/commit/9b2e930ea0c4e6fe1b84eab11d7a44729145f1fb))
* **mina:** teach space switching from Home, not the manage screen ([b118483](https://github.com/okkes/munnimok/commit/b1184830de2661a1c7d8efc3340542e1731bb3ac))
* **sync,ui:** import purge race (DATA LOSS) + sheet/dialog structural fixes ([db7e7ec](https://github.com/okkes/munnimok/commit/db7e7ec25280babde8e80ded0aaace51a4aa727e))
* **ui:** open sheets to their full height on iOS (WebKit flex basis) ([afc8a84](https://github.com/okkes/munnimok/commit/afc8a8476c5e9548a7e220ed21647f7a83ee5177))
* **ui:** open sheets to their full height on iOS (WebKit flex collapse) ([4dde757](https://github.com/okkes/munnimok/commit/4dde757bd28553de35f2fb9d442a803a02cf444a))


### 🧹 Chores

* pin the next release to 2.25.0 ([25208e4](https://github.com/okkes/munnimok/commit/25208e422c2bd6a9f3c8cef2f681059fa501066e))


### ♻️ Refactoring

* **ui:** replace vaul with react-modal-sheet as the sheet engine ([ee6cff0](https://github.com/okkes/munnimok/commit/ee6cff05e9df287606bd08e884ad231065669091))

## [2.24.0](https://github.com/okkes/munnimok/compare/v2.23.0...v2.24.0) (2026-07-25)


### ✨ Features

* **accounts:** import batches with uploader attribution + per-batch rollback; master plan ledger ([1fccf5d](https://github.com/okkes/munnimok/commit/1fccf5d3fbb5d01d6acb0b3121529a34eabecc6a))
* **accounts:** imported-vs-linked reconciliation -- the connection is the truth ([3b8f263](https://github.com/okkes/munnimok/commit/3b8f26394e5ae8fb509805c50475fd2a89d1cc13))
* **accounts:** say where imported data ENDS, not just when it arrived ([1633f26](https://github.com/okkes/munnimok/commit/1633f26abf88bfd73322ed8a16568853510c4022))
* **activity:** complete the space history — every user mutation logs ([bedc473](https://github.com/okkes/munnimok/commit/bedc4731ed5032b2e5775d6574e816587139b3a8))
* **cats:** locked reimbursement tree -- step 1 of the reimbursement redesign ([7e59591](https://github.com/okkes/munnimok/commit/7e5959152e5646db323fbd4edf7373313b31a962))
* **cats:** restore the pre-replacement drag-to-move design ([4364e0c](https://github.com/okkes/munnimok/commit/4364e0c1870e5d8b4f4040858a73a205872391ac))
* **devices:** logged-in devices -- see, rename, remotely disconnect (wipe) ([541a390](https://github.com/okkes/munnimok/commit/541a390e4f43d04d16e5834a7b3d1ee404f0af41))
* **help:** guided welcome walkthrough -- real screens, real writes, act-steps ([599980e](https://github.com/okkes/munnimok/commit/599980e6654cc9ea764c62f8412138a3a7bb21dc))
* **reimburse:** keep the locked tree out of budget/trends pickers; guide mentions the redesign ([33dd5c7](https://github.com/okkes/munnimok/commit/33dd5c75df74b81e7d5c41c3a66f4df347b49244))
* **reimburse:** settled value becomes an explicit `reimbursed` slice -- redesign steps 2-5 ([018571d](https://github.com/okkes/munnimok/commit/018571d99fffddfc69601fd6216e36cead2a6c78))
* **sheets:** gesture plan phases A+B + desktop grow-from-source dialog ([2f8c4f3](https://github.com/okkes/munnimok/commit/2f8c4f3fdb93e889d3e7627f6e9f513dcdd3a14b))
* **statements:** PayPal activity-export importer + speak-up apply cycles ([3b5bc55](https://github.com/okkes/munnimok/commit/3b5bc55d0c579ea6f89bf5f7900df5f84dcbe811))
* **sync:** client-server version handshake -- refuse to sync across a contract mismatch ([24b9c19](https://github.com/okkes/munnimok/commit/24b9c19f888f1ec83bcc03c5bb86e7220af04d0c))
* **ui:** edge-swipe back, drag-linked sheet zoom, sticky sheet drags, animated overview bar ([d3ec081](https://github.com/okkes/munnimok/commit/d3ec081ad64217776a51277b11fb7062acfa406d))


### 🐞 Bug Fixes

* **api,accounts:** attach raced its check-then-insert; import button now guards double-taps ([d15fb05](https://github.com/okkes/munnimok/commit/d15fb05e043af4e08e0fbeb07074397fb27ea720))
* **api,app:** import failures root-caused + feedback batch ([fdb6e13](https://github.com/okkes/munnimok/commit/fdb6e1300d27633d7c3b60b30a32d6e214b8863a))
* **api:** explicit ordinal already-lowercase check (CA1862) ([dc0ac6b](https://github.com/okkes/munnimok/commit/dc0ac6b564938e34d35726a0751e4c80e957ba32))
* **app:** hoist the device-revoked wipe handler (S2004 nesting) ([3011edb](https://github.com/okkes/munnimok/commit/3011edb7bb90d2c90893a2816d1335573bf35d81))
* **deploy,sheets:** staging stamp used master SHA; restore the touch guard our keyboard fix disabled ([1aa6ab5](https://github.com/okkes/munnimok/commit/1aa6ab5927129250011d0c72ef4daa9b3f7ba240))
* **deploy:** stamp NAS bundles with the image-building commit, not the default-branch tip ([#100](https://github.com/okkes/munnimok/issues/100)) ([1a5a0c3](https://github.com/okkes/munnimok/commit/1a5a0c3146e2d2d95e08b0b425044e23f46ca413))
* **tests:** valid AccountSource in batch-rollback seed ([81aceb5](https://github.com/okkes/munnimok/commit/81aceb58c5e93f65987f7d70440bfac9538a8bb6))

## [2.23.0](https://github.com/okkes/munnimok/compare/v2.22.0...v2.23.0) (2026-07-24)


### ✨ Features

* **recurring:** the amount is the user's — drift becomes a one-tap recommendation ([c5c2c62](https://github.com/okkes/munnimok/commit/c5c2c62e602adc362f73740d7a2a7f06aa6b9703))
* **tx:** quick-add prefill + reliable auto-link; multi-file imports; patient e2e onboarding wait ([4acaa42](https://github.com/okkes/munnimok/commit/4acaa42d094ca7b248090a6da03d6f3a6b95ab34))


### 🐞 Bug Fixes

* **e2e:** 240s budgets for every multi-user spec — cold-stack double onboarding outlives 120s ([7a9c19f](https://github.com/okkes/munnimok/commit/7a9c19fb87afa7876e85bd1c674d7b30c94b51fb))
* **e2e:** deterministic onboarding wait in the shared base() helper ([7481eec](https://github.com/okkes/munnimok/commit/7481eec04ade82a8a8f8e50712638cf6a7d26b0f))
* **e2e:** fill-until-armed onboarding passage — a fill racing first hydration under CPU starvation left the field empty and the click waiting forever ([1ce9be4](https://github.com/okkes/munnimok/commit/1ce9be4f815c3ca0040e003a28818ec14846c1a1))
* **e2e:** race onboarding vs home in base() — cold-start first paint outlived the 3s guess ([9f07467](https://github.com/okkes/munnimok/commit/9f07467578972f5de2e6cb33d6e53e7bac572825))
* **e2e:** the onboarding race keyed on the WRONG signal — tab bar lives outside DataProvider ([81ff54e](https://github.com/okkes/munnimok/commit/81ff54e8e5db87ea193c2da512024415009c63b8))
* **perf:** one shared display-currency lens (per-row hooks melted sync-time perf); iOS uploads always run, daily cap degrades to a warning ([4868b62](https://github.com/okkes/munnimok/commit/4868b62ca7ffd4fa383c3ec1471601b41f0053a7))

## [2.22.0](https://github.com/okkes/munnimok/compare/v2.21.0...v2.22.0) (2026-07-24)


### ✨ Features

* **accounts:** AE1+AE3 — the one intent-routed Add-account chooser everywhere ([97ac745](https://github.com/okkes/munnimok/commit/97ac7457cb6decda20cf5c8d81578df9383b12fa))
* **accounts:** three account tiers — manual tx only on manual accounts, space-scoped creation, provenance labels ([a7eddaf](https://github.com/okkes/munnimok/commit/a7eddaf7b6ede99c66fa378882f31b3dea6b95b7))
* activity history prunes 200 rows or 90 days; onboarding country defaults from IP for signed-in users ([48b59b9](https://github.com/okkes/munnimok/commit/48b59b96f11c010e24a26f32acd7e605e6b49f8c))
* **activity:** per-space action history — last 200 who-did-what rows in the bell ([1f847f8](https://github.com/okkes/munnimok/commit/1f847f829e1723c8d813650f160d41af7e8f2f40))
* **auth:** go-offline always deletes server data (login survives), remote-wipe for other devices; danger zone moves to profile ([81852fa](https://github.com/okkes/munnimok/commit/81852fa8b0ebb28be383a6895840489b590ca71b))
* **auth:** offline profile can be deleted — data, lock config and registry, danger-confirmed ([170793b](https://github.com/okkes/munnimok/commit/170793b26e54678a1411a6e17298e41d9c99b11f))
* **auth:** online → offline conversion — identity rebind, consent screen, manual-tier flip (OO1-OO4) ([0ec7429](https://github.com/okkes/munnimok/commit/0ec74299e7eda4c5bfd030a53cd7e83465dcff70))
* **cats:** drag-to-move restored — custom subs drag onto another main with ghost + target highlight ([bfbca86](https://github.com/okkes/munnimok/commit/bfbca86dc71aa39a41c88c29ba576e902001dc60))
* **currency:** CD4 — lens across all money surfaces + band quick toggle; AE2 attach offer; AE4 vocabulary ([9adab43](https://github.com/okkes/munnimok/commit/9adab43b0aea5bad7b9ea36d43bd74c73aac85ab))
* **currency:** display-currency lens — ECB rates, user-level preference, ≈ everywhere it converts ([b15505e](https://github.com/okkes/munnimok/commit/b15505ebdfc51efadb6c8d8343389b92676e54ba))
* **encryption:** E3a cipher proof + verify probe, E3b encrypted-by-default for fresh native installs ([ae0a13a](https://github.com/okkes/munnimok/commit/ae0a13a4be9ec4538801cb19f1e4b022a247267f))
* **encryption:** E4 — SQLCipher always-on for native, Dexie copy-migration; Sonar hotspots resolved; green see-all ([de20bb5](https://github.com/okkes/munnimok/commit/de20bb57b37978ccb362c2ba78f848ef379b70fa))
* **help:** space-accounts tutorial — three account tiers, slides + live walkthrough ([8f96887](https://github.com/okkes/munnimok/commit/8f96887d63fe68260b225f2205439edf3d1938de))
* **import:** ING exports fully supported — bilingual, all five shapes, balance files, format picker ([13d152e](https://github.com/okkes/munnimok/commit/13d152e1bcf0e6c2fba4e82046ae4e56d5e52309))
* **infra:** domain as secret, Logto social connectors as code, baby-steps README, secrets-access plan ([305c787](https://github.com/okkes/munnimok/commit/305c787022c68aaad4965f30b83cd5f02681aa19))
* **infra:** DSM v7 auth with SynoToken; cert automation settles on acme.sh synology_dsm hook ([76ac147](https://github.com/okkes/munnimok/commit/76ac147f98019287ed1b38480549df5bfefa1db4))
* **infra:** IaC runs in GitHub Actions + DSM reverse proxy as code ([2bb2318](https://github.com/okkes/munnimok/commit/2bb23185ea3276cae0c112c4e67dc265f1fcb336))
* **infra:** Logto sign-in screen branded as code — munni logo + brand color ([cc44d61](https://github.com/okkes/munnimok/commit/cc44d61e33bc5cfbd845e63805af1998aab72d6f))
* offline two-step screens + single profile, activity actor names, detach-loss warning, account currency pick ([a4590bf](https://github.com/okkes/munnimok/commit/a4590bf949ae501994f1f59c2b12fdb9b0c32971))
* **onboarding:** one first-run setup for online AND offline — profile, language, country of use, avatar, lock ([8fc3311](https://github.com/okkes/munnimok/commit/8fc3311598f4ea88785b0ba27c708fa75bcf30c2))
* **settings:** restructure settings — space card header, profile to global, period/currency/history as own settings ([a7737fe](https://github.com/okkes/munnimok/commit/a7737fe309714c0723a7fd7d3c1c7ac6d644cb6a))
* **tx:** manual add uses the SAME unified category editor as review ([13b03ff](https://github.com/okkes/munnimok/commit/13b03ff81b66c3f7e47cb77b4b52d9b54a1c3e82))
* **ui:** offline country-flag icons for language and country fields ([0f33fe2](https://github.com/okkes/munnimok/commit/0f33fe25d442ddef74f90ab514f878a66c4a0284))
* **ui:** stacked sheets step down in height, recede releases instantly, category Save is sticky ([5245576](https://github.com/okkes/munnimok/commit/52455765307824ab08dd458590fb429120c90702))


### 🐞 Bug Fixes

* **ci:** commit the workspace lockfile for flag-icons ([5b293ea](https://github.com/okkes/munnimok/commit/5b293eaab99cc960e7d65f7341dc28b82b2cd2d6))
* **ci:** iOS uploads only from master/dispatch (Apple daily cap); self-heal the NAS apply lock ([8a023b6](https://github.com/okkes/munnimok/commit/8a023b6b24321efb0c741096ab6aeb15ed1e1a11))
* **db:** serialize SQL transactions — SQLCipher choked on concurrent Repo writes ([71bb04f](https://github.com/okkes/munnimok/commit/71bb04fa444087d3670c039edba7626ea0cb298d))
* **e2e:** align gallery specs with danger sheets, rich demo and onboarding lock; feat(auth): offline intro is a full screen ([ae471a3](https://github.com/okkes/munnimok/commit/ae471a323f792d82ea48d3a106a5c65fb3d730bd))
* **e2e:** base() completes the non-skippable onboarding for fresh users ([8170d8e](https://github.com/okkes/munnimok/commit/8170d8ec2547abda57fee9cb00d27e908afae7c9))
* **platform:** universal-link handling drops the hardcoded host pin ([01e4933](https://github.com/okkes/munnimok/commit/01e4933a41bf3ffaefb92df3e5324e70cd33f269))
* **platform:** universal-link hosts derive from publicOrigin — foreign hosts still refused ([9ba3234](https://github.com/okkes/munnimok/commit/9ba323434ed63348868153259feed4c6d5ae585f))
* **review:** split editor seeds the draft category, rows removable in review, bulk skips skipped, main+sub shown; feat(cats): soft-drinks sub + Other-income rename ([8bfe156](https://github.com/okkes/munnimok/commit/8bfe1567ca9879fff5f63e0b21fbe1b769595af3))
* **sync:** quarantine 400-rejected ops instead of wedging the space ([c9cdd24](https://github.com/okkes/munnimok/commit/c9cdd24bb53985321a5c35d68d9df25c45d672bf))
* **tests:** CategoryPicker suite follows the unified editor; add-form picker filters by direction only ([d95b348](https://github.com/okkes/munnimok/commit/d95b3488b2ba22e218c5c387e1b82484b14e8205))
* **ui:** sheets show stack depth and stop Safari paint glitches on grown content ([e6f0bb5](https://github.com/okkes/munnimok/commit/e6f0bb5e3911a6b0a1f5a20be0e5efd3358fbcde))

## [2.21.0](https://github.com/okkes/munnimok/compare/v2.20.1...v2.21.0) (2026-07-22)


### ✨ Features

* **accounts:** delete connected accounts with a revoke-mine-only cascade ([82a3443](https://github.com/okkes/munnimok/commit/82a34431638d85634fef63418ba0a7552a43f385))
* **accounts:** per-space attach/detach with start date, last-sync + reconnect hint ([406502d](https://github.com/okkes/munnimok/commit/406502d071f28dd11e31866cf7973b7d84f18d61))
* **demo:** six months of coherent history + a bulk-review pile ([ec11021](https://github.com/okkes/munnimok/commit/ec110213eb913f82c70c8127584dcef97de781a7))
* **icons:** local icon segment leads and survives online results ([215424b](https://github.com/okkes/munnimok/commit/215424bbedfa4bf87f1acc9fe07a6a8a881ebda0))
* **receipts:** R9 — admin-curated store merchant patterns feed the matcher ([48d83c7](https://github.com/okkes/munnimok/commit/48d83c79704800ff1ff2e84eb31c1ef965ce0316))
* **receipts:** v3 foundation — instance connections, global store feed, snapshot links ([ba21a53](https://github.com/okkes/munnimok/commit/ba21a532cdb063213ce92b3895f260c24d500077))
* **receipts:** v3 migration + receipts screen filters + one attach flow ([588a2f4](https://github.com/okkes/munnimok/commit/588a2f4aa25bd14536340dc811bd50de4242b12d))
* **review:** counterparty and type join the category editor ([738085c](https://github.com/okkes/munnimok/commit/738085cbda4f04a138cbc82ca952896c6a681818))
* **settings:** three-state appearance control; counterparty label ([84435b2](https://github.com/okkes/munnimok/commit/84435b25915ea7bbd7943ae42b453dbd3b5aa3ad))
* **tx:** live manual balances, guarded split editor, no-account flow, Bank-linked label ([2b562e0](https://github.com/okkes/munnimok/commit/2b562e0a0e918bad741dc67e1e8c1323d7b1c175))
* **ux:** budget period bars + filters + days-left, drag-reorder customize sheets, store-sync explainer ([0fcc776](https://github.com/okkes/munnimok/commit/0fcc776b709231891159865500d7585619cfa054))
* **ux:** direct counter/type pickers on detail, aligned danger sheets, tour and label fixes ([447e92e](https://github.com/okkes/munnimok/commit/447e92e3ee165e40818a24b3e290579cebf1f469))
* **ux:** drag v2 with ghost + slide animation (arrows retired); days-to-reset on Home and budgets list ([041397a](https://github.com/okkes/munnimok/commit/041397a06dfac73939653cecf012de47c0eb209c))


### 🐞 Bug Fixes

* **accounts:** icon picks show live in AttachSheet; bank sync no longer clobbers renames ([cd7846b](https://github.com/okkes/munnimok/commit/cd7846b652054a27fcff2eabd54cbbef5a0cfab4))
* **demo:** pin the MEI money cluster out of the current month ([f39b79e](https://github.com/okkes/munnimok/commit/f39b79e535894c924bfe04543c04d8f5b9245fda))
* **deploy:** munni dev Play signing key in assetlinks; stale apply locks self-heal ([212570f](https://github.com/okkes/munnimok/commit/212570f127190124a84e12379b3803f36ca37680))
* **native:** hosted /native-auth bounce follows the channel scheme; review card sheds duplicate rows ([72a42e6](https://github.com/okkes/munnimok/commit/72a42e67cc1afb237f13f553da04914591ad5010))
* **native:** one universal-link domain per channel — dev logins stop opening prod ([b46a3fe](https://github.com/okkes/munnimok/commit/b46a3feb21f74a8f52f9f18da58a6ba062ea9644))
* **ui:** release stuck press state after long-press context menu ([7310a23](https://github.com/okkes/munnimok/commit/7310a2321903c9bf95aba60c5b2766e4e17b6da6))
* **ux:** encrypted-store re-enable, lang popover dismiss, unique private names, onboarding lock step ([c2ce662](https://github.com/okkes/munnimok/commit/c2ce6625d1c38874a4ddad5c8ddeac122ba58325))

## [2.20.1](https://github.com/okkes/munnimok/compare/v2.20.0...v2.20.1) (2026-07-19)


### 🐞 Bug Fixes

* **sync:** unclog poisoned outboxes — accept topics + composite ids, chunk pushes, isolate space failures ([7cea99f](https://github.com/okkes/munnimok/commit/7cea99f813440db14acf2fa06b2a994449a1bf64))

## [2.20.0](https://github.com/okkes/munnimok/compare/v2.19.1...v2.20.0) (2026-07-19)


### ✨ Features

* **app:** recurring set-asides + allocation topics, admin facelift, PSD2 architecture dossier ([76115ff](https://github.com/okkes/munnimok/commit/76115fffcec17793fba83e9cb9c75b251b4f92d7))

## [2.19.1](https://github.com/okkes/munnimok/compare/v2.19.0...v2.19.1) (2026-07-19)


### 🐞 Bug Fixes

* **auth:** stay signed in across app updates ([fe5beea](https://github.com/okkes/munnimok/commit/fe5beea2b6e15520678669dd28366fa18eb69324))

## [2.19.0](https://github.com/okkes/munnimok/compare/v2.18.1...v2.19.0) (2026-07-19)


### ✨ Features

* **app:** split editor says Done, removing a member asks first ([ec37993](https://github.com/okkes/munnimok/commit/ec3799374d908406c107bd48cf6d064df742ba0f))

## [2.18.1](https://github.com/okkes/munnimok/compare/v2.18.0...v2.18.1) (2026-07-19)


### 🐞 Bug Fixes

* **app:** family-account consent safety, staging keeps the shared identity, FCM errors name themselves ([003b653](https://github.com/okkes/munnimok/commit/003b6537084ad684b295a68ee9eda29d0ef6c0cd))

## [2.18.0](https://github.com/okkes/munnimok/compare/v2.17.0...v2.18.0) (2026-07-19)


### ✨ Features

* **app:** left-space cleanup, duplicate-consent convergence, diagnosis names the bound consent ([eac496d](https://github.com/okkes/munnimok/commit/eac496dfed8191519d29dab28e480af053e7ad59))

## [2.17.0](https://github.com/okkes/munnimok/compare/v2.16.0...v2.17.0) (2026-07-18)


### ✨ Features

* **app:** revive the service worker, visible native pushes, steadier sheets and review ([c31715e](https://github.com/okkes/munnimok/commit/c31715ed228be8bd0362cc2add18738b973a856e))

## [2.16.0](https://github.com/okkes/munnimok/compare/v2.15.0...v2.16.0) (2026-07-18)


### ✨ Features

* **app:** quota-proof bank linking with consent healer, token single-flight, goal covers ([8277889](https://github.com/okkes/munnimok/commit/82778894732d3fa920e231a0c2fede1f3227e13f))

## [2.15.0](https://github.com/okkes/munnimok/compare/v2.14.0...v2.15.0) (2026-07-18)


### ✨ Features

* **app:** goal pictures, admin sync-chain diagnosis, event date-input fix, TestFlight update link ([8011e42](https://github.com/okkes/munnimok/commit/8011e4268271d78e373ae5e84260613da091bfa1))

## [2.14.0](https://github.com/okkes/munnimok/compare/v2.13.1...v2.14.0) (2026-07-18)


### ✨ Features

* **review:** the review workbench — every decision editable on a compact card, with create-and-return flow ([13762f0](https://github.com/okkes/munnimok/commit/13762f0114fd4789eb0e20ad0ac92e41a4f541d1))

## [2.13.1](https://github.com/okkes/munnimok/compare/v2.13.0...v2.13.1) (2026-07-18)


### 🐞 Bug Fixes

* **banking:** relay Enable Banking's own error text; rename sheet stays on screen under the iOS keyboard ([e1254f9](https://github.com/okkes/munnimok/commit/e1254f900e70ddce45b1977de41bd942580aac69))

## [2.13.0](https://github.com/okkes/munnimok/compare/v2.12.2...v2.13.0) (2026-07-18)


### ✨ Features

* **app:** universal links + detail/categories polish ([b00347d](https://github.com/okkes/munnimok/commit/b00347d6cddb7b7ce84d89d893fea966754e9df7))

## [2.12.2](https://github.com/okkes/munnimok/compare/v2.12.1...v2.12.2) (2026-07-18)


### 🐞 Bug Fixes

* **banking:** EnableBanking signing key survives its transient client; profile avatar survives reinstall ([594311b](https://github.com/okkes/munnimok/commit/594311bb94cc0613b8bc13f1434fb479b904c5ea))

## [2.12.1](https://github.com/okkes/munnimok/compare/v2.12.0...v2.12.1) (2026-07-18)


### 🐞 Bug Fixes

* **auth:** self-heal the password-change sign-in loop ([a60266a](https://github.com/okkes/munnimok/commit/a60266a8a010b43ec2fd7cc399f2ce3c39b8de85))
* **observability:** institutions failures self-diagnose; sync stops reporting identity states ([ec8be18](https://github.com/okkes/munnimok/commit/ec8be1801dee63e4f79a0966ab7efcd366103003))

## [2.12.0](https://github.com/okkes/munnimok/compare/v2.11.0...v2.12.0) (2026-07-18)


### ✨ Features

* **app:** observability + transaction-detail batch — GC complete idempotency, API Sentry, title renames with memory ([2956d00](https://github.com/okkes/munnimok/commit/2956d0069d13d3490c6cb7f7bceabab038654aaa))

## [2.11.0](https://github.com/okkes/munnimok/compare/v2.10.0...v2.11.0) (2026-07-18)


### ✨ Features

* **app:** motion + control batch — animated folds and panes, uncategorized gate, vendored bank logos ([683f068](https://github.com/okkes/munnimok/commit/683f068a08c11925c2df11f3c10d38e14e23e904))

## [2.10.0](https://github.com/okkes/munnimok/compare/v2.9.0...v2.10.0) (2026-07-18)


### ✨ Features

* **app:** reported-bugs batch, part 2 — review deck + detail control ([0401e11](https://github.com/okkes/munnimok/commit/0401e113a9c018b9db813b4833cf27cc4441e39f))


### 🐞 Bug Fixes

* **app:** the reported-bugs batch, part 1 ([a6ddd17](https://github.com/okkes/munnimok/commit/a6ddd1772afca2be92dbdeecd18db9a27056a00f))

## [2.9.0](https://github.com/okkes/munnimok/compare/v2.8.0...v2.9.0) (2026-07-17)


### ✨ Features

* **shopsync:** E2EE store-connection sync — SC1-SC3 complete ([8c173bb](https://github.com/okkes/munnimok/commit/8c173bb1915336ad7a9873bfd825c8822b57cd8b))


### 🐞 Bug Fixes

* **native:** flows return to the app — GC consent, sign-out, encrypted-store safety ([b9522fc](https://github.com/okkes/munnimok/commit/b9522fc612f6ca1c1870e9d366814131b66b31f8))

## [2.8.0](https://github.com/okkes/munnimok/compare/v2.7.0...v2.8.0) (2026-07-17)


### ✨ Features

* **paypal:** PP1 — funding debits become transfers, purchases count once ([9f1f4c5](https://github.com/okkes/munnimok/commit/9f1f4c5a71e86a4ec5e4a5d6259c29e6ab2f393b))

## [2.7.0](https://github.com/okkes/munnimok/compare/v2.6.0...v2.7.0) (2026-07-17)


### ✨ Features

* **admin:** AC2 — the catalog editor ([8e3a859](https://github.com/okkes/munnimok/commit/8e3a8597fd27c11b66e4d5e4b7412b11b68a860b))
* **catalog:** AC3 — tombstone detach on devices + baked offline baseline ([c401f8a](https://github.com/okkes/munnimok/commit/c401f8ad169d9b0b3724dab9804b4ac17a5cf2f6))

## [2.6.0](https://github.com/okkes/munnimok/compare/v2.5.0...v2.6.0) (2026-07-17)


### ✨ Features

* **ux:** calm categories, honest desktop, visible demo — the review batch ([61ac458](https://github.com/okkes/munnimok/commit/61ac45802107da5aa721f29423ac6822d432cd47))


### 🐞 Bug Fixes

* **deploy:** always capture logto logs in the status dump ([76c4fd0](https://github.com/okkes/munnimok/commit/76c4fd03c8697f5c7d69c3c55c0791eb40a80520))
* **deploy:** restore against the REAL postgres 18, verify before the marker ([1383bd1](https://github.com/okkes/munnimok/commit/1383bd151d35782e491fccda4195a8f3c9e0f7de))
* **deploy:** restore postgres 18 BEFORE dependents boot; redo raced migrations ([762b8af](https://github.com/okkes/munnimok/commit/762b8af71260a50fc697e77c3906949ae34401ad))
* **deploy:** run logto alterations BEFORE the seed (restored 1.24 schema) ([c0dea10](https://github.com/okkes/munnimok/commit/c0dea1026306321c3630fba9cc5dfc36a91d1724))

## [2.5.0](https://github.com/okkes/munnimok/compare/v2.4.0...v2.5.0) (2026-07-17)


### ✨ Features

* **catalog:** AC1 — operator-published catalog document, end to end ([c5aead6](https://github.com/okkes/munnimok/commit/c5aead608d41c5e2e2ad9e4da1ea2edc24910bb2))


### 🐞 Bug Fixes

* **catalog:** published keyword rules merge in front of the bundled set ([3caa2f6](https://github.com/okkes/munnimok/commit/3caa2f63a241d7adaeb25ccf370f6a38aef6b0dd))

## [2.4.0](https://github.com/okkes/munnimok/compare/v2.3.0...v2.4.0) (2026-07-17)


### ✨ Features

* **deploy:** logto 1.41 + postgres 18 with a self-migrating update path ([5a23b29](https://github.com/okkes/munnimok/commit/5a23b29000d33a04d58c1695903cdca59e145c81))
* **tx+acct:** manual-transaction upgrades, account identity controls, clean native sign-out ([798d5a7](https://github.com/okkes/munnimok/commit/798d5a7abdb33909d7bd289edb5399a8f079faa1))

## [2.3.0](https://github.com/okkes/munnimok/compare/v2.2.0...v2.3.0) (2026-07-17)


### ✨ Features

* **db:** E2 — SQLCipher store live behind the native dev flag ([9244c76](https://github.com/okkes/munnimok/commit/9244c76d581eb531e44487b887ea0d413065fa33))


### 🐞 Bug Fixes

* **deploy:** pin logto's self-fetch to the host gateway (admin console 403) ([71b4cc0](https://github.com/okkes/munnimok/commit/71b4cc0a2e4230b2f34243dded33c522568da1f1))
* **push:** guard the webview's phantom serviceWorker; drop pure network noise from telemetry ([9d4e926](https://github.com/okkes/munnimok/commit/9d4e926692bab7d8acb7d1c34cc6e5f7902b4196))

## [2.2.0](https://github.com/okkes/munnimok/compare/v2.1.0...v2.2.0) (2026-07-17)


### ✨ Features

* **db:** E2 groundwork — SQL storage backend with backend-parity suite ([16ac565](https://github.com/okkes/munnimok/commit/16ac5658789e8a2180c31e75a7a70841a9a1a900))


### 🐞 Bug Fixes

* **deps:** commit the workspace lockfile for the sql.js/dexie-react-hooks swap ([899ffef](https://github.com/okkes/munnimok/commit/899ffef1c8cf30eeed339d9b56698e6384f3929c))
* **review:** reset the fresh-card state during render, not in a late effect ([85a2d8c](https://github.com/okkes/munnimok/commit/85a2d8c86db7245bb5acd65d0135d2b49e8e0f7d))

## [2.1.0](https://github.com/okkes/munnimok/compare/v2.0.0...v2.1.0) (2026-07-17)


### ✨ Features

* **review+tx:** the recovered redesign batch — type-first card, one editor, richer bulk, detail bulk-apply ([3b6c1d2](https://github.com/okkes/munnimok/commit/3b6c1d2a4d03157e1bc472d42f1a805e95ec99f4))

## [2.0.0](https://github.com/okkes/munnimok/compare/v1.24.0...v2.0.0) (2026-07-17)


### ⚠ BREAKING CHANGES

* **deps:** Capacitor 8 across the shells + valkey 9

### ✨ Features

* **review:** one category editor + transactions-style bulk sheet (user redesign) ([d3fe7c9](https://github.com/okkes/munnimok/commit/d3fe7c9ef259d420e335e02bf46cb35d251e340e))
* **tx+cats:** remarks batch 2 — editable counterparty + retro-linking, category naming rules, fixes ([3c0661e](https://github.com/okkes/munnimok/commit/3c0661eee577be2bdb2c783915fca90dc7977f3c))


### 🐞 Bug Fixes

* **native:** minSdk 24 — Capacitor 8's camera library floor (Android 7) ([a148ede](https://github.com/okkes/munnimok/commit/a148edea04a400465bc5cdcaf8e71236e6256b12))


### 🧹 Chores

* **deps:** Capacitor 8 across the shells + valkey 9 ([3c0758b](https://github.com/okkes/munnimok/commit/3c0758b6933c40114052d69ed0a7e8c1dfe5e9f4))

## [1.24.0](https://github.com/okkes/munnimok/compare/v1.23.0...v1.24.0) (2026-07-16)


### ✨ Features

* **native:** §5 niceties — haptics, share-sheet exports, launcher shortcuts, push-tap routing ([f227fed](https://github.com/okkes/munnimok/commit/f227fedaf89efc753091849a3957f3c81dfbcb96))


### 🐞 Bug Fixes

* **ci:** BSD base64 reads stdin only ([4d58dde](https://github.com/okkes/munnimok/commit/4d58dde8f368499d706cb5a35cfa1f1029f2b05e))
* **ci:** clear existing Development certs before minting the persistent one ([0f2dff5](https://github.com/okkes/munnimok/commit/0f2dff5870685b2eb1601d333236633c8852adb8))
* **ci:** legacy PBE for the minted p12 — Apple's security tool can't read OpenSSL 3 defaults ([639909f](https://github.com/okkes/munnimok/commit/639909f1f5a188a5ec4a950302c8cac864f5622f))
* **ci:** mint the p12 on macOS and import-verify it in the same run ([b6a0a43](https://github.com/okkes/munnimok/commit/b6a0a43e8fff86c0dd00c122b13dcb53b4d67b33))

## [1.23.0](https://github.com/okkes/munnimok/compare/v1.22.0...v1.23.0) (2026-07-16)


### ✨ Features

* **ui+review:** remarks batch — headers, splits placement, Home block, own-transfer detection ([7121c2c](https://github.com/okkes/munnimok/commit/7121c2c9d088f1bec2b70ee35459a9e0241ae76c))

## [1.22.0](https://github.com/okkes/munnimok/compare/v1.21.0...v1.22.0) (2026-07-16)


### ✨ Features

* **native:** §1 biometrics — the OS Face ID / fingerprint prompt unlocks the app lock ([7188405](https://github.com/okkes/munnimok/commit/7188405abe1bdd4c5bdac72c03037016f1f66dab))


### 🐞 Bug Fixes

* **build:** tolerate a missing patch-package in scoped installs ([f1eb4ce](https://github.com/okkes/munnimok/commit/f1eb4ce73e83fc0feb71976b72bd288862cd9205))
* **native:** patch the biometric plugin's gradle for AGP 9 ([4d1590e](https://github.com/okkes/munnimok/commit/4d1590e7c7661d387701a9c5f33436abfafe546a))

## [1.21.0](https://github.com/okkes/munnimok/compare/v1.20.0...v1.21.0) (2026-07-16)


### ✨ Features

* **splits:** SP5 — event link, auto-attach, event summary, settlement review chip ([cc3e61b](https://github.com/okkes/munnimok/commit/cc3e61b5644f1aac97c3a3a19bc9d723effb24c6))

## [1.20.0](https://github.com/okkes/munnimok/compare/v1.19.0...v1.20.0) (2026-07-16)


### ✨ Features

* **splits:** SP4 — settle in one tap + owner-only close ([fa73b2a](https://github.com/okkes/munnimok/commit/fa73b2aa1b5ebd6c8214c71c614bb147d7881457))

## [1.19.0](https://github.com/okkes/munnimok/compare/v1.18.0...v1.19.0) (2026-07-16)


### ✨ Features

* **native:** real Firebase iOS config for app.munni.dev (staging push) ([0e44b2d](https://github.com/okkes/munnimok/commit/0e44b2d1b146af03da78aa1a2fdfc00e04f64b88))
* **splits:** SP3 — share-link invites, join screen, guest hardening + tour ([66fa5fe](https://github.com/okkes/munnimok/commit/66fa5fe6ad92a8e95a7ef255bbe301525ebdaae7))

## [1.18.0](https://github.com/okkes/munnimok/compare/v1.17.0...v1.18.0) (2026-07-16)


### ✨ Features

* **native:** real Firebase iOS config for app.munni (push delivery) ([8b83703](https://github.com/okkes/munnimok/commit/8b83703eba9f8c50e4003840d3ffbfc3e1a9e738))
* **splits:** SP1 — split sessions with membership-scoped ledger ([00f6ca5](https://github.com/okkes/munnimok/commit/00f6ca526d3067c65a97d53b55fcf54cbb944045))
* **splits:** SP2 — add expenses from your own transactions + share editor ([89e3025](https://github.com/okkes/munnimok/commit/89e30251a82f355cb060fbe89448f7d1f55f86d9))


### 🐞 Bug Fixes

* **app:** local-first startup — never block a returning device on the network ([7e3cabc](https://github.com/okkes/munnimok/commit/7e3cabc2f1b5248e236a101ac2dcbdeb5f38a97a))
* **native:** iOS push registration + staging icon + persistent signing cert ([1f3cc7b](https://github.com/okkes/munnimok/commit/1f3cc7b11bc5a12397b461027d95c2dd4cdaf258))
* **ui:** snap the shell back when iOS keyboard focus-scroll displaces it ([30659f6](https://github.com/okkes/munnimok/commit/30659f659c4480bfb62a8af82845321248a6d495))

## [1.17.0](https://github.com/okkes/munnimok/compare/v1.16.0...v1.17.0) (2026-07-16)


### ✨ Features

* **account:** full account deletion (design delivered) ([5b44921](https://github.com/okkes/munnimok/commit/5b44921b46305c59cfb560736b685764296407d6))

## [1.16.0](https://github.com/okkes/munnimok/compare/v1.15.0...v1.16.0) (2026-07-16)


### ✨ Features

* **admin:** desktop console redesign - grants, quota, overview (AD1-3) ([e6e1462](https://github.com/okkes/munnimok/commit/e6e14620d3e69175406ee22c6c71b4de535633c6))

## [1.15.0](https://github.com/okkes/munnimok/compare/v1.14.0...v1.15.0) (2026-07-16)


### ✨ Features

* **native:** update card, follow-device pickers, camera receipts, tx type row ([e7598aa](https://github.com/okkes/munnimok/commit/e7598aa8fb437fb50ff3885a858061fe61bf023c))

## [1.14.0](https://github.com/okkes/munnimok/compare/v1.13.0...v1.14.0) (2026-07-16)


### ✨ Features

* **ux:** native post-logout deep link; bank-details block; What's New catch-up; splits + admin redesign docs ([b311a4d](https://github.com/okkes/munnimok/commit/b311a4db871c4f461d03f6aedf17cc52d085d58c))

## [1.13.0](https://github.com/okkes/munnimok/compare/v1.12.0...v1.13.0) (2026-07-15)


### ✨ Features

* **native:** SDK 36; i18n review fixes NL+TR; account-deletion plan ([4ee2959](https://github.com/okkes/munnimok/commit/4ee2959e7915b18e9017f9dc6d85fd355ebcc891))


### 🐞 Bug Fixes

* **ci:** prune iOS dev certs by keep-newest-3, not derived age ([220094a](https://github.com/okkes/munnimok/commit/220094aedc0f7f5fc5443f792638939199f41ea7))
* **deploy:** allow native webview origins in the api CORS lists ([5398666](https://github.com/okkes/munnimok/commit/5398666d8bc60c70a52edfb461f826da3464e69f))

## [1.12.0](https://github.com/okkes/munnimok/compare/v1.11.0...v1.12.0) (2026-07-15)


### ✨ Features

* **tx:** reimbursements physically rewrite category attribution; device language on first run ([8924c7e](https://github.com/okkes/munnimok/commit/8924c7ee43cec45ba4db3304fce2831bdd3b6dd7))

## [1.11.0](https://github.com/okkes/munnimok/compare/v1.10.0...v1.11.0) (2026-07-15)


### ✨ Features

* **native+ui:** staging Android unblocked; themed status bar; dev icon; split-aware rows; richer forecasts; review bulk sheet ([1596838](https://github.com/okkes/munnimok/commit/1596838d65f68ec6a4be319271d8c31992791b99))

## [1.10.0](https://github.com/okkes/munnimok/compare/v1.9.0...v1.10.0) (2026-07-15)


### ✨ Features

* **ui:** brand logos fill their tiles; auth callback failures show the error ([d8d539f](https://github.com/okkes/munnimok/commit/d8d539fb2e73b02bba0a20ca589e670b085d228f))

## [1.9.0](https://github.com/okkes/munnimok/compare/v1.8.1...v1.9.0) (2026-07-15)


### ✨ Features

* **ci:** NAS diag folder listing mode ([0664118](https://github.com/okkes/munnimok/commit/066411840bade316132c7ae02c04562e078ba988))
* **deploy:** NAS diagnostics without SSH (FileStation download + status dumps) ([f16109d](https://github.com/okkes/munnimok/commit/f16109d8390eec7a195455e4b458b9441f410c0a))


### 🐞 Bug Fixes

* **ci:** NAS diag paths derive from SYNOLOGY_PATH; detect HTML error pages ([9258009](https://github.com/okkes/munnimok/commit/9258009e461af465e058a626d4fff8382691a786))
* **deploy:** create the import-watch mount dir before compose up ([b5718e3](https://github.com/okkes/munnimok/commit/b5718e359dc017c0790c6fdf603160848579b790))
* **deploy:** failed updates retry next cycle (marker records success only) ([c8ba642](https://github.com/okkes/munnimok/commit/c8ba6420250d7d567943445bb4a8fbfbb70419e3))
* **deploy:** glitchtip migrate via manage.py; status dump survives up failure ([e9b78bf](https://github.com/okkes/munnimok/commit/e9b78bf1a3cc58c81695323d2895c6d36dc270b3))

## [1.8.1](https://github.com/okkes/munnimok/compare/v1.8.0...v1.8.1) (2026-07-15)


### 🐞 Bug Fixes

* **deploy:** Synology upload _sid in query string; de-flake review expand assert ([97fd457](https://github.com/okkes/munnimok/commit/97fd45717bb660007a287fdab10372011ebe7081))
* **native:** revert test-patched google-services.json ([bdd107c](https://github.com/okkes/munnimok/commit/bdd107cde3cd7c5465ea7a57faacba80df6a3deb))

## [1.8.0](https://github.com/okkes/munnimok/compare/v1.7.0...v1.8.0) (2026-07-15)


### ✨ Features

* **native:** dedicated staging apps + templated NAS env + self-updating deploy scripts ([b63f792](https://github.com/okkes/munnimok/commit/b63f7927b5bf87f7c15f59da0160e1e5b59f8c66))


### 🐞 Bug Fixes

* **ci:** patch iOS bundle id in pbxproj, not via xcodebuild arg ([11a5734](https://github.com/okkes/munnimok/commit/11a573413657ae4c621c3aa6a0f8842d50b18734))
* **ci:** pin iOS archive to the cloud-managed Apple Distribution cert ([f0ada94](https://github.com/okkes/munnimok/commit/f0ada945324b719be894456ca988e97d436aa67b))
* **ci:** prune CI-minted Apple Development certs before iOS archive ([47a58a7](https://github.com/okkes/munnimok/commit/47a58a7a44e1732ab3aed47f8b8fc25453e39243))
* **deploy:** keep .env on the NAS only; staging channel; stop sourcing env file ([22f5130](https://github.com/okkes/munnimok/commit/22f513029fea038e13389b4c460cfeab77455bdb))

## [1.7.0](https://github.com/okkes/munnimok/compare/v1.6.0...v1.7.0) (2026-07-15)


### ✨ Features

* **demo:** rich date-relative profile for every feature ([8a1433e](https://github.com/okkes/munnimok/commit/8a1433e8d25526f5c06c55e958f8949a1d693629))
* **deploy:** GitHub → Synology auto-deploy over FileStation API (no SSH) ([3ed63ae](https://github.com/okkes/munnimok/commit/3ed63ae681bcb2ba25034adf65733822326d6639))


### 🐞 Bug Fixes

* **native:** login redirect, no SW toast, FCM health flag, iOS archive dest ([06b1015](https://github.com/okkes/munnimok/commit/06b1015c622b45ad8cd0580facf721ce6194f7a5))

## [1.6.0](https://github.com/okkes/munnimok/compare/v1.5.0...v1.6.0) (2026-07-15)


### ✨ Features

* **export:** CSV / JSON export of transactions (csv-export design) ([fb97377](https://github.com/okkes/munnimok/commit/fb97377c335bb817628a0bca8ad1baac634b35e6))
* **help:** 1.6.0 notes; trends gallery + guide section; retire shipped designs ([78d4636](https://github.com/okkes/munnimok/commit/78d4636385067c5159fa877f41e38e3f0ae3520f))
* **home:** cash-flow forecast — safe to spend until payday (F1+F2) ([5c4c3f5](https://github.com/okkes/munnimok/commit/5c4c3f5c0302a28a8a32515a9cb148cbc0f70374))
* **native:** R8 minification + Play mapping upload; TestFlight lane ([bbfeba5](https://github.com/okkes/munnimok/commit/bbfeba5ad3c42403a39294392e36308c3399add5))
* **recurring:** subscription intelligence — yearly truth, price changes, review hint ([cf18cd2](https://github.com/okkes/munnimok/commit/cf18cd23d278bf15ad1f3afb74b256f9431984eb))
* **trends:** category bars, cash flow and net worth over time (T1-T3) ([6ebfc2e](https://github.com/okkes/munnimok/commit/6ebfc2e5a8bd49879700a457817f4f8c6aafaa93))

## [1.5.0](https://github.com/okkes/munnimok/compare/v1.4.0...v1.5.0) (2026-07-14)


### ✨ Features

* **accounts:** show when each financial account last synced ([a82f0d7](https://github.com/okkes/munnimok/commit/a82f0d7a5ee8d86f88c46c716a7a15d5f079f8d7))
* **desktop:** redesign D1-D5 — density, focus review, home columns, keys ([28255af](https://github.com/okkes/munnimok/commit/28255af192f53849728fcc38cfd3782e52dd239f))
* **help:** extend 1.5.0 notes (desktop overhaul, leave space, sync times); refresh gallery + guide ([c3bb580](https://github.com/okkes/munnimok/commit/c3bb58084f5aa3329834bb52ef03632093e4e68b))
* **help:** reimbursements line in the 1.5.0 notes ([9f6ec11](https://github.com/okkes/munnimok/commit/9f6ec119d94a2ff56ac985fa48f360c577bca3d9))
* **native:** master-only app builds; no PWA install nudge in the shell ([c9730c6](https://github.com/okkes/munnimok/commit/c9730c6e634f883bd7fe9cc56c04637cc29c9566))
* **native:** signed release pipeline — keystore, versioned bundle, Play internal upload ([5b2176a](https://github.com/okkes/munnimok/commit/5b2176a333d49377fc1972f318a18bc24f3ff812))
* **spaces:** leave a shared space from space settings ([5023103](https://github.com/okkes/munnimok/commit/5023103eb7fd021eb31993084b84b3a3f1b07546))
* **tx:** reimbursements work from the income side; credits net out; settled self-files ([c30cffe](https://github.com/okkes/munnimok/commit/c30cffedc168db74218cbdecf3d25d49313522e2))


### 🐞 Bug Fixes

* **ci:** gradlew executable bit + chmod guard in the android workflow ([ed14792](https://github.com/okkes/munnimok/commit/ed1479209949f0a6b5e93211f22acabd8ced253d))
* **desktop:** center the review deck; level the Home column tops ([36a6755](https://github.com/okkes/munnimok/commit/36a6755c4bf26a5883c698c9e732a982c0a90cf2))
* **native:** capacitor config as JSON — the CLI's TS parser dies under TypeScript 7 ([fabb618](https://github.com/okkes/munnimok/commit/fabb618553099e01223416e03b88c714b8746877))

## [1.4.0](https://github.com/okkes/munnimok/compare/v1.3.1...v1.4.0) (2026-07-14)


### ✨ Features

* alcohol/tobacco split, reachable expected-reimbursement, category-create door ([79a0ee7](https://github.com/okkes/munnimok/commit/79a0ee74d163c3d50da11117ebccd4103a129981))
* counterparty account number surfaces and joins to own accounts ([433f883](https://github.com/okkes/munnimok/commit/433f883ecbd6fe9784b359a88e939ad92e6483b0))
* Jumbo receipts connection; AH shows which recipe answered ([6cc6dba](https://github.com/okkes/munnimok/commit/6cc6dba96aa042eaa2babe47824e444adeb9b75b))
* pluggable bank-data providers with an admin picker; Enable Banking integrated ([f3241f7](https://github.com/okkes/munnimok/commit/f3241f7ff925fc4edf32b275540e26c25f2e1cbe))
* reserved (pending) bank charges + budget-aware GoCardless cadence ([2f191fa](https://github.com/okkes/munnimok/commit/2f191fa5b0fce1ce30c534d69bced9de091100c9))
* **server:** /logos/health canary diagnoses the logo.dev configuration ([8add34d](https://github.com/okkes/munnimok/commit/8add34db82ea8aeca1db3f3871fd55911b07afa0))
* **server:** watch-folder importer for manual CAMT exports ([3ae0425](https://github.com/okkes/munnimok/commit/3ae0425b3c759ba5642aaa881fd286256c9a1ad8))
* **web:** calmer review interactions ([f042586](https://github.com/okkes/munnimok/commit/f0425866e1c2669b2a93168592768480f7afd2c5))
* **web:** drop redundant members/accounts doors from space settings ([174437c](https://github.com/okkes/munnimok/commit/174437cbed1b2bebbf763759e32e899422577be6))
* **web:** event category breakdown drills into subs and filters payments ([7b24bef](https://github.com/okkes/munnimok/commit/7b24bef09aa618546f99dbfecc5426c61113c827))
* **web:** global settings behind a single door; drop viewport diagnostics ([e24385f](https://github.com/okkes/munnimok/commit/e24385f89a1d04c8c9c441e465e6a7be5e434e95))
* **web:** illustrated user guide shipped with the app at /guide/ ([fc94c69](https://github.com/okkes/munnimok/commit/fc94c69f0e8a46f99c3e97bcf16bfbe1717c92d9))
* **web:** in-app release notes ('What's new') ([9e56d49](https://github.com/okkes/munnimok/commit/9e56d49d1a4c77cd056c98ce9721109334df8375))
* **web:** new Home default order; portfolio becomes its own tab ([39376cc](https://github.com/okkes/munnimok/commit/39376cc675ddf9ddd4aba488d9d932e71843efa8))
* **web:** one switch hides every tip ([66ba8b6](https://github.com/okkes/munnimok/commit/66ba8b67f556e51f3acc7679ed63efeb688b1be4))
* **web:** receipts v2 — shared store connections, a real receipts home, matching ladder ([c1d9bfa](https://github.com/okkes/munnimok/commit/c1d9bfa60451fab417f35a85f8977726514cd757))
* **web:** review works on a staged draft — one write on Confirm ([010a582](https://github.com/okkes/munnimok/commit/010a5822c199730e75630584e6de8afb196cafda))
* **web:** smarter cross-space category prediction ([e0ced8e](https://github.com/okkes/munnimok/commit/e0ced8e5175b4725840b4128673eb47b377b0a37))
* **web:** transaction search matches amounts by digit substring ([f922195](https://github.com/okkes/munnimok/commit/f9221953ff301535fd651b627ead88828db6aa78))


### 🐞 Bug Fixes

* bank-consent return works from a plain browser tab (PWA journeys) ([362bf9f](https://github.com/okkes/munnimok/commit/362bf9faf6d2c9384dbf46de29a8ebbfbd78d031))
* **server:** one-time 90-day feed backfill for pre-migration bank accounts ([b2fe3c0](https://github.com/okkes/munnimok/commit/b2fe3c00e36972f9d58ee4a5d43d09fad65511a6))
* **server:** PayPal-style accounts without an IBAN connect properly ([c07b63a](https://github.com/okkes/munnimok/commit/c07b63af6287ed31fa7803e6604ff9181238a4ce))
* **web:** attach-sheet checkboxes update live; history start applies at attach ([f6b109c](https://github.com/okkes/munnimok/commit/f6b109cc5a06ad9070ff28549431c18750226dfb))

## [1.3.1](https://github.com/okkes/munnimok/compare/v1.3.0...v1.3.1) (2026-07-10)


### 🐞 Bug Fixes

* bulk-confirm list scrolls inside its card ([b70d1fc](https://github.com/okkes/munnimok/commit/b70d1fc688b033f2919418670287306145dbae70))
* **web:** the bulk-confirm list scrolls inside its card ([e5bab18](https://github.com/okkes/munnimok/commit/e5bab18613d24daaf5388c5000d8ae2d49325618))

## [1.3.0](https://github.com/okkes/munnimok/compare/v1.2.0...v1.3.0) (2026-07-10)


### ✨ Features

* **web:** U4 master-detail panes — the list stays beside its detail at lg ([5f9a41f](https://github.com/okkes/munnimok/commit/5f9a41f837a9bcb13027a54c184263412de69d7b))

## [1.2.0](https://github.com/okkes/munnimok/compare/v1.1.0...v1.2.0) (2026-07-10)


### ✨ Features

* **api,deploy:** GoCardless idle-requisition cleanup + container docs ([8e04ae3](https://github.com/okkes/munnimok/commit/8e04ae39418921127d8eca0d4d40e6c4da074586))
* **api:** fetch bank data once nightly at 03:00 bank-local time ([fac3270](https://github.com/okkes/munnimok/commit/fac3270828f010ed972e6ba81d4b0a1bd492b8c0))
* **deploy:** pgadmin console; run glitchtip migrations before boot ([f3fee51](https://github.com/okkes/munnimok/commit/f3fee5149cb9b2c77ce2622fa8bce5492deb5c4a))
* **web,api:** allocation — zero-based budgeting per the approved design ([4c5c7c4](https://github.com/okkes/munnimok/commit/4c5c7c4685ac2f8b4b030b6fd6aa1502cb968b21))
* **web,api:** budgets — cadenced limits, carry-over, exclusivity, home block ([66cca3f](https://github.com/okkes/munnimok/commit/66cca3f3ab75e9f9302b202301656ce89c26e5ee))
* **web,api:** events, goals and debts — entities, sync whitelist, domain math ([f3133f8](https://github.com/okkes/munnimok/commit/f3133f8f993ebe546777e1e47d12617962b8138d))
* **web,api:** insights — detector engine, six findings, weekly digest ([f74194c](https://github.com/okkes/munnimok/commit/f74194c8131f12da3d98339c2f9ff971416e9b46))
* **web,api:** portfolio — holdings, lots, delayed quotes, DEGIRO import ([987acb6](https://github.com/okkes/munnimok/commit/987acb650d8accffec640ea8745e4ab6109f17a6))
* **web,api:** real bank logos on account rows; logo.dev key guard ([2aca0e5](https://github.com/okkes/munnimok/commit/2aca0e522cbf917e3135743b3c5afc1aa5874acd))
* **web,api:** receipts S1 — photo proof on transactions ([b180277](https://github.com/okkes/munnimok/commit/b18027773df5e34e425c12cc541509cb56f8201b))
* **web,api:** receipts S2 — Albert Heijn adapter, matcher, proxy, OCR ([3ce4f5a](https://github.com/okkes/munnimok/commit/3ce4f5a609011efebf82270426884707687bbae2))
* **web:** customizable landing zone; settings grouped by scope ([de39bfd](https://github.com/okkes/munnimok/commit/de39bfd120af5244a4b0e134e7e4deb33b41361b))
* **web:** events, goals and debts screens with home blocks and settings entry ([0c596d6](https://github.com/okkes/munnimok/commit/0c596d616ac7516b790264ca583b56aef0aedbab))
* **web:** highlight search matches; logo search leads with logo.dev ([1d67960](https://github.com/okkes/munnimok/commit/1d67960b967af28e7009d02107b566c78d735306))
* **web:** home intelligence — new-transactions block and feature doors ([2d31058](https://github.com/okkes/munnimok/commit/2d31058d6ca6193da1dbb61e9f7232626d540195))
* **web:** home refresh — review card, dated rows, notification bell ([77fcc10](https://github.com/okkes/munnimok/commit/77fcc10e0b952065bb7d70396a6edb124f846625))
* **web:** home space switcher, offline pill, notification deep-links ([5410989](https://github.com/okkes/munnimok/commit/54109892027bb1102bdbf7fbc1e3951da80ca018))
* **web:** in-context category drill replaces the transactions forward ([9752cfb](https://github.com/okkes/munnimok/commit/9752cfb95249b416a9181f259a9d231d81a92573))
* **web:** low-budget alerts fire with the app closed (budgets P4) ([47a1a30](https://github.com/okkes/munnimok/commit/47a1a30d0be51f731e95b65f4155cfc170b4a8e6))
* **web:** offline-aware login, friend-delete confirm, spaces screen polish ([8eab454](https://github.com/okkes/munnimok/commit/8eab454283ab1dcb6e834de3b18fcae50869221c))
* **web:** PWA install hint + platform install tour ([c6e8ee4](https://github.com/okkes/munnimok/commit/c6e8ee4980ab2008cbbe6e53a0aa4faca62763c6))
* **web:** receipts browser + loud AH connection state ([5a7abd6](https://github.com/okkes/munnimok/commit/5a7abd617fa787da7a4f977dd10cb43e7319cba8))
* **web:** recurring custom cadence - every N weeks/months/years ([11bf2eb](https://github.com/okkes/munnimok/commit/11bf2eb8a393a504032428bc3afbc97f2c611c4e))
* **web:** recurring detail screen + detection inbox ([85f6bfe](https://github.com/okkes/munnimok/commit/85f6bfe203928896fa95bd921c29d2113f3d02db))
* **web:** recurring polish, press feedback, chart motion ([21bcc21](https://github.com/okkes/munnimok/commit/21bcc21ddaa252769f13b4aa772641ef95d2c1e8))
* **web:** reimbursements tell both sides; drills show the slice ([528608c](https://github.com/okkes/munnimok/commit/528608cc30cbc11dcd7959cb92bb5d98c98f7264))
* **web:** remarks batch 1 — events with pictures, clearer review, tokens ([d1bfa5c](https://github.com/okkes/munnimok/commit/d1bfa5c9f1b7f34dfa56d4e415508bc54be36c1d))
* **web:** review redesign — account-first type, valid categories, % splits ([b2c1110](https://github.com/okkes/munnimok/commit/b2c111038b93d80b13f3ae09c4e79f74bc7fc7ee))
* **web:** space accounts and members get their own screens + settings rows ([d00b355](https://github.com/okkes/munnimok/commit/d00b355a2ab853cd0a4f26f71e89205205885231))
* **web:** staging PWA wears the white leaf on brand green ([52252c0](https://github.com/okkes/munnimok/commit/52252c0fb0bf6d1852a3658d9e8d63b1d6d7f594))
* **web:** tours for every feature ([64462e4](https://github.com/okkes/munnimok/commit/64462e46be895cad76995a7a6124137c84c688ac))
* **web:** tutorial content for events, goals, debts and allocation ([14bd7a5](https://github.com/okkes/munnimok/commit/14bd7a5a300c7dcb8acfafbe69c4f9fba0446f41))
* **web:** tutorials — intro cards, slide tours, spotlight walkthroughs ([cddc79d](https://github.com/okkes/munnimok/commit/cddc79d6fe79b7ac2b5bb670cd31de6e85baf9a8))
* **web:** U4 desktop slice + U5 polish ([2da5749](https://github.com/okkes/munnimok/commit/2da5749e1ef98076e78d0c2ba638ef7831362764))


### 🐞 Bug Fixes

* **api:** honor the gocardless daily rate budget ([2bf2ebc](https://github.com/okkes/munnimok/commit/2bf2ebc032c280bdc880c52d99fac1e302383d41))
* **deploy:** pgadmin refuses .local emails — default to admin@munni.dev ([7b1aa73](https://github.com/okkes/munnimok/commit/7b1aa735cd7968f80f76cf4f03aa604ab9a9203f))
* **web,api:** 'Betaalautomaat' is a card payment, not a cash withdrawal ([8d8071b](https://github.com/okkes/munnimok/commit/8d8071b14ba0d0f934bcca4deca0765a13334062))
* **web,api:** sonar findings across the three new arcs + coverage tests ([243b02c](https://github.com/okkes/munnimok/commit/243b02ca5e75c65a879982963f936a24227352e3))
* **web,api:** sonar findings in the S2 arc ([375c96c](https://github.com/okkes/munnimok/commit/375c96c94b9a38b3512a232454f9465df4201fb6))
* **web:** AH receipts speak GraphQL, legacy REST as fallback ([588c183](https://github.com/okkes/munnimok/commit/588c1839ae34a7a80bf5164e18315762891a0a93))
* **web:** device-feedback round — keyboard space, footer, wheel drag, sync row ([a60613f](https://github.com/okkes/munnimok/commit/a60613fe79872bb5521f5f62b5d04481394ec938))
* **web:** footer status-bar mode + the small-remarks round ([5e0920c](https://github.com/okkes/munnimok/commit/5e0920cc11f91ce1beea72023801f92777788bdf))
* **web:** ios/android input bugs — sheets, drag, color input, footer ([1316144](https://github.com/okkes/munnimok/commit/13161445c99be70e7c2b50ac9cf2b8488124a5b9))
* **web:** last negated condition in the holding form ([4e48e8f](https://github.com/okkes/munnimok/commit/4e48e8f3f516c09b74087238ccb49f345e03aef8))
* **web:** narrow the event date via a local before formatting ([fa8a026](https://github.com/okkes/munnimok/commit/fa8a0264e777dd22191a8c1fe52d5d11a57f0dd4))
* **web:** sonar findings — negated ternary, missing test assertion ([10b81a6](https://github.com/okkes/munnimok/commit/10b81a6083a58627d9f5248bd425b31724f35188))
* **web:** standalone root reclaims the status-bar band (footer gap) ([e7560cc](https://github.com/okkes/munnimok/commit/e7560ccc5efd4a73780e4aa6a000a49e3c7a752b))

## [1.1.0](https://github.com/okkes/munnimok/compare/v1.0.0...v1.1.0) (2026-07-09)


### ✨ Features

* **admin:** standalone operator console in its own container ([0d497de](https://github.com/okkes/munnimok/commit/0d497de7502972071dcc1c00a589f85777b737ba))
* **api:** FluentValidation on every request body ([ed04382](https://github.com/okkes/munnimok/commit/ed0438201f83033bc6eb7437189e3359427218a1))
* **api:** GoCardless ingest writes the feed shape ([a986083](https://github.com/okkes/munnimok/commit/a9860835d824ea275541071e589963245ec794c6))
* **api:** push notifications for friend requests and space invites ([45b8ea1](https://github.com/okkes/munnimok/commit/45b8ea1cc9c4eb914fdb47f7b3bb7c638af99b0f))
* **api:** rate limiting, param-shape validation, nginx security headers ([55811cb](https://github.com/okkes/munnimok/commit/55811cbc9676d28dafdc6c3ffcdd99aa3e6a628f))
* **api:** Scalar API reference at /scalar ([068699c](https://github.com/okkes/munnimok/commit/068699cade851aa6b59903cb75720268b1d666ff))
* **api:** shared-accounts P2 — feed registration, attachments, derived access ([5dd541a](https://github.com/okkes/munnimok/commit/5dd541a83153c2f3e747c3a5c10f27131388a018))
* automated versioning via release-please ([67253ea](https://github.com/okkes/munnimok/commit/67253ea950a4a8037b1d416ec1a48417c57b6589))
* custom profile photos and space images, synced everywhere ([fc70594](https://github.com/okkes/munnimok/commit/fc70594c839144b16dcad3fa43719a04a3ff2610))
* **deploy:** per-environment env files + channel in version footer ([69708dd](https://github.com/okkes/munnimok/commit/69708ddae96ee0b713e6847731dfebf46736d09e))
* profile screen — avatar, display name, user id + email ([771f593](https://github.com/okkes/munnimok/commit/771f59314f35ffa9d4f38761276940b4770ab174))
* shared-accounts P5 — full two-user feed lifecycle proven end to end ([1ac9754](https://github.com/okkes/munnimok/commit/1ac975407cc1d0143e1d0dd279ae6c65d18bce49))
* spaces v2 — roles, settings, ownership transfer, leave ([3e2f145](https://github.com/okkes/munnimok/commit/3e2f145e702a76146f1aa8d3c5a2581696cc26d2))
* **sync:** near-real-time sync + fail-closed bootstrap ([1d9881c](https://github.com/okkes/munnimok/commit/1d9881cd4fa3e28de2e3a037c5386ff4d7773456))
* web push notifications + biometric app lock ([d5178bc](https://github.com/okkes/munnimok/commit/d5178bc699398ab31e71476490189c69a1889746))
* **web,api:** brand logos for recurring costs — logo.dev search + vendored fallback ([9bc97dc](https://github.com/okkes/munnimok/commit/9bc97dc05eb5946971597575ea015aea46c76874))
* **web,api:** recurring costs — tab, detection, reconciliation, reminders ([69475c0](https://github.com/okkes/munnimok/commit/69475c0adf7b0e5a2c0507c7128ba3b042cae454))
* **web:** adopt user-scoped categories when a space becomes shared ([717654b](https://github.com/okkes/munnimok/commit/717654b89a5bebf59ce7bce0dc5cb03668b236d5))
* **web:** background sync — push-triggered pull + Android outbox flush ([2b53f19](https://github.com/okkes/munnimok/commit/2b53f199c46cb97a68ffff0ed128fc6c923cdf28))
* **web:** custom colors, move-to picker, drag-to-move subs, iOS viewport fix ([aa84424](https://github.com/okkes/munnimok/commit/aa8442496ff8d413a999f43b146a90ee6284d852))
* **web:** dated account balances — newest information wins ([c3b24f7](https://github.com/okkes/munnimok/commit/c3b24f77f10b8314ad70c6169a15525e651da855))
* **web:** design polish batch — login, lock screen, PWA icon, empty states ([6a9f2aa](https://github.com/okkes/munnimok/commit/6a9f2aa4296d617d42ed15e7d3fb0aeba6323778))
* **web:** EN/NL/TR strings for overview and onboarding bank step ([b8db7d8](https://github.com/okkes/munnimok/commit/b8db7d8672b820ce682d52f0f175aeb133bc4cc3))
* **web:** full category system — mains with types, sub directions, scopes ([2feffa3](https://github.com/okkes/munnimok/commit/2feffa378a39185bcc755e9bcb44f1223759491a))
* **web:** history-first category prediction ([0b56c77](https://github.com/okkes/munnimok/commit/0b56c773df8abe4153af9d0c738a1f81f757e791))
* **web:** home becomes a landing zone of compact blocks ([952cc35](https://github.com/okkes/munnimok/commit/952cc353ab9cf116986bae64abe54b18c4b9aca6))
* **web:** identity-scoped app lock, dvh frame, desktop login, inline add-friend ([3e1a773](https://github.com/okkes/munnimok/commit/3e1a77302ed9713ce3a01d6b8a1a87e5f23781d9))
* **web:** ING CSV imports — one statement pipeline for every format ([dfb4cdf](https://github.com/okkes/munnimok/commit/dfb4cdf1280f9c93ad0fd53cf259a9cf254bf738))
* **web:** onboarding offers the bank connection as step 2 ([729d599](https://github.com/okkes/munnimok/commit/729d599425277796267c7c9f54dc7bf24f1abf5e))
* **web:** period overview with category drill-down ([7d3c741](https://github.com/okkes/munnimok/commit/7d3c741ea49af0bf052ae8a62fcc94a004bdbea1))
* **web:** period start weekday, overview drill-down, lock + layout polish ([6daf7ab](https://github.com/okkes/munnimok/commit/6daf7ab1c878c5ffa4ac52aa68212a29b6728a0f))
* **web:** review rebuilt — reasons, bulk confirm, splits/type, recurring link, skip pile ([64f6307](https://github.com/okkes/munnimok/commit/64f63074d623bacb142a69bfe74e57b3008060dd))
* **web:** shared-accounts P1 — feed/overlay schema + join layer ([2cb4472](https://github.com/okkes/munnimok/commit/2cb44728e5f918e67367ae888f276ec5044abe6e))
* **web:** shared-accounts P3 — feed-native imports + R1 application layer ([f7b8ae1](https://github.com/okkes/munnimok/commit/f7b8ae134e2857968bccd22e35f5a80e7a8b61fe))
* **web:** shared-accounts P4 — global accounts overview + attach management ([1c019d9](https://github.com/okkes/munnimok/commit/1c019d9020cd79fd33e01e254887f00a6badd8a9))
* **web:** space settings become a dedicated screen ([1a9db89](https://github.com/okkes/munnimok/commit/1a9db89b63b9fd690e63a68bb9103794fc2e8e02))
* **web:** space settings rework + offline hardening ([555fa91](https://github.com/okkes/munnimok/commit/555fa91108c24a27680d601633dc016ffec1ee24))
* **web:** transactions filter sheet — accounts, types, categories, dates ([09a6226](https://github.com/okkes/munnimok/commit/09a6226a0ced07ebfa8f99d764deb8bbc0728db0))


### 🐞 Bug Fixes

* **deploy:** force LF line endings for files that run on Linux ([b890028](https://github.com/okkes/munnimok/commit/b8900289e43ebcf12306095b61f5b3cfbc71d85e))
* import STOCK_AVATARS in Settings.jsx (notifications crash on friend invite) ([c420ceb](https://github.com/okkes/munnimok/commit/c420cebe6c5c450d3d0cbbb345dfecda6fcd1663))
* show correct Transaction Review count for inactive shared profiles in switcher ([280f053](https://github.com/okkes/munnimok/commit/280f053856e29b1b71b7652843a18619f1e19453))
* **web,api:** sonar findings + races the coverage run exposed ([e16d2b8](https://github.com/okkes/munnimok/commit/e16d2b89c12da2d38b1c6de63784eac5c1b81900))
* **web:** cap footer safe-area inset; ci: Pages now hosts the legacy UI ([7ec8745](https://github.com/okkes/munnimok/commit/7ec8745a90fcf964097bf8eb60e8c086414262bc))
* **web:** import ASN bank CAMT.053 exports correctly ([d66e7e1](https://github.com/okkes/munnimok/commit/d66e7e1299309918cc5f5fcac66f6bd18fd2de1b))
* **web:** iOS standalone viewport re-measure + sonar cleanups ([3d055f4](https://github.com/okkes/munnimok/commit/3d055f4c044e2d093c3495fe0ad8a8088b391b30))
* **web:** name the failure when the server is unreachable at sign-in ([06d9415](https://github.com/okkes/munnimok/commit/06d9415db9ccb29bae84f137cd07bdc860e05f56))
* **web:** overview saving test starved its own waitFor — suite hung ([05821c5](https://github.com/okkes/munnimok/commit/05821c5c156ae85dc5689d475ae1eb50a0d9b7e7))
* **web:** security-extended findings — SW message origin check + SVG-only vendoring ([7700a17](https://github.com/okkes/munnimok/commit/7700a17fd7c3b63d9e8b9f7f035d788ed4986961))
* **web:** tab bar hidden behind Android system navigation ([7dab67d](https://github.com/okkes/munnimok/commit/7dab67d2c0f8ea1e0bf183f99dc13ce4b6d6663f))


### 🛠️ Build System

* **deploy:** local-only SonarQube analysis stack ([fec84b5](https://github.com/okkes/munnimok/commit/fec84b56c721648571e00acfab9c485bf0f48e42))
