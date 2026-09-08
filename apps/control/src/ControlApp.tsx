import { useCallback, useEffect, useState } from 'react';
import type { ControlConfig } from './config';

/** one consent on the SHARED GoCardless account, attributed to the
 * environment whose redirect origin it carries (plan LS4/LS5) */
interface ControlConsent {
  requisitionId: string;
  status: string;
  institutionId: string;
  created: string | null;
  accountCount: number;
  environmentOrigin: string | null;
  ownedHere: boolean;
}
interface ProviderQuota {
  provider: string;
  scope: string;
  limit: number | null;
  remaining: number | null;
  resetAtUtc: string | null;
  capturedAtUtc: string;
}
interface HealthInfo {
  build?: string;
  capabilities?: Record<string, unknown>;
}

const STATUS_LABEL: Record<string, string> = {
  CR: 'created', LN: 'linked', EX: 'expired', RJ: 'rejected', SU: 'suspended',
  GA: 'authorizing', UA: 'authorizing', GC: 'consenting', SA: 'selecting',
};

type Screen = 'overview' | 'connections' | 'quota';

const NAV: [Screen, string][] = [
  ['overview', 'Overview'],
  ['connections', 'Bank connections'],
  ['quota', 'Quota'],
];

/** grouping key for consents whose redirect carried no usable origin */
const UNATTRIBUTED = 'unattributed';

/** consents per redirect origin, named environments first, unattributed last */
function groupByOrigin(consents: ControlConsent[]): [string, ControlConsent[]][] {
  const groups = new Map<string, ControlConsent[]>();
  for (const c of consents) {
    const key = c.environmentOrigin ?? UNATTRIBUTED;
    const list = groups.get(key) ?? [];
    if (list.length === 0) groups.set(key, list);
    list.push(c);
  }
  return [...groups.entries()].sort(
    ([a], [b]) => Number(a === UNATTRIBUTED) - Number(b === UNATTRIBUTED) || a.localeCompare(b),
  );
}

interface ControlAppProps {
  config: ControlConfig;
  /** null = test-auth mode (X-User-Sub header from the sub box) */
  getToken: (() => Promise<string | undefined>) | null;
}

/**
 * munni control (admin split LS5/LS6): the shared-services cockpit — a
 * deliberately SEPARATE app from the per-environment admin portal. It
 * talks only to the /control/* surface of the designated environment's
 * API and is read-only across the board: every consent on the shared
 * GoCardless account attributed per environment, plus the account-wide
 * quota. Deletion stays in each environment's own admin portal.
 */
export function ControlApp({ config, getToken }: Readonly<ControlAppProps>) {
  // survives the full page reload a Logto re-auth causes (else every token
  // hiccup dumps the operator back on Overview mid-task)
  const [screen, setScreen] = useState<Screen>(() => {
    const saved = sessionStorage.getItem('munni_control_screen');
    return NAV.some(([id]) => id === saved) ? (saved as Screen) : 'overview';
  });
  const openScreen = (next: Screen) => {
    sessionStorage.setItem('munni_control_screen', next);
    setScreen(next);
  };
  const [sub, setSub] = useState(() => localStorage.getItem('munni_control_sub') ?? '');
  const [consents, setConsents] = useState<ControlConsent[] | null>(null);
  const [quota, setQuota] = useState<ProviderQuota[]>([]);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  // 'denied' = the api really said 403; 'unreachable' = the ping never
  // got an answer (network/CORS/5xx) — the two used to share one message
  // and a blocked request read as "not an admin" (found live 2026-08-28)
  const [denied, setDenied] = useState(false);
  const [unreachable, setUnreachable] = useState(false);

  const call = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set('Content-Type', 'application/json');
      if (getToken) {
        const token = await getToken();
        if (token) headers.set('Authorization', `Bearer ${token}`);
      } else if (sub) {
        headers.set('X-User-Sub', sub);
      }
      return fetch(`${config.apiUrl}${path}`, { ...init, headers });
    },
    [config.apiUrl, getToken, sub],
  );

  const reload = useCallback(async () => {
    const ping = await call('/control/ping').catch(() => null);
    setDenied(ping?.status === 403);
    setUnreachable(!ping || (!ping.ok && ping.status !== 403));
    if (!ping?.ok) return;
    const [consentsRes, quotaRes, healthRes] = await Promise.all([
      call('/control/consents'),
      call('/control/quota'),
      fetch(`${config.apiUrl}/health`).catch(() => null),
    ]);
    if (consentsRes.ok) setConsents((await consentsRes.json()) as ControlConsent[]);
    if (quotaRes.ok) setQuota((await quotaRes.json()) as ProviderQuota[]);
    if (healthRes?.ok) setHealth((await healthRes.json()) as HealthInfo);
  }, [call, config.apiUrl]);

  useEffect(() => {
    if (getToken || sub) void reload();
  }, [reload, getToken, sub]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          munni<span className="dot">.</span> <span className="brand-sub">control</span>
        </div>
        <nav>
          {NAV.map(([id, label]) => (
            <button
              key={id}
              data-testid={`nav-${id}`}
              className={screen === id ? 'active' : ''}
              onClick={() => openScreen(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          {!getToken && (
            <input
              data-testid="control-sub"
              value={sub}
              placeholder="test subject (X-User-Sub)"
              onChange={(e) => {
                setSub(e.target.value);
                localStorage.setItem('munni_control_sub', e.target.value);
              }}
            />
          )}
        </div>
      </aside>

      <main className="content">
        {denied && <p className="denied">This account is not on the admin list.</p>}
        {unreachable && <p className="denied">The control API did not answer — is the environment running (and this origin allowed)?</p>}
        {!denied && !unreachable && screen === 'overview' && <OverviewScreen consents={consents} health={health} />}
        {!denied && !unreachable && screen === 'connections' && <ConsentsScreen consents={consents} />}
        {!denied && !unreachable && screen === 'quota' && <QuotaScreen quota={quota} />}
      </main>
    </div>
  );
}

function Tile({ label, value, warn = false }: Readonly<{ label: string; value: string; warn?: boolean }>) {
  return (
    <div className={`tile ${warn ? 'tile-warn' : ''}`}>
      <div className="tile-value">{value}</div>
      <div className="tile-label">{label}</div>
    </div>
  );
}

/** the shared account's rate-limit snapshots (captured by each env's API
 * from its own sync traffic — one account, one budget) */
function QuotaTable({ quota, testId }: Readonly<{ quota: ProviderQuota[]; testId: string }>) {
  return (
    <table data-testid={testId}>
      <thead>
        <tr>
          <th>Scope</th>
          <th>Remaining</th>
          <th>Resets</th>
          <th>Seen</th>
        </tr>
      </thead>
      <tbody>
        {quota.map((q) => (
          <tr key={`${q.provider}:${q.scope}`}>
            <td>{q.scope}</td>
            <td className={q.remaining !== null && q.limit !== null && q.remaining <= q.limit / 5 ? 'warn' : ''}>
              {q.remaining ?? '—'} / {q.limit ?? '—'}
            </td>
            <td>{q.resetAtUtc ? new Date(q.resetAtUtc).toLocaleString() : '—'}</td>
            <td>{new Date(q.capturedAtUtc).toLocaleString()}</td>
          </tr>
        ))}
        {quota.length === 0 && (
          <tr>
            <td colSpan={4}>No snapshots yet — they appear after the next bank sync.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** the cross-environment landing — consent totals per environment plus
 * the designated environment's own health probe */
function OverviewScreen({
  consents,
  health,
}: Readonly<{ consents: ControlConsent[] | null; health: HealthInfo | null }>) {
  const rows = consents ?? [];
  const origins = groupByOrigin(rows);
  const caps = Object.entries(health?.capabilities ?? {}).filter(([, v]) => typeof v === 'boolean');
  return (
    <>
      <h1>Overview</h1>
      <div className="tiles" data-testid="control-tiles">
        <Tile label="Consents" value={String(rows.length)} />
        <Tile label="Linked accounts" value={String(rows.reduce((sum, c) => sum + c.accountCount, 0))} />
        <Tile label="Environments" value={String(origins.filter(([origin]) => origin !== UNATTRIBUTED).length)} />
      </div>

      <section className="card">
        <h2>Consents per environment</h2>
        <p className="hint">Attributed by the redirect origin each environment stamps on its consents.</p>
        <table data-testid="control-origins">
          <thead>
            <tr>
              <th>Environment</th>
              <th>Consents</th>
              <th>Linked accounts</th>
            </tr>
          </thead>
          <tbody>
            {origins.map(([origin, list]) => (
              <tr key={origin}>
                <td>{origin}</td>
                <td>{list.length}</td>
                <td>{list.reduce((sum, c) => sum + c.accountCount, 0)}</td>
              </tr>
            ))}
            {origins.length === 0 && (
              <tr>
                <td colSpan={3}>—</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {health && (
        <section className="card">
          <h2>Environment health</h2>
          <p className="hint">The designated environment&apos;s API serves /control.</p>
          <div className="chips" data-testid="control-health">
            <span className="chip on">build {health.build ?? '—'}</span>
            {caps.map(([name, on]) => (
              <span key={name} className={`chip ${on ? 'on' : ''}`}>
                {name}
              </span>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/** EVERY consent on the shared GoCardless account, grouped per
 * environment. Read-only by design — deletion stays in each environment's
 * own admin portal, so this cockpit can never revoke a live bank
 * connection that belongs to another environment. */
function ConsentsScreen({ consents }: Readonly<{ consents: ControlConsent[] | null }>) {
  const groups = groupByOrigin(consents ?? []);
  return (
    <>
      <h1>Bank connections — all environments</h1>
      <p className="muted">
        Everything on the shared GoCardless account, attributed by redirect origin. Manage or delete a
        consent from its own environment&apos;s admin portal.
      </p>
      {groups.map(([origin, rows]) => (
        <section className="card" key={origin} data-testid={`control-group-${origin}`}>
          <h2>{origin}</h2>
          <table>
            <thead>
              <tr>
                <th>Institution</th>
                <th>Status</th>
                <th>Accounts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.requisitionId}>
                  <td>
                    <div className="cell-title">
                      {c.institutionId} {c.ownedHere && <span className="chip on">this environment</span>}
                    </div>
                    <div className="cell-sub">
                      {c.requisitionId.slice(0, 13)}… · {c.created ? new Date(c.created).toLocaleDateString() : '—'}
                    </div>
                  </td>
                  <td>{STATUS_LABEL[c.status] ?? c.status}</td>
                  <td>{c.accountCount} acct</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {groups.length === 0 && (
        <section className="card">
          <p className="hint">No consents on the shared account yet.</p>
        </section>
      )}
    </>
  );
}

/** the shared account's rate-limit snapshots, full width */
function QuotaScreen({ quota }: Readonly<{ quota: ProviderQuota[] }>) {
  return (
    <>
      <h1>GoCardless quota</h1>
      <p className="muted">One account serves every environment — captured from normal sync traffic, no extra calls.</p>
      <section className="card">
        <QuotaTable quota={quota} testId="control-quota" />
      </section>
    </>
  );
}
