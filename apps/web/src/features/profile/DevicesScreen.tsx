import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLang } from '@/i18n';
import { useData } from '@/app/data';
import { logActivity } from '@/application/activity';
import { getDeviceId } from '@/db/device';
import { apiFetch } from '@/lib/api';
import { fmtTimeAgo } from '@/lib/text';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { DangerConfirmSheet } from '@/ui/DangerConfirmSheet';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';

interface DeviceDto {
  id: string;
  platform: string | null;
  name: string | null;
  createdAt: string;
  lastSeenAt: string;
  revoked: boolean;
}

const PLATFORM_ICONS: Record<string, string> = {
  android: 'cellphone',
  ios: 'cellphone',
  web: 'laptop',
};

/** #158: best-effort browser name for THIS device only — the server keeps
 *  no UA column, so other rows stay apart via the twin numbering instead.
 *  Order matters: Edge/Opera UAs also carry "Chrome", Chrome carries
 *  "Safari". Brand names are proper nouns — never translated. */
export function browserLabel(): string | null {
  const ua = navigator.userAgent;
  if (ua.includes('Firefox/')) return 'Firefox';
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('OPR/')) return 'Opera';
  if (ua.includes('Chrome/')) return 'Chrome';
  if (ua.includes('Safari/')) return 'Safari';
  return null;
}

/**
 * Logged-in devices (docs/logged-in-devices-plan.md, approved answers):
 * every device this account is signed in on — auto-named but renamable,
 * last seen, and a remote disconnect that WIPES the other device on its
 * next connection. This device itself signs out via the profile.
 */
export function DevicesScreen() {
  const { t, lang } = useLang();
  const { store, repo, spaceId } = useData();
  const [devices, setDevices] = useState<DeviceDto[] | null>(null);
  const [renaming, setRenaming] = useState<DeviceDto | null>(null);
  const [name, setName] = useState('');
  const [revoking, setRevoking] = useState<DeviceDto | null>(null);
  const myId = getDeviceId();

  const reload = useCallback(async () => {
    const res = await apiFetch('/me/devices').catch(() => null);
    if (res?.ok) setDevices((await res.json()) as DeviceDto[]);
  }, []);
  useEffect(() => void reload(), [reload]);

  const platformLabel = useCallback(
    (device: DeviceDto) => {
      if (device.platform === 'android') return t('devices.android');
      if (device.platform === 'ios') return t('devices.ios');
      return t('devices.web');
    },
    [t],
  );

  // #158: twins ("Browser", "Browser") get " (2)", " (3)" by CreatedAt age —
  // the oldest keeps the bare name, so labels stay put as devices arrive
  const displayNames = useMemo(() => {
    const counts = new Map<string, number>();
    const names = new Map<string, string>();
    for (const device of [...(devices ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const base = device.name ?? platformLabel(device);
      const n = (counts.get(base) ?? 0) + 1;
      counts.set(base, n);
      names.set(device.id, n === 1 ? base : `${base} (${n})`);
    }
    return names;
  }, [devices, platformLabel]);

  // computed once per render: the UA never changes mid-session
  const myBrowser = browserLabel();

  const saveRename = async () => {
    if (!renaming || !name.trim()) return;
    await apiFetch(`/me/devices/${renaming.id}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) }).catch(
      () => null,
    );
    setRenaming(null);
    await reload();
  };

  const confirmRevoke = async () => {
    if (!revoking) return;
    const res = await apiFetch(`/me/devices/${revoking.id}/revoke`, { method: 'POST' }).catch(() => null);
    if (res?.ok) void logActivity(store, repo, spaceId, 'deviceRevoke', revoking.name ?? platformLabel(revoking));
    setRevoking(null);
    await reload();
  };

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-devices">
      <AppBar
        title={t('devices.title')}
        leading={
          <IconButton label={t('action.back')} testId="devices-back" onClick={() => window.history.back()}>
            <Icon name="chevron-left" size={24} />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <p className="mt-1 mb-3 text-[12px] text-ink-3">{t('devices.sub')}</p>
        <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="devices-list">
          {(devices ?? []).map((device) => {
            const mine = device.id === myId;
            return (
              <div
                key={device.id}
                data-testid={`device-row-${device.id}`}
                className={`flex items-center gap-3 border-b border-line-2 px-4 py-3 last:border-0 ${device.revoked ? 'opacity-55' : ''}`}
              >
                <Icon name={PLATFORM_ICONS[device.platform ?? 'web'] ?? 'laptop'} size={20} color="var(--m-ink-3)" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[14px] text-ink">
                    <span className="truncate">{displayNames.get(device.id) ?? device.name ?? platformLabel(device)}</span>
                    {mine && (
                      <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent-deep" data-testid="device-this">
                        {t('devices.thisDevice')}
                      </span>
                    )}
                  </span>
                  <span className="block text-[11px] text-ink-4">
                    {/* #158: only this device knows its own browser — the
                        server has no UA to say it for the others */}
                    {mine && (device.platform ?? 'web') === 'web' && myBrowser && (
                      <span data-testid="device-browser">{myBrowser} · </span>
                    )}
                    {device.revoked ? t('devices.revoked') : t('devices.seen', { when: fmtTimeAgo(device.lastSeenAt, lang) })}
                  </span>
                </span>
                <button
                  aria-label={t('devices.rename')}
                  data-testid={`device-rename-${device.id}`}
                  onClick={() => {
                    setRenaming(device);
                    setName(device.name ?? platformLabel(device));
                  }}
                  className="m-tap border-none bg-transparent text-ink-4"
                >
                  <Icon name="pencil-outline" size={17} />
                </button>
                {!mine && !device.revoked && (
                  <button
                    aria-label={t('devices.disconnect')}
                    data-testid={`device-revoke-${device.id}`}
                    onClick={() => setRevoking(device)}
                    className="m-tap border-none bg-transparent text-negative"
                  >
                    <Icon name="link-off" size={18} />
                  </button>
                )}
              </div>
            );
          })}
          {devices !== null && devices.length === 0 && (
            <div className="px-4 py-6 text-center text-[12px] text-ink-4">—</div>
          )}
        </div>
      </div>

      <Sheet open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)} title={t('devices.rename')} size="compact">
        <div className="flex flex-col gap-3 pt-1">
          <input
            data-testid="device-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none"
          />
          <Button data-testid="device-name-save" onClick={() => void saveRename()}>
            {t('action.save')}
          </Button>
        </div>
      </Sheet>

      <DangerConfirmSheet
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={t('devices.disconnect')}
        body={t('devices.disconnectBody', { name: revoking ? (revoking.name ?? platformLabel(revoking)) : '' })}
        onConfirm={() => void confirmRevoke()}
        testId="device-revoke-confirm"
      />
    </div>
  );
}
