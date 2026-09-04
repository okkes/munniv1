import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useSession } from '@/app/session';
import { apiFetch } from '@/lib/api';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';

interface InvitePeek {
  splitName: string;
  currency: string;
  inviterName: string | null;
}

/**
 * Join screen (SP3): an invitee sees ONLY the split name + inviter —
 * design rule — and picks which of THEIR OWN spaces the split attaches
 * to (per-member attachment; nobody else ever sees the choice).
 */
export function SplitJoinScreen() {
  const { t } = useLang();
  const navigate = useNavigate();
  const { token } = useParams({ strict: false }) as { token: string };
  const { identity } = useSession();
  const { store, spaceId: activeSpaceId } = useData();
  const [peek, setPeek] = useState<InvitePeek | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const spaces = useQuery(store, async () => (await store.allRows('space')).filter((s) => s.deleted === 0), []);

  const load = useCallback(async () => {
    const res = await apiFetch(`/splits/invites/${token}`).catch(() => null);
    if (res?.ok) setPeek((await res.json()) as InvitePeek);
    else setInvalid(true);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const join = async () => {
    setBusy(true);
    const res = await apiFetch(`/splits/invites/${token}/accept`, {
      method: 'POST',
      body: JSON.stringify({ spaceId: picked ?? activeSpaceId }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setInvalid(true);
      return;
    }
    const { splitId } = (await res.json()) as { splitId: string };
    await navigate({ to: '/splits/$splitId', params: { splitId }, replace: true });
  };

  if (identity?.kind !== 'user') return null;

  return (
    <div className="flex h-dvh flex-col bg-bg" data-testid="screen-split-join">
      <AppBar
        title={t('splits.joinTitle')}
        leading={
          <IconButton label={t('action.back')} testId="split-join-back" onClick={() => window.history.back()}>
            <Icon name="chevron-left" size={24} />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {invalid && (
          <div className="pt-16 text-center" data-testid="split-join-invalid">
            <Icon name="link-variant-off" size={40} color="var(--m-ink-4)" />
            <p className="mx-auto mt-3 max-w-[280px] text-[14px] text-ink-2">{t('splits.inviteInvalid')}</p>
          </div>
        )}
        {peek && !invalid && (
          <>
            <div className="mt-4 rounded-card border border-line bg-surface p-5 text-center" data-testid="split-join-card">
              <Icon name="account-cash-outline" size={36} color="var(--m-accent-deep)" />
              {peek.inviterName && (
                <p className="mt-2 text-[13px] text-ink-3">{t('splits.invitedBy', { name: peek.inviterName })}</p>
              )}
              <p className="mt-1 text-[19px] font-semibold text-ink">{peek.splitName}</p>
            </div>

            <div className="m-cap mt-6 mb-1 px-1">{t('splits.attachPrompt')}</div>
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              {(spaces ?? []).map((space) => {
                const active = (picked ?? activeSpaceId) === space.id;
                return (
                  <button
                    key={space.id}
                    data-testid={`split-join-space-${space.id}`}
                    onClick={() => setPicked(space.id)}
                    className="m-tap flex w-full items-center gap-3 border-b border-line-2 bg-transparent px-4 py-3 text-left last:border-0"
                  >
                    <Icon
                      name={active ? 'radiobox-marked' : 'radiobox-blank'}
                      size={20}
                      color={active ? 'var(--m-accent-deep)' : 'var(--m-ink-4)'}
                    />
                    <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{space.name}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 px-1 text-[12px] text-ink-4">{t('splits.attachHint')}</p>

            <div className="mt-6 flex flex-col">
              <Button data-testid="split-join-confirm" disabled={busy} onClick={() => void join()}>
                {t('splits.join')}
              </Button>
            </div>
          </>
        )}
        {!peek && !invalid && <div className="px-4 py-16 text-center text-[13px] text-ink-4">…</div>}
      </div>
    </div>
  );
}
