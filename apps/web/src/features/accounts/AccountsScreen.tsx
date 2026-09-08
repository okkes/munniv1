import { useEffect, useMemo, useState } from 'react';
import { useGlobalAccounts } from '@/application/accounts';
import type { GlobalAccount, SharedVia, SpaceScopedAccounts } from '@/application/accounts';
import { SharedSpaceBadge } from '@/features/spaces/SpaceSwitcher';
import { getApiCapabilities } from '@/lib/api';
import { useSession } from '@/app/session';
import { linkAllCounterparties } from '@/application/counterLink';
import { applyTitleMemory } from '@/application/titleMemory';
import { linkPaypalFunding } from '@/application/paypalLink';
import { fetchMyFeedIds } from './feedGateway';
import { AttachSheet } from './AttachSheet';
import { EditAccountSheet } from './EditAccountSheet';
import { ReconcileSheet } from './ReconcileSheet';
import { StatementImportFlow } from './StatementImportFlow';
import { normalizeIban } from '@/domain/feedIds';
import { takeAccountOpenHandoff } from './openHandoff';
import { useQuery } from '@/db/useQuery';
import { AddAccountChooser } from './AddAccountChooser';
import { BankConnectSheet } from './BankConnect';
import { institutionLogoUrl } from './useInstitutionLogos';
import { useLang } from '@/i18n';
import { useData } from '@/app/data';
import { fmtCents } from '@/lib/money';
import { fmtTimeAgo } from '@/lib/text';
import type { AccountRow, SpaceRow } from '@/db/types';
import { HelpButton } from '@/features/help/HelpButton';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';

import { typeDef } from './accountTypes';

/** whole days between a yyyy-mm-dd date and now; 0 when absent */
const daysSince = (date?: string | null): number =>
  date ? Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000) : 0;

/** #227 r2: matches the m-row-flash animation in styles.css */
const FLASH_MS = 1600;
/** #227 r3: settle-watch cadence — the rect holding still for two
 *  consecutive checks reads as "the scroll stopped" */
const SETTLE_POLL_MS = 100;
const SETTLE_QUIET_CHECKS = 2;
/** …and a hard cap so a tap that needs no scroll still pulses promptly */
const SETTLE_MAX_MS = 1500;
/** whatever is pending per row — a settle watch or a running pulse —
 *  so a re-tap mid-flight cancels cleanly (WeakMap: removed rows drop) */
const flashCleanups = new WeakMap<HTMLElement, () => void>();

/** nearest overflow ancestor that actually scrolls (the screen's list
 *  column here, but resolved generically — isClippedFromView-style walk) */
function scrollAncestorOf(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/** the pulse itself — reflow first, so a re-tap after settle RESTARTS
 *  the CSS animation instead of dying on the already-set attribute */
function startFlashPulse(target: HTMLElement): void {
  delete target.dataset.flash;
  void target.offsetWidth;
  target.dataset.flash = '1';
  const timer = window.setTimeout(() => {
    delete target.dataset.flash;
    flashCleanups.delete(target);
  }, FLASH_MS);
  flashCleanups.set(target, () => window.clearTimeout(timer));
}

/** #227 r3 (user): the pulse waits for the smooth scroll to SETTLE —
 *  started together, the highlight was nearly gone by the time the row
 *  arrived. 'scrollend' answers precisely where supported; the
 *  rect-stability poll covers the rest, including the tap that needs no
 *  scroll at all (which never fires 'scrollend'). */
function watchScrollSettle(target: HTMLElement, onSettled: () => void): void {
  const scroller = scrollAncestorOf(target);
  let lastTop = target.getBoundingClientRect().top;
  let quiet = 0;
  let poll = 0;
  let cap = 0;
  function teardown(): void {
    window.clearInterval(poll);
    window.clearTimeout(cap);
    window.removeEventListener('scrollend', settle);
    scroller?.removeEventListener('scrollend', settle);
  }
  function settle(): void {
    teardown();
    onSettled();
  }
  poll = window.setInterval(() => {
    const { top } = target.getBoundingClientRect();
    quiet = top === lastTop ? quiet + 1 : 0;
    lastTop = top;
    if (quiet >= SETTLE_QUIET_CHECKS) settle();
  }, SETTLE_POLL_MS);
  cap = window.setTimeout(settle, SETTLE_MAX_MS);
  window.addEventListener('scrollend', settle);
  scroller?.addEventListener('scrollend', settle);
  flashCleanups.set(target, teardown);
}

/** #227 r2: the echo's jump scrolls to the real row AND pulses it —
 *  on a long list the smooth scroll alone left the eye searching */
function flashJumpTarget(accountId: string): void {
  const target = document.getElementById(`acct-row-${accountId}`);
  if (!target) return;
  // cancel whatever is in flight: a mid-scroll re-tap restarts the
  // watch, a post-settle one restarts the pulse (reflow in startFlashPulse)
  flashCleanups.get(target)?.();
  flashCleanups.delete(target);
  delete target.dataset.flash;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  watchScrollSettle(target, () => startFlashPulse(target));
}

function AccountRowButton({
  entry,
  lang,
  showType,
  onOpen,
}: {
  entry: GlobalAccount;
  lang: ReturnType<typeof useLang>['lang'];
  /** #212 r2: only SPACE-owned rows name a type — a global account is
   *  just an account; each space gives it its own reading at attach */
  showType?: boolean;
  onOpen: (entry: GlobalAccount) => void;
}) {
  const { t } = useLang();
  const { account, feedSpaceId, sharedVia } = entry;
  // the user's own pick wins over the institution logo (user request)
  const bankLogo = account.logo ?? institutionLogoUrl(account.bankId);
  const active = sharedVia.filter((v) => !v.archived);
  const archivedOnly = sharedVia.length > 0 && active.length === 0;
  // #248 (user): no auto-attach nag — the unattached state is a quiet
  // per-row badge instead (rendered below)
  const unattached = sharedVia.length === 0;
  return (
    <button
      data-testid={`account-row-${account.id}`}
      onClick={() => onOpen(entry)}
      className="m-tap flex w-full items-center gap-3 border-none bg-transparent px-4 py-3.5 text-left"
    >
      {/* #212: the TYPE icon rides as a corner badge when a bank logo
          owns the tile — space-owned rows only (r2) */}
      <span className="relative shrink-0">
        {bankLogo ? (
          <img
            src={bankLogo}
            alt=""
            className="h-7 w-7 rounded-lg object-contain"
            loading="lazy"
            data-testid={`account-logo-${account.id}`}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextElementSibling?.classList.remove('hidden');
            }}
          />
        ) : null}
        <span className={bankLogo ? 'hidden' : ''}>
          <Icon
            name={showType ? typeDef(account.type).icon : 'bank-outline'}
            size={22}
            color={account.color ?? 'var(--m-ink-3)'}
          />
        </span>
        {bankLogo && showType && (
          <span
            data-testid={`account-typebadge-${account.id}`}
            className="absolute -right-1.5 -bottom-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-bg-2 ring-2 ring-surface"
          >
            <Icon name={typeDef(account.type).icon} size={10} color="var(--m-ink-2)" />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] text-ink">{account.name}</span>
        {showType && (
          <span className="block truncate text-[11px] text-ink-4" data-testid={`account-type-${account.id}`}>
            {t(typeDef(account.type).labelKey)}
          </span>
        )}
        {/* #227: the "via space x, y" story moved into each space's own
            section (echo rows) — the top rows say the IBAN instead */}
        {feedSpaceId && unattached && (
          <span className="block truncate text-[11px] text-ink-4" data-testid={`account-via-${account.id}`}>
            <span
              className="inline-block rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-ink-2"
              data-testid={`account-unattached-${account.id}`}
            >
              {t('acct.notAttached')}
            </span>
          </span>
        )}
        {feedSpaceId && archivedOnly && (
          <span className="block truncate text-[11px] text-ink-4" data-testid={`account-via-${account.id}`}>
            {t('acct.archivedEverywhere')}
          </span>
        )}
        {feedSpaceId && active.length > 0 && account.iban && (
          <span className="block truncate font-mono text-[11px] text-ink-4 select-text" data-testid={`account-via-${account.id}`}>
            {account.iban}
          </span>
        )}
        {!feedSpaceId && account.iban && (
          <span className="block truncate font-mono text-[11px] text-ink-4 select-text">{account.iban}</span>
        )}
        {/* when the account last heard from its bank/statement (user request) */}
        {account.lastSyncedAt && (
          <span className="block truncate text-[11px] text-ink-4" data-testid={`account-synced-${account.id}`}>
            {t('acct.lastSynced', { when: fmtTimeAgo(account.lastSyncedAt, lang) })}
          </span>
        )}
        {/* export-vs-upload insight (user request): a recent import of an
            OLD export leaves a silent hole — say where the data ends */}
        {account.source !== 'gocardless' && daysSince(account.dataThroughDate) > 14 && (
          <span className="block truncate text-[11px] text-warning" data-testid={`account-datathrough-${account.id}`}>
            {t('acct.dataThrough', { when: fmtTimeAgo(account.dataThroughDate!, lang) })}
          </span>
        )}
        {/* #240 r3: "synced fine, zero rows" must say so — an empty
            answer from the bank is a fact, not a healthy silence */}
        {account.source === 'gocardless' && account.lastFetchReceived === 0 && (
          <span className="block truncate text-[11px] text-warning" data-testid={`account-syncempty-${account.id}`}>
            {t('acct.syncEmpty')}
          </span>
        )}
        {(account.lastFetchDropped ?? 0) > 0 && (
          <span className="block truncate text-[11px] text-warning" data-testid={`account-syncdropped-${account.id}`}>
            {t('acct.syncDropped', { n: account.lastFetchDropped ?? 0 })}
          </span>
        )}
      </span>
      {archivedOnly && <Icon name="archive-outline" size={16} color="var(--m-warning)" />}
      <span className="m-num text-[15px] font-semibold text-ink">
        {fmtCents(account.balanceCents, account.currency, lang)}
      </span>
    </button>
  );
}

function AccountSection({
  title,
  list,
  lang,
  showType,
  onOpen,
}: {
  title: string;
  list: GlobalAccount[];
  lang: ReturnType<typeof useLang>['lang'];
  showType?: boolean;
  onOpen: (entry: GlobalAccount) => void;
}) {
  if (list.length === 0) return null;
  return (
    <>
      <div className="m-cap mt-5 mb-1 px-1">{title}</div>
      <div className="overflow-hidden rounded-card border border-line bg-surface">
        {list.map((entry, i) => (
          // the DOM id is the echo rows' jump target (#227)
          <div key={entry.account.id} id={`acct-row-${entry.account.id}`}>
            {i > 0 && <div className="mx-4 h-px bg-line-2" />}
            <AccountRowButton entry={entry} lang={lang} showType={showType} onOpen={onOpen} />
          </div>
        ))}
      </div>
    </>
  );
}

/** one echo per attachment: the entry plus THIS space's link (#305) */
interface EchoEntry {
  entry: GlobalAccount;
  via: SharedVia;
}

/** #314 (user): the space's own face leads its subsection — picture
 *  wins, else icon + color circle (the SpaceSwitcher recipe, compact) */
function SpaceAvatar({ space }: Readonly<{ space?: SpaceRow }>) {
  if (space?.picture) {
    return <img src={space.picture} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />;
  }
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
      style={{
        background: `color-mix(in srgb, ${space?.color ?? 'var(--m-ink-4)'} 14%, transparent)`,
        color: space?.color ?? 'var(--m-ink-3)',
      }}
    >
      <Icon name={space?.icon ?? (space?.kind === 'shared' ? 'account-group-outline' : 'leaf')} size={14} />
    </span>
  );
}

/** #305 (user): the read-only story of an account someone else shares
 *  into a space — same facts the owner reads (IBAN, type, balance,
 *  freshness, who shared it), none of the levers (no rename, no detach,
 *  no delete: it is not the consumer's account to manage) */
function SharedAccountSheet({
  info,
  onClose,
  lang,
}: {
  info: EchoEntry | null;
  onClose: () => void;
  lang: ReturnType<typeof useLang>['lang'];
}) {
  const { t } = useLang();
  const account = info?.entry.account;
  const bankLogo = account ? (account.logo ?? institutionLogoUrl(account.bankId)) : undefined;
  return (
    <Sheet open={info !== null} onOpenChange={(next) => !next && onClose()} title={account?.name} size="form">
      {info && account && (
        <div className="flex flex-col gap-3 pt-1" data-testid="shared-account-info">
          <div className="flex items-center gap-2.5">
            {bankLogo ? (
              <img src={bankLogo} alt="" className="h-7 w-7 rounded-lg object-contain" data-testid="shared-info-logo" />
            ) : (
              <Icon name="bank-outline" size={22} color="var(--m-ink-3)" />
            )}
            <SharedSpaceBadge testId="shared-info-badge" />
          </div>
          <p className="px-1 text-[13px] leading-snug text-ink-3" data-testid="shared-info-readonly">
            {t('acct.sharedReadOnly')}
          </p>
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            {[
              account.iban ? ([t('accounts.ibanLabel'), account.iban] as const) : null,
              // #152: the type is the SPACE's reading of the attachment
              [t('acct.typeRow'), t(typeDef(info.via.type ?? account.type).labelKey)] as const,
              [t('acct.balanceNow'), fmtCents(account.balanceCents, account.currency, lang)] as const,
              account.dataThroughDate ? ([t('acct.dataThroughLabel'), account.dataThroughDate] as const) : null,
              account.lastSyncedAt ? ([t('acct.lastSyncedLabel'), fmtTimeAgo(account.lastSyncedAt, lang)] as const) : null,
              info.via.attachedByName ? ([t('acct.attachedBy'), info.via.attachedByName] as const) : null,
            ]
              .filter((row): row is readonly [string, string] => row !== null)
              .map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 border-b border-line-2 px-4 py-3 text-[13px] last:border-0">
                  <span className="text-ink-3">{label}</span>
                  <span className="min-w-0 truncate text-right font-mono text-[12px] text-ink">{value}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** #227: an inert mirror of a bank-fed account inside the space that
 *  sees it — tapping jumps up to the REAL row, which lives in the top
 *  section (the screen's scroller owns the smooth scroll). #305: for an
 *  account shared WITH me there is no real row anymore — the echo IS
 *  the account's face here: it wears the shared badge, keeps the synced
 *  logo, carries the Archived pill and opens the read-only info sheet. */
function EchoRow({
  spaceId,
  echo,
  shared,
  lang,
  onOpenShared,
}: {
  spaceId: string;
  echo: EchoEntry;
  /** #305: reachable only through someone else's attachment */
  shared: boolean;
  lang: ReturnType<typeof useLang>['lang'];
  onOpenShared: (echo: EchoEntry) => void;
}) {
  const { t } = useLang();
  const { account } = echo.entry;
  // #305 (user): the owner's icon pick lives on the SYNCED account row —
  // the echo used to draw a hardcoded bank tile, so consumers never saw it
  const bankLogo = account.logo ?? institutionLogoUrl(account.bankId);
  // #314 (user): an archived share says WHY — its sharer stopped sharing
  // (left the space / removed the account); the link's frozen
  // attachedByName is the one name the data can truthfully speak
  let archivedReason: string | null = null;
  if (shared && echo.via.archived) {
    archivedReason = echo.via.attachedByName
      ? t('acct.noLongerSharedBy', { name: echo.via.attachedByName })
      : t('acct.noLongerShared');
  }
  return (
    <button
      data-testid={`account-echo-${spaceId}-${account.id}`}
      onClick={() => (shared ? onOpenShared(echo) : flashJumpTarget(account.id))}
      className={`m-tap flex w-full items-center gap-3 border-none bg-transparent px-4 py-3.5 text-left${shared ? '' : ' opacity-60'}`}
    >
      <span className="shrink-0">
        {bankLogo ? (
          <img
            src={bankLogo}
            alt=""
            className="h-7 w-7 rounded-lg object-contain"
            loading="lazy"
            data-testid={`account-echo-logo-${account.id}`}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextElementSibling?.classList.remove('hidden');
            }}
          />
        ) : null}
        <span className={bankLogo ? 'hidden' : ''}>
          <Icon name="bank-outline" size={22} color="var(--m-ink-3)" />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 truncate text-[15px] text-ink">{account.name}</span>
          {shared && <SharedSpaceBadge testId={`echo-shared-${spaceId}-${account.id}`} />}
        </span>
        {archivedReason ? (
          <span
            className="block truncate text-[11px] text-warning"
            data-testid={`echo-archived-hint-${spaceId}-${account.id}`}
          >
            {archivedReason}
          </span>
        ) : (
          <span className="block truncate text-[11px] text-ink-4">{t(shared ? 'acct.sharedEchoHint' : 'acct.echoHint')}</span>
        )}
      </span>
      {/* #305: the sharer left — the frozen state lands on the echo now
          (the retired "Shared with me" section used to carry this pill) */}
      {echo.via.archived && (
        <span
          className="rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-ink-2"
          data-testid={`echo-archived-${spaceId}-${account.id}`}
        >
          {t('acct.archived')}
        </span>
      )}
      <span className="m-num text-[15px] font-semibold text-ink">
        {fmtCents(account.balanceCents, account.currency, lang)}
      </span>
    </button>
  );
}

/** #227: one space's cluster — real rows first, bank-fed echoes next,
 *  and the default pots folded behind a quiet toggle (closed by default:
 *  six system rows per space drowned the accounts people actually made).
 *  #314 r2 (user): every space is its OWN card again, stacked with no
 *  captions in between — and COLLAPSED to just its face by default: the
 *  header row (avatar + name + chevron) is the toggle. Nothing persists;
 *  every mount starts closed. */
function SpaceSection({
  segment,
  space,
  ownName,
  echoes,
  sharedIds,
  lang,
  onOpen,
  onOpenShared,
}: {
  segment: SpaceScopedAccounts;
  /** the synced space row — the avatar + creator facts (#314) */
  space?: SpaceRow;
  /** the user's own profile name — "created by" only names OTHERS */
  ownName?: string;
  echoes: EchoEntry[];
  /** #305: accounts reaching me only through someone else's attachment */
  sharedIds: ReadonlySet<string>;
  lang: ReturnType<typeof useLang>['lang'];
  onOpen: (entry: GlobalAccount) => void;
  onOpenShared: (echo: EchoEntry) => void;
}) {
  const { t } = useLang();
  // #314 r2: closed on every mount — deliberately not persisted
  const [expanded, setExpanded] = useState(false);
  const [showDefaults, setShowDefaults] = useState(false);
  const visible = segment.accounts.filter((e) => !e.account.archived);
  const regular = visible.filter((e) => !e.account.defaultFor);
  const defaults = visible.filter((e) => !!e.account.defaultFor);
  const aboveEchoes = regular.length > 0;
  const aboveToggle = aboveEchoes || echoes.length > 0;
  // #314: name the creator only when the space is someone else's work
  const creator = space?.kind === 'shared' && space.createdByName && space.createdByName !== ownName
    ? space.createdByName
    : undefined;
  return (
    <div data-testid={`accounts-space-${segment.spaceId}`} className="overflow-hidden rounded-card border border-line bg-surface">
      <button
        data-testid={`accounts-space-head-${segment.spaceId}`}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="m-tap flex w-full items-center gap-2.5 border-none bg-transparent px-4 py-3.5 text-left"
      >
        <SpaceAvatar space={space} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ink">{segment.spaceName}</span>
          {creator && (
            <span className="block truncate text-[11px] text-ink-4" data-testid={`accounts-space-creator-${segment.spaceId}`}>
              {t('space.createdBy', { name: creator })}
            </span>
          )}
        </span>
        <span className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>
          <Icon name="chevron-down" size={16} color="var(--m-ink-4)" />
        </span>
      </button>
      {expanded && (
        <>
          <div className="mx-4 h-px bg-line-2" />
          {regular.map((entry, i) => (
            <div key={entry.account.id} id={`acct-row-${entry.account.id}`}>
              {i > 0 && <div className="mx-4 h-px bg-line-2" />}
              <AccountRowButton entry={entry} lang={lang} showType onOpen={onOpen} />
            </div>
          ))}
          {echoes.map((echo, i) => (
            <div key={echo.entry.account.id}>
              {(aboveEchoes || i > 0) && <div className="mx-4 h-px bg-line-2" />}
              <EchoRow
                spaceId={segment.spaceId}
                echo={echo}
                shared={sharedIds.has(echo.entry.account.id)}
                lang={lang}
                onOpenShared={onOpenShared}
              />
            </div>
          ))}
          {defaults.length > 0 && (
            <>
              {aboveToggle && <div className="mx-4 h-px bg-line-2" />}
              <button
                data-testid={`accounts-defaults-toggle-${segment.spaceId}`}
                onClick={() => setShowDefaults((v) => !v)}
                className="m-tap flex w-full items-center gap-2 border-none bg-transparent px-4 py-3 text-left text-[12px] font-medium text-ink-4"
              >
                <Icon name={showDefaults ? 'chevron-up' : 'chevron-down'} size={14} />
                {showDefaults ? t('acct.hideDefaults') : t('acct.showDefaults', { n: defaults.length })}
              </button>
              {showDefaults &&
                defaults.map((entry) => (
                  <div key={entry.account.id} id={`acct-row-${entry.account.id}`}>
                    <div className="mx-4 h-px bg-line-2" />
                    <AccountRowButton entry={entry} lang={lang} showType onOpen={onOpen} />
                  </div>
                ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** #311 r4: one reconcile/merge banner's identity + what its tap opens */
interface ReconcileOffer {
  name: string;
  imported: number;
  accountIds: string[];
  merge?: { importedAccountId: string; bankAccountId: string };
}
type ReconcileOfferState = Pick<ReconcileOffer, 'accountIds' | 'merge'>;

/** #314: does a space cluster have anything to show — a live account or
 *  any echo row (archived included) (S2004: out of the component) */
const sectionHasContent = (
  segment: { spaceId: string; accounts: { account: { archived?: unknown } }[] },
  echoPool: { sharedVia: { spaceId: string }[] }[],
): boolean =>
  segment.accounts.some((e) => !e.account.archived) ||
  echoPool.some((entry) => entry.sharedVia.some((v) => v.spaceId === segment.spaceId));

export function AccountsScreen() {
  const { t, lang } = useLang();
  const { store, repo, spaceId } = useData();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  // the whole import journey lives in StatementImportFlow (extracted
  // 2026-08-01); this screen only opens its format-pick sheet
  const [importOpen, setImportOpen] = useState(false);
  const identity = useSession((s) => s.identity);

  // GoCardless accounts arrive via sync, so there is no local "account
  // created" moment to hook — reconcile whenever this screen opens
  // instead (idempotent; rows with links are skipped)
  useEffect(() => {
    void linkAllCounterparties(store, repo, spaceId).catch(() => undefined);
    void linkPaypalFunding(store, repo, spaceId).catch(() => undefined);
    void applyTitleMemory(store, repo, spaceId).catch(() => undefined);
  }, [store, repo, spaceId]);
  const [gcAvailable, setGcAvailable] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [myFeedIds, setMyFeedIds] = useState<ReadonlySet<string> | undefined>(undefined);
  const [attaching, setAttaching] = useState<GlobalAccount | null>(null);

  useEffect(() => {
    if (identity?.kind !== 'user') return;
    void getApiCapabilities().then((caps) => setGcAvailable(caps.gocardless));
    // ownership source of truth for the global overview (offline: the
    // undefined set classifies every local feed as mine, which is right
    // for a single-user device until the fetch lands)
    void fetchMyFeedIds().then(setMyFeedIds).catch(() => undefined);
  }, [identity?.kind]);

  // GLOBAL overview (user decision): every account I own across all my
  // spaces and feeds, plus what others share with me via shared spaces
  const global = useGlobalAccounts(myFeedIds);
  const mine = useMemo(() => (global?.mine ?? []).filter((e) => !e.account.archived), [global]);
  // #288 (user): a deleted feed can leave a ghost — an attachment echo
  // from a member space re-asserts the mirror row after /me/feeds has
  // disowned it, and the row lingered under "Shared with me" answering
  // no tap and naming no sharer. The bar is a LIVE account row —
  // archived-only stays (the sharer left; the Archived pill and the
  // rejoin flow own that state, sync-a6), a tombstoned account drops.
  const sharedWithMe = useMemo(
    // a live account row is the bar — archived-only is a DESIGNED state
    // (the sharer left; the row wears the Archived pill until rejoin)
    () => (global?.sharedWithMe ?? []).filter((e) => e.account.deleted === 0),
    [global],
  );
  // #227: bank-fed accounts echo (inert) inside each space they feed.
  // #305: shared-with-me accounts live ONLY here now — the echo is their
  // face, so the pool keeps carrying them after the section's retirement
  const echoPool = useMemo(() => [...mine, ...sharedWithMe], [mine, sharedWithMe]);
  const sharedIds = useMemo(() => new Set(sharedWithMe.map((e) => e.account.id)), [sharedWithMe]);
  // #305: the consumer's tap-through — read-only facts, zero levers
  const [sharedInfo, setSharedInfo] = useState<{ entry: GlobalAccount; via: SharedVia } | null>(null);
  // #305: a space whose only accounts are OTHERS' attachments still owns
  // a section — the shared echo must always have a home, even while the
  // space's own (default) account rows are still syncing in
  const sections = useMemo(() => {
    const out = [...(global?.spaceScoped ?? [])];
    const known = new Set(out.map((s) => s.spaceId));
    for (const entry of echoPool) {
      for (const via of entry.sharedVia) {
        if (known.has(via.spaceId)) continue;
        known.add(via.spaceId);
        out.push({ spaceId: via.spaceId, spaceName: via.spaceName, accounts: [] });
      }
    }
    return out.sort((a, b) => a.spaceName.localeCompare(b.spaceName));
  }, [global, echoPool]);
  // every attachment of the space, archived included — the frozen state
  // (the sharer left) surfaces as a pill on the echo row (#305)
  const echoesFor = (spaceId: string): { entry: GlobalAccount; via: SharedVia }[] =>
    echoPool.flatMap((entry) => {
      const via = entry.sharedVia.find((v) => v.spaceId === spaceId);
      return via ? [{ entry, via }] : [];
    });
  // #314 (user): the subsections come pre-filtered, so an empty cluster
  // never leaves a bare space header inside the shared segment card
  const renderableSections = useMemo(
    () => sections.filter((segment) => sectionHasContent(segment, echoPool)),
    [sections, echoPool],
  );
  // …and the space rows carry each subsection's face (#314): the
  // icon/picture + color, the shared kind and the creator's name
  const spaceRows = useQuery(store, async () => (await store.allRows('space')).filter((s) => s.deleted === 0), []);
  const spacesById = useMemo(() => new Map((spaceRows ?? []).map((s) => [s.id, s])), [spaceRows]);
  // "created by {name}" must stay quiet for the user's own spaces
  const ownName = useQuery(store, async () => ((await store.metaGet('profile'))?.value as { name?: string } | undefined)?.name, []);
  // reconcile pairing spans BOTH pools: a manual/imported row inside a
  // space can be the twin of a global bank connection
  const suggestionPool = useMemo(
    () => [...mine, ...(global?.spaceScoped ?? []).flatMap((s) => s.accounts).filter((e) => !e.account.archived)],
    [mine, global],
  );

  // master plan (answer 3, auto-suggest): an account fed by BOTH a bank
  // connection and statement uploads — or a same-IBAN pair of a linked
  // and an imported account — offers a reconcile pass (linked = truth)
  const sourcesByAccount = useQuery(store, async () => {
    const { isImportedRow, isLinkedRow } = await import('@/domain/reconcile');
    const byAccount = new Map<string, { linked: boolean; imported: number }>();
    for (const tx of await store.allRows('transaction')) {
      if (tx.deleted !== 0 || !tx.importRef) continue;
      const entry = byAccount.get(tx.accountId) ?? { linked: false, imported: 0 };
      if (isLinkedRow(tx)) entry.linked = true;
      else if (isImportedRow(tx)) entry.imported++;
      byAccount.set(tx.accountId, entry);
    }
    return byAccount;
  }, []);
  const [reconcileOffer, setReconcileOffer] = useState<ReconcileOfferState | null>(null);
  const reconcileSuggestions = useMemo(() => {
    if (!sourcesByAccount) return [];
    const out: ReconcileOffer[] = [];
    const claimed = new Set<string>();
    for (const entry of suggestionPool) {
      const own = sourcesByAccount.get(entry.account.id);
      if (own?.linked && own.imported > 0) {
        out.push({ name: entry.account.name, imported: own.imported, accountIds: [entry.account.id] });
        claimed.add(entry.account.id);
        continue;
      }
      // same-IBAN pair: this imported account has a linked twin. #311 r4
      // (user): the pair stays TWO accounts — the offer is an explicit
      // MERGE (the reconcile runs inside it), never a silent adoption
      if (!own?.imported || !entry.account.iban || claimed.has(entry.account.id)) continue;
      const iban = normalizeIban(entry.account.iban);
      const twin = suggestionPool.find(
        (other) =>
          other.account.id !== entry.account.id &&
          !!other.account.iban &&
          normalizeIban(other.account.iban) === iban &&
          sourcesByAccount.get(other.account.id)?.linked,
      );
      if (twin) {
        out.push({
          name: twin.account.name,
          imported: own.imported,
          accountIds: [twin.account.id, entry.account.id],
          merge: { importedAccountId: entry.account.id, bankAccountId: twin.account.id },
        });
        claimed.add(entry.account.id);
        claimed.add(twin.account.id);
      }
    }
    return out;
  }, [suggestionPool, sourcesByAccount]);

  const openEntry = (entry: GlobalAccount) => {
    // #305: not mine to manage — the read-only story opens instead
    // (reached via the goto-global handoff; shared rows have no top row)
    if (sharedIds.has(entry.account.id)) {
      const via = entry.sharedVia.find((v) => !v.archived) ?? entry.sharedVia[0];
      if (via) setSharedInfo({ entry, via });
      return;
    }
    if (entry.feedSpaceId) setAttaching(entry); // bank feed: manage attachments
    else setEditing(entry.account); // manual/legacy row: EditAccountSheet
  };

  // #239 r2 (user): arriving from a space's info sheet with a target —
  // open that account's sheet the moment the list knows it
  const [openTarget, setOpenTarget] = useState<string | null>(() => takeAccountOpenHandoff());
  useEffect(() => {
    if (!openTarget || !global) return;
    const entry = [...global.mine, ...global.sharedWithMe, ...global.spaceScoped.flatMap((s) => s.accounts)].find(
      (e) => e.account.id === openTarget,
    );
    if (!entry) return;
    setOpenTarget(null);
    openEntry(entry);
    // openEntry is stable in behavior; the effect keys on data arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTarget, global]);

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-accounts">
      <AppBar
        title={t('acct.financialAccounts')}
        leading={
          <IconButton label={t('action.back')} testId="accounts-back" onClick={() => window.history.back()}>
            <Icon name="chevron-left" size={24} />
          </IconButton>
        }
        trailing={
          <>
            <HelpButton tourId="accounts" />
            {/* #317 (user): the upload icon is gone — the + chooser
                embeds the statement-import door */}
            <IconButton label={t('acct.addAccount')} testId="accounts-add" onClick={() => setAddOpen(true)}>
              <Icon name="plus" size={22} />
            </IconButton>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {/* #248 (user): the green auto-attach offer is gone — each
            unattached account wears its own quiet badge instead */}
        {global && mine.length === 0 && sharedWithMe.length === 0 && global.spaceScoped.length === 0 ? (
          <EmptyState
            testId="accounts-empty"
            icon="bank-outline"
            text={t('acct.emptyList')}
            action={
              // stacked (user ss 2026-08-01): side by side the two
              // wrapped into ragged two-line pills
              <div className="flex w-full max-w-[280px] flex-col gap-2">
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  <Icon name="plus" size={16} />
                  {t('acct.addAccount')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                  <Icon name="file-upload-outline" size={16} />
                  {t('import.statement')}
                </Button>
              </div>
            }
          />
        ) : (
          <>
            {reconcileSuggestions.map((suggestion) => (
              <button
                key={suggestion.accountIds.join('+')}
                data-testid={`account-reconcile-${suggestion.accountIds[suggestion.accountIds.length - 1]}`}
                onClick={() => setReconcileOffer({ accountIds: suggestion.accountIds, merge: suggestion.merge })}
                className="m-tap mb-2 flex w-full items-center gap-2.5 rounded-card border border-accent bg-accent-soft px-4 py-3 text-left text-[13px] font-medium text-accent-deep"
              >
                <Icon name={suggestion.merge ? 'source-merge' : 'bank-check'} size={18} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{suggestion.name}</span>
                  <span className="block text-[11px] font-normal">
                    {t(suggestion.merge ? 'reconcile.suggestMerge' : 'reconcile.suggest', { n: suggestion.imported })}
                  </span>
                </span>
                <Icon name="chevron-right" size={16} />
              </button>
            ))}
            {/* GLOBAL first (user ruling 2026-07-28): bank connections
                and statement imports are user-level; manual accounts
                live inside their space and list under it below.
                #212 r2: one plain section — a global account has no
                type of its own, so no assets/liabilities split here */}
            <AccountSection title={t('acct.globalCap')} list={mine} lang={lang} onOpen={openEntry} />
            {/* #305: the global "Shared with me" section retired — a
                shared account's one face is its echo inside the space
                that sees it (tap-through info sheet below).
                #314 r2 (user): one caption, then each space as its OWN
                collapsed card — a tight stack with nothing in between */}
            {renderableSections.length > 0 && (
              <>
                <div className="m-cap mt-5 mb-1 px-1">{t('acct.inSpacesCap')}</div>
                <div className="flex flex-col gap-2" data-testid="accounts-spaces-segment">
                  {renderableSections.map((segment) => (
                    <SpaceSection
                      key={segment.spaceId}
                      segment={segment}
                      space={spacesById.get(segment.spaceId)}
                      ownName={ownName}
                      echoes={echoesFor(segment.spaceId)}
                      sharedIds={sharedIds}
                      lang={lang}
                      onOpen={openEntry}
                      onOpenShared={setSharedInfo}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* attach one of my feed accounts to/from my spaces */}
      <AttachSheet
        open={!!attaching}
        onOpenChange={(open) => !open && setAttaching(null)}
        entry={attaching}
        canEdit={!!attaching && !global?.sharedWithMe.includes(attaching)}
      />

      {/* the extracted import journey: format pick → preview → result */}
      <StatementImportFlow
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => void fetchMyFeedIds().then(setMyFeedIds).catch(() => undefined)}
      />

      {/* AE1: the ONE Add-account chooser (intent-routed). Manual is a
          DOOR here: this screen is the global overview, and manual
          accounts live inside a space (user ruling 2026-07-28) */}
      <AddAccountChooser
        open={addOpen}
        onOpenChange={setAddOpen}
        gcAvailable={gcAvailable}
        hideManual
        onConnect={() => setConnectOpen(true)}
        onImport={() => setImportOpen(true)}
      />

      <BankConnectSheet open={connectOpen} onOpenChange={setConnectOpen} />
      <ReconcileSheet
        open={reconcileOffer !== null}
        onOpenChange={(next) => !next && setReconcileOffer(null)}
        accountIds={reconcileOffer?.accountIds ?? []}
        merge={reconcileOffer?.merge}
      />

      <EditAccountSheet account={editing} onClose={() => setEditing(null)} />

      {/* #305: consumer's read-only view of an account shared with me —
          a SIBLING sheet like every other overlay on this screen */}
      <SharedAccountSheet info={sharedInfo} onClose={() => setSharedInfo(null)} lang={lang} />
    </div>
  );
}
