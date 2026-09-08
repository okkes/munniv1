import type { TranslationKey } from '@/i18n';
import type { MinaArt, MinaExpr } from './assets';

/**
 * The Mina onboarding tutorial (docs/mina-onboarding-tutorial.md):
 * auto-starts after the onboarding form, walks the REAL navigation via
 * gated clicks, and never writes data — the user's own form submissions
 * complete the act-steps (store-diff detection, value-flexible).
 */

/** entities the act-steps watch and the revert ledger tracks */
export type MinaEntity = 'space' | 'account' | 'transaction';

export interface MinaStep {
  /** stable id — resume + tests key on it */
  id: string;
  /** fullscreen Mina page vs the small bubble beside the action */
  kind: 'fullscreen' | 'bubble';
  /** bubble avatar / fullscreen art */
  expr?: MinaExpr;
  art?: MinaArt;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  /** route this step plays on; missing = wherever the user is */
  screen?: string;
  /** highlighted testids ('$s1'/'$s2' resolve to the run's created
   *  spaces); several candidates cover mobile vs desktop nav */
  anchor?: string[];
  /** gate: the anchor is the ONLY tappable element; tapping it advances */
  gate?: boolean;
  /** info highlight: anchor shown but inert — Next advances */
  info?: boolean;
  /** completes when a NEW row of this entity exists (deleted: absent) */
  act?: { entity: MinaEntity; absent?: boolean };
  /** form prefill suggestion while this step is live (localized name key) */
  suggestKey?: TranslationKey;
  /** testids whose live wording fills the copy's {target} (user ruling:
   *  quote the REAL button so renames never desync the tutorial) */
  labelFrom?: string[];
  /** safe re-entry point: a killed app resumes at the nearest one —
   *  mid-sheet steps can't reconstruct their transient UI */
  checkpoint?: boolean;
}

export const MINA_STEPS: readonly MinaStep[] = [
  { id: 'welcome', checkpoint: true, kind: 'fullscreen', art: 'greeting', titleKey: 'mina.welcome.t', bodyKey: 'mina.welcome.b' },
  { id: 'home', checkpoint: true, kind: 'bubble', expr: 'smile', titleKey: 'mina.home.t', bodyKey: 'mina.home.b', screen: '/home' },
  { id: 'spaces', checkpoint: true, kind: 'fullscreen', art: 'spaces', titleKey: 'mina.spaces.t', bodyKey: 'mina.spaces.b' },
  { id: 'sharing', checkpoint: true, kind: 'fullscreen', art: 'family', titleKey: 'mina.sharing.t', bodyKey: 'mina.sharing.b' },
  { id: 'openSwitcher', checkpoint: true, kind: 'bubble', expr: 'armcrossed', titleKey: 'mina.firstSpace.t', bodyKey: 'mina.openSwitcher.b', screen: '/home', anchor: ['home-space-switcher'], gate: true },
  { id: 'openManage', kind: 'bubble', expr: 'armcrossed', titleKey: 'mina.firstSpace.t', bodyKey: 'mina.openManage.b', anchor: ['space-pick-manage'], gate: true },
  { id: 'openCreate', kind: 'bubble', expr: 'armcrossed', titleKey: 'mina.firstSpace.t', bodyKey: 'mina.openCreate.b', anchor: ['spaces-add'], gate: true },
  { id: 'createSpace', kind: 'bubble', expr: 'thinking', titleKey: 'mina.firstSpace.t', bodyKey: 'mina.createSpace.b', act: { entity: 'space' }, suggestKey: 'mina.suggest.private', labelFrom: ['space-create-save'] },
  { id: 'spaceDesign', kind: 'bubble', expr: 'laugh', titleKey: 'mina.spaceDesign.t', bodyKey: 'mina.spaceDesign.b', anchor: ['space-edit-$s1'], info: true },
  { id: 'acctKinds', checkpoint: true, kind: 'fullscreen', art: 'acctKinds', titleKey: 'mina.acctKinds.t', bodyKey: 'mina.acctKinds.b' },
  { id: 'acctManual', checkpoint: true, kind: 'fullscreen', art: 'acctManual', titleKey: 'mina.acctManual.t', bodyKey: 'mina.acctManual.b' },
  { id: 'acctGlobal', checkpoint: true, kind: 'fullscreen', art: 'acctGlobal', titleKey: 'mina.acctGlobal.t', bodyKey: 'mina.acctGlobal.b' },
  { id: 'goSettings', checkpoint: true, kind: 'bubble', expr: 'sad', titleKey: 'mina.makeAccount.t', bodyKey: 'mina.goSettings.b', anchor: ['tab-settings', 'side-tab-settings'], gate: true },
  { id: 'openSpaceCard', kind: 'bubble', expr: 'smile', titleKey: 'mina.makeAccount.t', bodyKey: 'mina.openSpaceCard.b', anchor: ['settings-space-accounts-row'], gate: true, labelFrom: ['settings-space-accounts-row'] },
  { id: 'openAdd', kind: 'bubble', expr: 'smile', titleKey: 'mina.makeAccount.t', bodyKey: 'mina.openAdd.b', anchor: ['space-accounts-add'], gate: true, labelFrom: ['space-accounts-add'] },
  // (the old pickManual step died with the chooser's intent hop: "Add a
  // manual account" opens the TYPE GRID directly since 2026-08-01 — its
  // gate waited forever on a testid that never renders, user ss)
  { id: 'pickChecking', kind: 'bubble', expr: 'smile', titleKey: 'mina.makeAccount.t', bodyKey: 'mina.pickTargetDo.b', anchor: ['chooser-accttype-checking'], gate: true, labelFrom: ['chooser-accttype-checking'] },
  { id: 'createAccount', kind: 'bubble', expr: 'thinking', titleKey: 'mina.makeAccount.t', bodyKey: 'mina.createAccount.b', act: { entity: 'account' }, suggestKey: 'mina.suggest.mainbank', labelFrom: ['chooser-acctform-save'] },
  { id: 'txConcept', checkpoint: true, kind: 'fullscreen', art: 'txAccount', titleKey: 'mina.txConcept.t', bodyKey: 'mina.txConcept.b' },
  { id: 'goTransactions', checkpoint: true, kind: 'bubble', expr: 'smile', titleKey: 'mina.firstTx.t', bodyKey: 'mina.goTransactions.b', anchor: ['tab-transactions', 'side-tab-transactions'], gate: true },
  { id: 'openTxAdd', kind: 'bubble', expr: 'smile', titleKey: 'mina.firstTx.t', bodyKey: 'mina.openTxAdd.b', anchor: ['tx-add'], gate: true },
  { id: 'createTx', kind: 'bubble', expr: 'thinking', titleKey: 'mina.firstTx.t', bodyKey: 'mina.createTx.b', act: { entity: 'transaction' }, suggestKey: 'mina.suggest.groceries', labelFrom: ['txform-save'] },
  { id: 'goHomePayoff', checkpoint: true, kind: 'bubble', expr: 'smile', titleKey: 'mina.payoff.t', bodyKey: 'mina.goHomePayoff.b', anchor: ['tab-home', 'side-tab-home'], gate: true },
  { id: 'payoff', kind: 'bubble', expr: 'smile', titleKey: 'mina.payoff.t', bodyKey: 'mina.payoff.b', anchor: ['home-overview-expense'], info: true },
  { id: 'openSwitcher2', checkpoint: true, kind: 'bubble', expr: 'armcrossed', titleKey: 'mina.family.t', bodyKey: 'mina.openSwitcher2.b', screen: '/home', anchor: ['home-space-switcher'], gate: true },
  { id: 'openManage2', kind: 'bubble', expr: 'armcrossed', titleKey: 'mina.family.t', bodyKey: 'mina.openManage.b', anchor: ['space-pick-manage'], gate: true, labelFrom: ['space-pick-manage'] },
  { id: 'openCreate2', kind: 'bubble', expr: 'armcrossed', titleKey: 'mina.family.t', bodyKey: 'mina.openCreate.b', anchor: ['spaces-add'], gate: true },
  { id: 'createFamily', kind: 'bubble', expr: 'thinking', titleKey: 'mina.family.t', bodyKey: 'mina.createFamily.b', act: { entity: 'space' }, suggestKey: 'mina.suggest.family', labelFrom: ['space-create-save'] },
  // teach switching FROM HOME (user ruling): swapping on the manage
  // screen shows nothing changing — on Home the whole screen follows
  { id: 'goHomeSwap', checkpoint: true, kind: 'bubble', expr: 'armcrossed', titleKey: 'mina.switching.t', bodyKey: 'mina.goHomeSwap.b', anchor: ['tab-home', 'side-tab-home'], gate: true },
  { id: 'openSwitcherSwap', kind: 'bubble', expr: 'armcrossed', titleKey: 'mina.switching.t', bodyKey: 'mina.openSwitcherSwap.b', anchor: ['home-space-switcher'], gate: true },
  { id: 'pickPrivate', kind: 'bubble', expr: 'armcrossed', titleKey: 'mina.switching.t', bodyKey: 'mina.pickPrivate.b', anchor: ['space-pick-$s1'], gate: true },
  { id: 'openSwitcherSwap2', kind: 'bubble', expr: 'armcrossed', titleKey: 'mina.switching.t', bodyKey: 'mina.openSwitcherSwap2.b', anchor: ['home-space-switcher'], gate: true },
  { id: 'pickFamily', kind: 'bubble', expr: 'armcrossed', titleKey: 'mina.switching.t', bodyKey: 'mina.pickFamily.b', anchor: ['space-pick-$s2'], gate: true },
  { id: 'goTransactions2', checkpoint: true, kind: 'bubble', expr: 'thinking', titleKey: 'mina.isolation.t', bodyKey: 'mina.goTransactions2.b', anchor: ['tab-transactions', 'side-tab-transactions'], gate: true },
  { id: 'emptyList', kind: 'bubble', expr: 'thinking', titleKey: 'mina.isolation.t', bodyKey: 'mina.emptyList.b' },
  { id: 'tryTxAdd', kind: 'bubble', expr: 'thinking', titleKey: 'mina.isolation.t', bodyKey: 'mina.tryTxAdd.b', anchor: ['tx-add'], gate: true },
  { id: 'noAccounts', kind: 'bubble', expr: 'thinking', titleKey: 'mina.isolation.t', bodyKey: 'mina.noAccounts.b', anchor: ['txform-no-accounts'], info: true },
  // the ACTIVE space cannot be deleted (user ss): hop back to the first
  // space, then reach Family's OWN settings through its cog
  { id: 'openSwitcherCleanup', checkpoint: true, kind: 'bubble', expr: 'armcrossed', titleKey: 'mina.cleanup.t', bodyKey: 'mina.openSwitcherCleanup.b', screen: '/home', anchor: ['home-space-switcher'], gate: true },
  { id: 'pickPrivateCleanup', kind: 'bubble', expr: 'armcrossed', titleKey: 'mina.cleanup.t', bodyKey: 'mina.pickPrivateCleanup.b', anchor: ['space-pick-$s1'], gate: true },
  { id: 'openSwitcherCleanup2', kind: 'bubble', expr: 'armcrossed', titleKey: 'mina.cleanup.t', bodyKey: 'mina.openSwitcherCleanup2.b', anchor: ['home-space-switcher'], gate: true },
  { id: 'openManageCleanup', kind: 'bubble', expr: 'armcrossed', titleKey: 'mina.cleanup.t', bodyKey: 'mina.openManage.b', anchor: ['space-pick-manage'], gate: true, labelFrom: ['space-pick-manage'] },
  { id: 'openFamilyCog', kind: 'bubble', expr: 'armcrossed', titleKey: 'mina.cleanup.t', bodyKey: 'mina.openFamilyCog.b', anchor: ['space-edit-$s2'], gate: true },
  { id: 'deleteFamily', kind: 'bubble', expr: 'armcrossed', titleKey: 'mina.cleanup.t', bodyKey: 'mina.deleteFamily.b', anchor: ['space-edit-delete'], act: { entity: 'space', absent: true } },
  { id: 'wrap', checkpoint: true, kind: 'fullscreen', art: 'handopen', titleKey: 'mina.wrap.t', bodyKey: 'mina.wrap.b' },
];

export const minaStepIndex = (id: string): number => MINA_STEPS.findIndex((s) => s.id === id);

// ── run state (persisted in meta so a killed app resumes) ────────────────
export interface MinaLedgerEntry {
  entity: MinaEntity;
  spaceId: string;
  id: string;
}
export interface MinaRunState {
  active: boolean;
  step: number;
  /** everything created THIS run — the wrap/skip revert offer */
  ledger: MinaLedgerEntry[];
}
export const MINA_STATE_KEY = 'minaTutorialState';
export const MINA_DONE_KEY = 'minaTutorialDone';

// ── live form suggestions (module-level: forms read, controller writes) ──
// The tutorial never writes DATA; pre-filling a form the user still
// submits is presentation. Cleared the moment the step advances.
let suggestions: { spaceName?: string; accountName?: string; txMerchant?: string; txAmount?: string; txCatId?: string } = {};
export const setMinaSuggestions = (next: typeof suggestions): void => {
  suggestions = next;
};
export const minaSuggestedSpaceName = (): string | undefined => suggestions.spaceName;
export const minaSuggestedAccountName = (): string | undefined => suggestions.accountName;
export const minaSuggestedTx = (): { merchant: string; amount: string; catId?: string } | undefined =>
  suggestions.txMerchant ? { merchant: suggestions.txMerchant, amount: suggestions.txAmount ?? '', catId: suggestions.txCatId } : undefined;
