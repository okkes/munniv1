import { useMemo, useRef, useState } from 'react';
import { useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useQuery } from '@/db/useQuery';
import { useSession } from '@/app/session';
import { logActivity } from '@/application/activity';
import { linkAllCounterparties } from '@/application/counterLink';
import { linkPaypalFunding } from '@/application/paypalLink';
import { linkTransferPairs } from '@/application/transferMatch';
import { applyTitleMemory } from '@/application/titleMemory';
import { parseStatement } from '@/lib/statements/parseStatement';
import type { ParsedStatement } from '@/lib/statements/parseStatement';
import { fmtTimeAgo } from '@/lib/text';
import { apiFeedGateway, fetchMyFeedIds } from './feedGateway';
import { importCamtStatements, statementCoverageEnd } from './importCamt';
import type { ImportResult } from './importCamt';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';

const daysSince = (iso: string): number => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

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
  const identity = useSession((s) => s.identity);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<ParsedStatement[] | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState(false);
  const [runFailed, setRunFailed] = useState(false);
  const [importing, setImporting] = useState(false);

  const activeSpace = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  // IBAN matching spans every account the device knows (both pools)
  const allAccounts = useQuery(store, async () => (await store.allRows('account')).filter((a) => a.deleted === 0), []);
  const byIban = useMemo(
    () => new Map((allAccounts ?? []).filter((a) => a.iban).map((a) => [a.iban!.replace(/\s/g, '').toUpperCase(), a])),
    [allAccounts],
  );

  const onFilePicked = async (files: FileList | null) => {
    const picked = [...(files ?? [])];
    if (picked.length === 0) return;
    setImportError(false);
    setImportResult(null);
    try {
      // several exports in one go (user request): parse each file and
      // pool the statements — dedupe refs make overlaps import cleanly
      const statements: ParsedStatement[] = [];
      for (const file of picked) {
        statements.push(...parseStatement(await file.text(), file.name));
      }
      setImportPreview(statements);
    } catch {
      setImportPreview(null);
      setImportError(true);
      setImportPreview([]); // open the sheet to show the error
    }
  };

  const runImport = async () => {
    if (!importPreview?.length || importing) return; // double-taps fired PARALLEL imports (user report 2026-07-25)
    setImporting(true);
    // syncing identities import into feed spaces (shared-accounts model);
    // demo/offline keep everything merged in the current space
    const feeds = identity?.kind === 'user' ? apiFeedGateway(identity.sub) : undefined;
    try {
      setImportResult(await importCamtStatements(repo, store, spaceId, importPreview, feeds));
    } catch {
      // a failed run (feed registration, server away) must SAY so —
      // a silently unchanged screen reads as "the app is broken"
      // (user report 2026-07-24); the preview stays for a retry
      setRunFailed(true);
      return;
    } finally {
      setImporting(false);
    }
    setRunFailed(false);
    void logActivity(store, repo, spaceId, 'importRun', `${importPreview.length}`);
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
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".xml,.csv,text/xml,application/xml,text/csv"
        multiple
        hidden
        data-testid="accounts-import-input"
        onChange={(e) => void onFilePicked(e.target.files)}
      />

      {/* which export is this? each row explains how to get the file */}
      <Sheet open={open} onOpenChange={onOpenChange} title={t('import.pickFormat')} size="form">
        <div className="flex flex-col gap-2 pt-1" data-testid="import-format-pick">
          {note && (
            <p className="pb-1 text-[12px] leading-snug text-ink-3" data-testid="import-global-note">
              {note}
            </p>
          )}
          {(
            [
              ['import-format-camt', 'file-xml-box', 'import.formatCamt', 'import.formatCamtSub'],
              ['import-format-ing', 'file-delimited-outline', 'import.formatIng', 'import.formatIngSub'],
            ] as const
          ).map(([testId, icon, titleKey, subKey]) => (
            <button
              key={testId}
              data-testid={testId}
              onClick={() => {
                onOpenChange(false);
                fileRef.current?.click();
              }}
              className="m-tap flex items-start gap-3 rounded-card border border-line bg-surface p-4 text-left"
            >
              <Icon name={icon} size={22} color="var(--m-accent)" />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-ink">{t(titleKey)}</span>
                <span className="block pt-0.5 text-[12px] leading-snug text-ink-3">{t(subKey)}</span>
              </span>
            </button>
          ))}
        </div>
      </Sheet>

      {/* CAMT.053 import: preview then result */}
      <Sheet open={importPreview !== null} onOpenChange={(next) => !next && closeImport()} title={t('import.preview')} size="form">
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
                <div key={`${stmt.iban}-${i}`} className="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3">
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
                </div>
              );
            })}
            <Button data-testid="import-run" onClick={() => void runImport()} disabled={!importPreview?.length || importing}>
              {importing ? (
                // big statements take a while — say so instead of freezing
                // on a dead button (user ss 2026-08-01)
                <span className="inline-flex items-center gap-2" data-testid="import-running">
                  <span className="inline-flex animate-spin">
                    <Icon name="loading" size={16} />
                  </span>
                  {t('import.importing')}
                </span>
              ) : (
                t('import.doImport')
              )}
            </Button>
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
              const preStart = start
                ? (importPreview ?? []).reduce((sum, stmt) => sum + stmt.entries.filter((e) => e.date < start).length, 0)
                : 0;
              if (preStart === 0) return null;
              return (
                <p className="text-[12px] text-ink-4" data-testid="import-result-prestart">
                  {t('import.preStart', { n: preStart })}
                </p>
              );
            })()}
            <Button variant="outline" data-testid="import-close" onClick={closeImport}>
              {t('action.done')}
            </Button>
          </div>
        )}
      </Sheet>
    </>
  );
}
