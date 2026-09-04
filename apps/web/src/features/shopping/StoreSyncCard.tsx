import { useCallback, useEffect, useState } from 'react';
import {
  adoptWrapIfApproved,
  approveDevice,
  disableStoreSync,
  enableStoreSync,
  listSyncDevices,
  localDevice,
  requestEnrollment,
  revokeDevice,
  syncEnabled,
} from '@/application/storeSync';
import type { SyncDeviceInfo } from '@/application/storeSync';
import { fingerprintOf } from '@/lib/connCrypto';
import { useData } from '@/app/data';
import { useLang } from '@/i18n';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Pill } from '@/ui/primitives';

/**
 * SC2: the opt-in "use my store logins on my other devices" card.
 * Enabling publishes only ciphertext; a NEW device asks to join and any
 * enrolled device approves it after comparing the 6-digit fingerprint
 * both screens display — the human check against a server-swapped key.
 */
export function StoreSyncCard() {
  const { t } = useLang();
  const { store } = useData();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<SyncDeviceInfo[]>([]);
  const [myDeviceId, setMyDeviceId] = useState('');
  const [myFingerprint, setMyFingerprint] = useState('');
  const [prints, setPrints] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingHere, setPendingHere] = useState(false);

  const reload = useCallback(async () => {
    const [isEnabled, list, device] = await Promise.all([syncEnabled(store), listSyncDevices(), localDevice(store)]);
    setEnabled(isEnabled);
    setDevices(list);
    setMyDeviceId(device.deviceId);
    setMyFingerprint(await fingerprintOf(device.publicJwk));
    const entries = await Promise.all(list.map(async (d) => [d.deviceId, await fingerprintOf(d.publicJwk)] as const));
    setPrints(Object.fromEntries(entries));
    // this device is registered but not yet approved by a sibling
    setPendingHere(!isEnabled && list.some((d) => d.deviceId === device.deviceId));
  }, [store]);

  useEffect(() => {
    void reload().catch(() => undefined);
  }, [reload]);

  // waiting for approval: poll until a sibling wraps the key for us
  useEffect(() => {
    if (!pendingHere) return;
    const timer = setInterval(() => {
      void adoptWrapIfApproved(store)
        .then((approved) => {
          if (approved) void reload();
        })
        .catch(() => undefined);
    }, 5_000);
    return () => clearInterval(timer);
  }, [pendingHere, store, reload]);

  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    void fn()
      .catch(() => undefined)
      .finally(() => {
        setBusy(false);
        void reload().catch(() => undefined);
      });
  };

  const headerAction = () => {
    if (enabled) {
      return (
        <Button size="sm" variant="outline" data-testid="store-sync-off" disabled={busy} onClick={() => act(() => disableStoreSync(store))}>
          {t('shopsync.turnOff')}
        </Button>
      );
    }
    if (pendingHere) {
      return <Pill tone="warning" testId="store-sync-pending">{t('shopsync.waiting')}</Pill>;
    }
    return (
      <Button size="sm" data-testid="store-sync-on" disabled={busy} onClick={() => act(() => (devices.length > 0 ? requestEnrollment(store) : enableStoreSync(store)))}>
        {t('shopsync.turnOn')}
      </Button>
    );
  };

  if (enabled === null) return null;
  const others = devices.filter((d) => d.deviceId !== myDeviceId);
  const pendingOthers = others.filter((d) => !d.hasWrap);

  return (
    <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface" data-testid="store-sync-card">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <Icon name={enabled ? 'sync-circle' : 'sync-off'} size={20} color={enabled ? 'var(--m-accent)' : 'var(--m-ink-3)'} />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] text-ink">{t('shopsync.title')}</span>
          <span className="block text-[12px] text-ink-4">{t('shopsync.sub')}</span>
        </span>
        {headerAction()}
      </div>

      {/* the mechanics in three sentences (user: "a bit confusing") —
          foldable so the card stays calm once understood */}
      <details className="border-t border-line-2 px-4 py-2.5" data-testid="store-sync-how">
        <summary className="cursor-pointer list-none text-[12px] font-medium text-accent-deep">
          {t('shopsync.howTitle')}
        </summary>
        <ol className="mt-1.5 flex list-decimal flex-col gap-1 pl-4 text-[12px] leading-relaxed text-ink-3">
          <li>{t('shopsync.how1')}</li>
          <li>{t('shopsync.how2')}</li>
          <li>{t('shopsync.how3')}</li>
        </ol>
      </details>

      {(pendingHere || enabled) && (
        <p className="border-t border-line-2 px-4 py-2.5 text-[12px] text-ink-3" data-testid="store-sync-fingerprint">
          {t('shopsync.thisDevice')} · <span className="font-mono font-semibold text-ink">{myFingerprint}</span>
        </p>
      )}

      {enabled && pendingOthers.length > 0 && (
        <div className="border-t border-line-2">
          {pendingOthers.map((device) => (
            <div key={device.deviceId} className="flex items-center gap-3 px-4 py-3" data-testid={`store-sync-approve-${device.deviceId}`}>
              <Icon name="cellphone-link" size={18} color="var(--m-warning)" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] text-ink">{t('shopsync.wantsAccess', { name: device.name })}</span>
                <span className="block font-mono text-[12px] text-ink-3">{prints[device.deviceId]}</span>
              </span>
              <Button size="sm" disabled={busy} data-testid={`store-sync-grant-${device.deviceId}`} onClick={() => act(() => approveDevice(store, device))}>
                {t('shopsync.approve')}
              </Button>
            </div>
          ))}
          <p className="px-4 pb-2.5 text-[11px] text-ink-4">{t('shopsync.compareHint')}</p>
        </div>
      )}

      {enabled && others.some((d) => d.hasWrap) && (
        <div className="border-t border-line-2">
          {others.filter((d) => d.hasWrap).map((device) => (
            <div key={device.deviceId} className="flex items-center gap-3 px-4 py-2.5" data-testid={`store-sync-device-${device.deviceId}`}>
              <Icon name="cellphone-check" size={17} color="var(--m-ink-3)" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{device.name}</span>
              <span className="font-mono text-[11px] text-ink-4">{prints[device.deviceId]}</span>
              <button
                data-testid={`store-sync-revoke-${device.deviceId}`}
                disabled={busy}
                onClick={() => act(() => revokeDevice(device.deviceId))}
                className="m-tap border-none bg-transparent text-[12px] font-medium text-negative"
              >
                {t('shopsync.revoke')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
