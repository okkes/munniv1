import { useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useQuery } from '@/db/useQuery';
import { useSession } from '@/app/session';
import { logActivity } from '@/application/activity';
import { linkAllCounterparties } from '@/application/counterLink';
import { linkPaypalFunding } from '@/application/paypalLink';
import { linkTransferPairs } from '@/application/transferMatch';
import { applyTitleMemory } from '@/application/titleMemory';
import { detectStatementKind, parseStatement } from '@/lib/statements/parseStatement';
import type { ParsedStatement, StatementKind } from '@/lib/statements/parseStatement';
import asnLogo from '@/assets/banks/asn.svg';
import ingLogo from '@/assets/banks/ing.svg';
import paypalLogo from '@/assets/banks/paypal.svg';
import { fmtEtaShort, fmtTimeAgo } from '@/lib/text';
import { apiFeedGateway, fetchMyFeedIds } from './feedGateway';
import { setSpaceAttachIntent } from './openHandoff';
import { importCamtStatements, statementCoverageEnd } from './importCamt';
import type { ImportResult } from './importCamt';
import { Button } from '@/ui/Button';
import { FormBlockerNote } from '@/ui/FormBlockerNote';
import { Icon } from '@/ui/Icon';
import { SearchField } from '@/ui/SearchField';
import { Sheet } from '@/ui/Sheet';

const daysSince = (iso: string): number => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

// ── #300: live ETA while a big import runs ──────────────────────────
// rows/second over a ROLLING window (early slow rows must not haunt the
// whole run), spoken only once it can be honest: ≥2s in, a window wide
// enough to smooth burst noise, and actual forward progress.
const ETA_WINDOW_MS = 8000;
const ETA_MIN_ELAPSED_MS = 2000;
const ETA_MIN_SPAN_MS = 1000;
// #300 r2 (user): the first spoken number should be the HIGH guess that
// quickly falls — never a low one that creeps up. A young sample window
// hasn't met the stalls ahead, so early estimates wear a pad that decays
// away as the run matures.
const ETA_PAD_START = 1.5;
const ETA_PAD_UNTIL_MS = 12_000;

export interface EtaState {
  startAt: number;
  samples: { at: number; done: number }[];
}

export const newEtaState = (now: number): EtaState => ({ startAt: now, samples: [{ at: now, done: 0 }] });

/** whole seconds left, or null while an estimate would be dishonest */
export function etaSecondsLeft(state: EtaState, done: number, total: number, now: number): number | null {
  const { samples } = state;
  samples.push({ at: now, done });
  while (samples.length > 2 && now - samples[1].at >= ETA_WINDOW_MS) samples.shift();
  const first = samples[0];
  const spanMs = now - first.at;
  const rows = done - first.done;
  if (now - state.startAt < ETA_MIN_ELAPSED_MS || spanMs < ETA_MIN_SPAN_MS || rows <= 0) return null;
  const age = now - state.startAt;
  const pad = 1 + (ETA_PAD_START - 1) * Math.max(0, 1 - age / ETA_PAD_UNTIL_MS);
  return Math.ceil((((total - done) * spanMs) / rows / 1000) * pad);
}

/** #226 (user): the tested banks, searchable like the connect flow —
 *  the pick guides the file dialog (parsing still sniffs the content).
 *  Brand names stay brand names in every language. #226 r2: each row
 *  wears the bank's logo (local asset — offline-first, never hotlinked),
 *  its own download route, and the format family the pick promises. */
const IMPORT_BANKS = [
  { id: 'asn', name: 'ASN Bank', logo: asnLogo, accept: '.xml,text/xml,application/xml', subKey: 'import.bankAsnSub', kind: 'camt' },
  { id: 'ing', name: 'ING', logo: ingLogo, accept: '.csv,text/csv', subKey: 'import.formatIngSub', kind: 'ing' },
  { id: 'paypal', name: 'PayPal', logo: paypalLogo, accept: '.csv,text/csv', subKey: 'import.bankPaypalSub', kind: 'paypal' },
] as const;

const ANY_ACCEPT = '.xml,.csv,text/xml,application/xml,text/csv';

/** #226 r2: human names for detected formats in the wrong-file ask */
const KIND_NAMES: Record<Exclude<StatementKind, 'unknown'>, string> = {
  camt: 'CAMT.053 (ASN)',
  ing: 'ING CSV',
  paypal: 'PayPal CSV',
};

interface PendingFile {
  content: string;
  name: string;
}

/**
 * The whole statement-import journey as one reusable flow (extracted
 * from AccountsScreen 2026-08-01 so the counterparty picker's Create
 * door can import IN PLACE instead of bouncing to the global overview):
 * format pick → file dialog → per-statement preview (coverage + start-
 * date notes) → run → result. Imported accounts are global and attach
 * to the CURRENT space, exactly like the accounts-screen flow.
 */
export function StatementImportFlow({
  open,
  onOpenChange,
  note,
  onImported,
}: Readonly<{
  /** the format-pick sheet's visibility — the host's single lever */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** host-specific line above the format rows (e.g. "global, attaches here") */
  note?: string;
  /** fires after a successful run (hosts refresh ownership etc.) */
  onImported?: () => void;
}>) {
  const { t, lang } = useLang();
  const { store, repo, spaceId } = useData();
  const navigate = useNavigate();
  const identity = useSession((s) => s.identity);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<ParsedStatement[] | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState(false);
  const [runFailed, setRunFailed] = useState(false);
  const [importing, setImporting] = useState(false);
  // #226: the searchable bank list narrows; the pick tunes the dialog
  const [bankQuery, setBankQuery] = useState('');
  const [accept, setAccept] = useState<string>(ANY_ACCEPT);
  // #226 r2: the picked bank promises a format family — a file that
  // sniffs as another one gets an explicit "import anyway?" ask
  // (the universal CAMT door promises nothing and never asks)
  const [pickedBank, setPickedBank] = useState<(typeof IMPORT_BANKS)[number] | null>(null);
  const [mismatch, setMismatch] = useState<{ found: Exclude<StatementKind, 'unknown'>; files: PendingFile[] } | null>(null);
  // #184 (user): long imports say how far they are, not just "busy"
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // #299 (user): pick which previewed accounts import — excluded INDEXES
  // into importPreview (monthly exports repeat IBANs); empty set = all
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set());
  const [noneBlocked, setNoneBlocked] = useState(false);
  // #300: "about X left" while the rows land — null until honest
  const etaRef = useRef<EtaState | null>(null);
  const [etaSec, setEtaSec] = useState<number | null>(null);

  const activeSpace = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  // IBAN matching spans every account the device knows (both pools)
  const allAccounts = useQuery(store, async () => (await store.allRows('account')).filter((a) => a.deleted === 0), []);
  const byIban = useMemo(
    () => new Map((allAccounts ?? []).filter((a) => a.iban).map((a) => [a.iban!.replace(/\s/g, '').toUpperCase(), a])),
    [allAccounts],
  );

  // #299: what Import will actually run — the result notes reuse it
  const selectedStatements = useMemo(() => (importPreview ?? []).filter((_, i) => !excluded.has(i)), [importPreview, excluded]);
  const toggleStatement = (index: number) => {
    setNoneBlocked(false); // checking anything answers the blocker
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const buildPreview = (files: readonly PendingFile[]) => {
    setExcluded(new Set()); // #299: a fresh preview starts all-checked
    setNoneBlocked(false);
    try {
      // several exports in one go (user request): parse each file and
      // pool the statements — dedupe refs make overlaps import cleanly
      const statements: ParsedStatement[] = [];
      for (const file of files) {
        statements.push(...parseStatement(file.content, file.name));
      }
      setImportPreview(statements);
    } catch {
      setImportError(true);
      setImportPreview([]); // open the sheet to show the error
    }
  };

  const onFilePicked = async (list: FileList | null) => {
    const picked = [...(list ?? [])];
    if (picked.length === 0) return;
    setImportError(false);
    setImportResult(null);
    const files: PendingFile[] = [];
    for (const file of picked) {
      files.push({ content: await file.text(), name: file.name });
    }
    // #226 r2 (user): picked bank X but the file reads as format Y —
    // ask BEFORE the preview ('unknown' stays silent: the parse error
    // path already reports unsupported files)
    const found = pickedBank
      ? files
          .map((f) => detectStatementKind(f.content, f.name))
          .find((k): k is Exclude<StatementKind, 'unknown'> => k !== 'unknown' && k !== pickedBank.kind)
      : undefined;
    if (found) {
      if (fileRef.current) fileRef.current.value = ''; // a re-pick must fire change again
      setMismatch({ found, files });
      return;
    }
    buildPreview(files);
  };

  // #226 r2: Continue imports the stashed files on the exact same parse
  // path; Cancel discards them and reopens the bank picker
  const confirmMismatch = () => {
    const pending = mismatch;
    setMismatch(null);
    if (pending) buildPreview(pending.files);
  };
  const cancelMismatch = () => {
    setMismatch(null);
    onOpenChange(true);
  };

  const runImport = async () => {
    if (!importPreview?.length || importing) return; // double-taps fired PARALLEL imports (user report 2026-07-25)
    // #299 (user): only the CHECKED accounts import; zero checked names
    // the reason instead of a dead click (#195 blocker pattern)
    const chosen = selectedStatements;
    if (chosen.length === 0) {
      setNoneBlocked(true);
      return;
    }
    setImporting(true);
    // #184: rows land one by one — the count updates every ~1% so an
    // 8000-row statement narrates instead of spinning mutely
    const total = chosen.reduce((sum, stmt) => sum + stmt.entries.length, 0);
    const step = Math.max(1, Math.floor(total / 100));
    setProgress({ done: 0, total });
    etaRef.current = newEtaState(Date.now());
    const onProgress = (done: number) => {
      if (done !== total && done % step !== 0) return;
      setProgress({ done, total });
      // #300: the narration gains "about X left" once it can be honest
      if (etaRef.current) setEtaSec(done === total ? null : etaSecondsLeft(etaRef.current, done, total, Date.now()));
    };
    // syncing identities import into feed spaces (shared-accounts model);
    // demo/offline keep everything merged in the current space
    const feeds = identity?.kind === 'user' ? apiFeedGateway(identity.sub) : undefined;
    try {
      setImportResult(await importCamtStatements(repo, store, spaceId, chosen, feeds, onProgress));
    } catch (err) {
      // a failed run (feed registration, server away) must SAY so —
      // a silently unchanged screen reads as "the app is broken"
      // (user report 2026-07-24); the preview stays for a retry.
      // #186: …and leave a trace — the swallow hid every import failure
      const { reportError } = await import('@/lib/report');
      reportError('import', err);
      setRunFailed(true);
      return;
    } finally {
      setImporting(false);
      setProgress(null);
      setEtaSec(null);
      etaRef.current = null;
    }
    setRunFailed(false);
    void logActivity(store, repo, spaceId, 'importRun', `${chosen.length}`);
    // a just-imported account may BE the counterparty of older rows
    // (and vice versa) — retro-link them (user rule)
    await linkAllCounterparties(store, repo, spaceId).catch(() => undefined);
    await linkPaypalFunding(store, repo, spaceId).catch(() => undefined);
    await linkTransferPairs(store, repo).catch(() => undefined);
    await applyTitleMemory(store, repo, spaceId).catch(() => undefined);
    // the import may have registered new feeds — hosts refresh ownership
    if (feeds) void fetchMyFeedIds().catch(() => undefined);
    onImported?.();
  };

  const closeImport = () => {
    setRunFailed(false);
    setImportPreview(null);
    setImportResult(null);
    setImportError(false);
    setExcluded(new Set()); // #299
    setNoneBlocked(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  // #299: with several accounts on offer the button counts the picks
  const importLabel =
    (importPreview?.length ?? 0) > 1
      ? t('import.doImportSelected', { n: selectedStatements.length, m: importPreview?.length ?? 0 })
      : t('import.doImport');

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        multiple
        hidden
        data-testid="accounts-import-input"
        onChange={(e) => void onFilePicked(e.target.files)}
      />

      {/* #226 (user): which BANK is this export from? — searchable like
          the connect flow; the universal CAMT.053 door stays separate */}
      <Sheet open={open} onOpenChange={onOpenChange} title={t('import.pickFormat')} size="tall">
        <div className="flex flex-col gap-2 pt-1" data-testid="import-format-pick">
          {note && (
            <p className="pb-1 text-[12px] leading-snug text-ink-3" data-testid="import-global-note">
              {note}
            </p>
          )}
          <SearchField
            testId="import-bank-search"
            value={bankQuery}
            onChange={setBankQuery}
            placeholder={t('import.bankSearchPlaceholder')}
            height="h-10"
            textSize="text-[13px]"
          />
          {IMPORT_BANKS.filter((bank) => bank.name.toLowerCase().includes(bankQuery.trim().toLowerCase())).map((bank) => (
            <button
              key={bank.id}
              data-testid={`import-bank-${bank.id}`}
              onClick={() => {
                setAccept(bank.accept);
                setPickedBank(bank);
                onOpenChange(false);
                // the accept change must land in the DOM before the dialog
                requestAnimationFrame(() => fileRef.current?.click());
              }}
              className="m-tap flex items-start gap-3 rounded-card border border-line bg-surface p-4 text-left"
            >
              <img src={bank.logo} alt="" className="h-8 w-8 rounded-lg object-contain" />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-ink">{bank.name}</span>
                <span className="block pt-0.5 text-[12px] leading-snug text-ink-3">{t(bank.subKey)}</span>
              </span>
            </button>
          ))}
          <div className="m-cap mt-1 px-1">{t('import.universalCap')}</div>
          <button
            data-testid="import-format-camt"
            onClick={() => {
              setAccept(ANY_ACCEPT);
              setPickedBank(null); // universal door: no format promise, no ask
              onOpenChange(false);
              requestAnimationFrame(() => fileRef.current?.click());
            }}
            className="m-tap flex items-start gap-3 rounded-card border border-dashed border-line bg-surface p-4 text-left"
          >
            <Icon name="file-xml-box" size={22} color="var(--m-accent)" />
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-ink">{t('import.formatCamt')}</span>
              <span className="block pt-0.5 text-[12px] leading-snug text-ink-3">{t('import.formatCamtSub')}</span>
            </span>
          </button>
          {/* #177 (user): a long export helps — history powers pattern
              detection while the space start date keeps the view clean */}
          <p className="flex items-start gap-1.5 px-1 text-[12px] leading-snug text-ink-4" data-testid="import-history-tip">
            <Icon name="lightbulb-outline" size={14} color="var(--m-accent-deep)" />
            {t('import.longHistoryTip')}
          </p>
        </div>
      </Sheet>

      {/* #226 r2 (user): the pick said bank X but the file reads as
          format Y — ask before the preview. Content is state-gated so
          post-close assertions see it leave (IS_TEST sheets stay mounted). */}
      <Sheet open={mismatch !== null} onOpenChange={(next) => !next && cancelMismatch()} title={t('import.mismatchTitle')} size="compact">
        {mismatch && (
          <div className="flex flex-col gap-3 pt-1" data-testid="import-mismatch-sheet">
            <p className="text-[14px] leading-relaxed text-ink-2">
              {t('import.mismatchBody', { picked: pickedBank?.name ?? '', found: KIND_NAMES[mismatch.found] })}
            </p>
            <Button data-testid="import-mismatch-continue" onClick={confirmMismatch}>
              {t('import.mismatchContinue')}
            </Button>
            <Button variant="outline" data-testid="import-mismatch-cancel" onClick={cancelMismatch}>
              {t('action.cancel')}
            </Button>
          </div>
        )}
      </Sheet>

      {/* CAMT.053 import: preview then result */}
      {/* #203 (user): while the import runs, clicking away says "still
          running" instead of silently closing over the work */}
      <Sheet
        open={importPreview !== null}
        onOpenChange={(next) => !next && closeImport()}
        title={t('import.preview')}
        size="form"
        busyNote={importing ? t('sheet.stillRunning') : null}
      >
        {importError && (
          <div className="flex items-center gap-2 rounded-card bg-negative-soft px-4 py-3 text-[14px] text-negative" data-testid="import-error">
            <Icon name="alert-circle-outline" size={18} />
            {t('import.invalidFile')}
          </div>
        )}
        {!importError && !importResult && (
          <div className="flex flex-col gap-3 pt-1" data-testid="import-preview">
            {runFailed && (
              <div className="flex items-center gap-2 rounded-card bg-negative-soft px-4 py-3 text-[14px] text-negative" data-testid="import-run-error">
                <Icon name="alert-circle-outline" size={18} />
                {t('import.runFailed')}
              </div>
            )}
            {(importPreview ?? []).map((stmt, i) => {
              const iban = stmt.iban.replace(/\s/g, '').toUpperCase();
              const match = byIban.get(iban);
              return (
                // key by index: monthly exports repeat the same IBAN per statement
                <label key={`${stmt.iban}-${i}`} className="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3">
                  {/* #299 (user): several accounts in the pick (one CAMT
                      with many, or several files) import à la carte —
                      all checked by default, unchecking skips one */}
                  {(importPreview?.length ?? 0) > 1 && (
                    <input
                      type="checkbox"
                      data-testid={`import-select-${i}`}
                      checked={!excluded.has(i)}
                      onChange={() => toggleStatement(i)}
                      className="h-5 w-5 shrink-0 accent-[var(--m-accent)]"
                    />
                  )}
                  <Icon name={match ? 'bank-check' : 'bank-plus'} size={22} color="var(--m-accent)" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink">
                      {match?.name ?? t('import.newAccount')}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-ink-4">{stmt.iban}</span>
                    {/* export-vs-upload insight: an old export imports
                        fine and silently misses everything after it —
                        warn BEFORE the import, when a fresh export is
                        one download away */}
                    {(() => {
                      const through = statementCoverageEnd(stmt);
                      if (!through) return null;
                      const stale = daysSince(through) > 7;
                      return (
                        <span
                          className={`block text-[11px] leading-snug ${stale ? 'text-warning' : 'text-ink-4'}`}
                          data-testid={`import-through-${i}`}
                        >
                          {t(stale ? 'import.throughStale' : 'import.through', { when: fmtTimeAgo(through, lang) })}
                        </span>
                      );
                    })()}
                    {/* rows before the space's start import fine — say
                        NOW that they will sit stored-but-hidden (arc 5) */}
                    {(() => {
                      const start = activeSpace?.historyStartDate;
                      const preStart = start ? stmt.entries.filter((e) => e.date < start).length : 0;
                      if (preStart === 0) return null;
                      return (
                        <span className="block text-[11px] leading-snug text-ink-4" data-testid={`import-prestart-${i}`}>
                          {t('import.preStart', { n: preStart })}
                        </span>
                      );
                    })()}
                  </span>
                  <span className="text-[12px] text-ink-3">
                    {stmt.entries.length === 1
                      ? t('import.txCountOne')
                      : t('import.txCount', { n: stmt.entries.length })}
                  </span>
                </label>
              );
            })}
            {/* #299: zero checked — the note near the list says why */}
            <FormBlockerNote show={noneBlocked} text={t('import.selectNone')} testId="import-select-blocker" className="px-1" />
            <Button data-testid="import-run" onClick={() => void runImport()} disabled={!importPreview?.length || importing}>
              {importing ? (
                // big statements take a while — #184: narrate the count,
                // not just a spinner (user ss 2026-08-01 + #184)
                <span className="inline-flex items-center gap-2" data-testid="import-running">
                  <span className="inline-flex animate-spin">
                    <Icon name="loading" size={16} />
                  </span>
                  {progress && progress.total > 0
                    ? t('import.progressCount', { done: progress.done, total: progress.total })
                    : t('import.importing')}
                </span>
              ) : (
                importLabel
              )}
            </Button>
            {/* #300: the quiet ETA line under the narration, only once
                the rolling rows/sec window can speak honestly */}
            {importing && etaSec !== null && (
              <p className="text-center text-[11px] text-ink-4" data-testid="import-eta">
                {t('import.etaLeft', { time: fmtEtaShort(etaSec, lang) })}
              </p>
            )}
          </div>
        )}
        {importResult && (
          <div className="flex flex-col items-center gap-3 pt-4 text-center" data-testid="import-result">
            <Icon name="check-circle-outline" size={40} color="var(--m-accent)" />
            <p className="text-[14px] text-ink-2">
              {t('import.done', { n: importResult.imported, s: importResult.skipped })}
            </p>
            {(() => {
              const start = activeSpace?.historyStartDate;
              // #299: only what actually imported counts here
              const preStart = start
                ? selectedStatements.reduce((sum, stmt) => sum + stmt.entries.filter((e) => e.date < start).length, 0)
                : 0;
              if (preStart === 0) return null;
              return (
                <p className="text-[12px] text-ink-4" data-testid="import-result-prestart">
                  {t('import.preStart', { n: preStart })}
                </p>
              );
            })()}
            {/* #204 (user): the account is global and NOT attached — say
                so plainly and door into the explicit attach flow, where
                the type and the history gate are the user's choices */}
            {importResult.accounts.some((a) => a.attached === false) && (
              <div className="w-full rounded-card border border-accent/40 bg-accent-soft/30 px-4 py-3 text-left" data-testid="import-unattached-note">
                <p className="text-[13px] font-medium text-ink">{t('import.notAttachedTitle')}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{t('import.notAttachedBody')}</p>
                {/* #278: "a space" was a riddle — name the space the
                    button below will attach into (the active one) */}
                <p className="mt-1 text-[12px] leading-relaxed font-medium text-ink-2" data-testid="import-attach-target">
                  {t('acct.importAttachTarget', { space: activeSpace?.name ?? '' })}
                </p>
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  data-testid="import-goto-attach"
                  onClick={() => {
                    // #310 (user): land with the attach sheet OPEN — and
                    // when exactly one account waits, on its final step
                    const unattached = importResult.accounts.filter((a) => a.attached === false);
                    setSpaceAttachIntent(unattached.length === 1 ? unattached[0].accountId : undefined);
                    closeImport();
                    void navigate({ to: '/spaces/$spaceId/accounts', params: { spaceId } });
                  }}
                >
                  {t('import.gotoAttach')}
                </Button>
              </div>
            )}
            <Button variant="outline" data-testid="import-close" onClick={closeImport}>
              {t('action.done')}
            </Button>
          </div>
        )}
      </Sheet>
    </>
  );
}
