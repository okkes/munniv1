import { useState } from 'react';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useSession } from '@/app/session';
import { useQuery } from '@/db/useQuery';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { DangerConfirmSheet } from '@/ui/DangerConfirmSheet';
import { Icon } from '@/ui/Icon';
import { Chip } from '@/ui/primitives';
import { convertToOffline } from './goOffline';

const KEEP_ROWS = [
  ['database-check-outline', 'goOffline.keep1'],
  ['file-document-outline', 'goOffline.keep2'],
  ['shield-lock-outline', 'goOffline.keep3'],
] as const;

const END_ROWS = [
  ['bank-off', 'goOffline.end1'],
  ['account-group-outline', 'goOffline.end2'],
  ['cloud-off-outline', 'goOffline.end3'],
] as const;

/**
 * Online → offline conversion, consent-first (OO2): what stays, what
 * ends, a keep/remove choice per shared space, and the server-data
 * deletion default. The conversion itself is an identity rebind — the
 * local store is adopted as-is (goOffline.ts).
 */
export function GoOfflineScreen() {
  const { t } = useLang();
  const { store, repo, engine, spaceId, setActiveSpace } = useData();
  const { identity, logout, login } = useSession();
  const navigate = useNavigate();
  const router = useRouter();

  const spaces = useQuery(store, async () => (await store.allRows('space')).filter((s) => s.deleted === 0), []);
  const profile = useQuery(
    store,
    async () => (await store.metaGet('profile'))?.value as { name?: string; picture?: string } | undefined,
    [],
  );
  const sharedSpaces = (spaces ?? []).filter((s) => s.kind === 'shared');
  const [dropIds, setDropIds] = useState<ReadonlySet<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggleDrop = (id: string, drop: boolean) => {
    const next = new Set(dropIds);
    if (drop) next.add(id);
    else next.delete(id);
    setDropIds(next);
  };

  const run = async () => {
    if (identity?.kind !== 'user' || busy) return;
    setBusy(true);
    // the active space must survive the purge — move to a kept one first
    if (dropIds.has(spaceId)) {
      const survivor = (spaces ?? []).find((s) => !dropIds.has(s.id));
      if (survivor) await setActiveSpace(survivor.id);
    }
    const profileId = await convertToOffline(
      { store, repo, engine, identity },
      {
        dropSpaceIds: [...dropIds],
        profileName: profile?.name ?? 'munni',
        profilePicture: profile?.picture,
      },
    );
    if (!profileId) {
      setBusy(false);
      return; // not a user identity — nothing to convert
    }
    logout();
    login({ kind: 'offline', profileId });
    await navigate({ to: '/home' });
  };

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-go-offline">
      <AppBar
        title={t('goOffline.title')}
        leading={
          <IconButton label={t('action.back')} testId="gooffline-back" onClick={() => router.history.back()}>
            <Icon name="chevron-left" size={24} />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
        <p className="pt-1 pb-4 text-[13px] leading-relaxed text-ink-2">{t('goOffline.intro')}</p>

        <p className="pb-2 text-[12px] font-semibold tracking-wide text-ink-2 uppercase">{t('offline.keepTitle')}</p>
        <div className="mb-4 overflow-hidden rounded-card border border-line bg-surface" data-testid="gooffline-keep-card">
          {KEEP_ROWS.map(([icon, key]) => (
            <div key={key} className="flex items-start gap-3 border-b border-line-2 px-4 py-3 last:border-0">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft">
                <Icon name={icon} size={17} color="var(--m-accent-deep)" />
              </span>
              <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink-2">{t(key)}</span>
            </div>
          ))}
        </div>

        <p className="pb-2 text-[12px] font-semibold tracking-wide text-ink-2 uppercase">{t('goOffline.endTitle')}</p>
        <div className="mb-4 overflow-hidden rounded-card border border-line bg-surface" data-testid="gooffline-end-card">
          {END_ROWS.map(([icon, key]) => (
            <div key={key} className="flex items-start gap-3 border-b border-line-2 px-4 py-3 last:border-0">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-2">
                <Icon name={icon} size={17} color="var(--m-ink-3)" />
              </span>
              <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink-2">{t(key)}</span>
            </div>
          ))}
        </div>

        {sharedSpaces.length > 0 && (
          <>
            <p className="pb-1 text-[12px] font-semibold tracking-wide text-ink-2 uppercase">{t('goOffline.sharedTitle')}</p>
            <p className="pb-2 text-[12px] text-ink-4">{t('goOffline.sharedSub')}</p>
            <div className="mb-4 overflow-hidden rounded-card border border-line bg-surface">
              {sharedSpaces.map((space) => (
                <div key={space.id} className="flex items-center gap-3 border-b border-line-2 px-4 py-3 last:border-0" data-testid={`gooffline-space-${space.id}`}>
                  <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{space.name}</span>
                  <Chip testId={`gooffline-keep-${space.id}`} selected={!dropIds.has(space.id)} onClick={() => toggleDrop(space.id, false)}>
                    {t('goOffline.keepSnapshot')}
                  </Chip>
                  <Chip testId={`gooffline-drop-${space.id}`} selected={dropIds.has(space.id)} onClick={() => toggleDrop(space.id, true)}>
                    {t('goOffline.remove')}
                  </Chip>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="mb-3 px-1 text-[12px] leading-snug text-ink-3">{t('goOffline.noWayBack')}</p>
        <Button variant="danger" data-testid="gooffline-open-confirm" disabled={busy} onClick={() => setConfirmOpen(true)}>
          {t('goOffline.confirm')}
        </Button>
      </div>

      <DangerConfirmSheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('goOffline.confirmTitle')}
        body={t('goOffline.confirmBody')}
        onConfirm={() => void run()}
        testId="gooffline"
      />
    </div>
  );
}
