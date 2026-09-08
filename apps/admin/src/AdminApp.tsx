import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminConfig } from './config';
import bundledCatalog from './generated/bundledCatalog.json';

interface UserDiagnosis {
  userId: string;
  memberSpaces: string[];
  ownedFeeds: { feedSpaceId: string; maxSeq: number }[];
  attachments: { spaceId: string; feedSpaceId: string; accountId: string }[];
  gcLinks: { gcAccountId: string; spaceId: string; accountEntityId: string; iban: string; provider: string; lastFetchAt: string | null; requisitionId: string }[];
}

interface AdminUser {
  id: string;
  sub: string;
  displayName: string | null;
  email: string | null;
  createdAt: string;
  spaceCount: number;
  isAdmin: boolean;
  bootstrap: boolean;
}
interface AdminRequisition {
  requisitionId: string;
  status: string;
  institutionId: string;
  created: string | null;
  accountCount: number;
  stale: boolean;
  ownerSub: string | null;
}
/** THIS environment's connections + a count of foreign ones (the GC
 * account is shared across environments; foreign consents are neither
 * listed nor deletable here) */
interface AdminRequisitionList {
  requisitions: AdminRequisition[];
  foreignCount: number;
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

type Screen = 'overview' | 'users' | 'connections' | 'catalog';

/** the operator-published catalog document (admin-catalog design AC2) */
interface CatalogCategory {
  id: string;
  parentId?: string;
  names: { en: string; nl: string; tr: string };
  icon: string;
  txTypes?: string[];
  deleted?: boolean;
}
interface CatalogKeywordRule {
  catId: string;
  keywords: string[];
}
/** receipts v3 R9: operator-curated merchant patterns per store — the
 *  receipt auto-matcher improves without an app release */
interface CatalogStoreRule {
  id: string;
  patterns: string[];
}
interface CatalogDoc {
  version: number;
  categories: CatalogCategory[];
  keywords: CatalogKeywordRule[];
  stores?: CatalogStoreRule[];
}
const EMPTY_CATALOG: CatalogDoc = { version: 0, categories: [], keywords: [], stores: [] };

/** the connectable + coming-soon stores the matcher knows about */
const STORE_IDS = ['ah', 'jumbo', 'bol', 'coolblue', 'mediamarkt', 'amazon'] as const;

interface BundledCategory {
  id: string;
  parentId?: string;
  nameKey: string;
  icon: string;
  isParent?: boolean;
  hidden?: boolean;
  txTypes: string[];
}
interface BundledKeywordRule {
  lang: string;
  catId: string;
  keywords: string[];
}

/** GC consents run ~90 days; flag the ones inside the final 14 */
const expiresSoon = (r: AdminRequisition): boolean =>
  r.status === 'LN' && !!r.created && Date.now() - new Date(r.created).getTime() > 76 * 86_400_000;

interface AdminAppProps {
  config: AdminConfig;
  /** null = test-auth mode (X-User-Sub header from the sub box) */
  getToken: (() => Promise<string | undefined>) | null;
}

/**
 * munni admin console (admin-redesign): a desktop-first operator tool —
 * overview, user management incl. admin grants, and bank-connection
 * upkeep. Talks to the same API (/admin/* gated server-side); it
 * deliberately shares no code with the member app.
 */
export function AdminApp({ config, getToken }: Readonly<AdminAppProps>) {
  // survives the full page reload a Logto re-auth causes (else every token
  // hiccup dumps the operator back on Overview mid-task)
  const [screen, setScreen] = useState<Screen>(() => {
    const saved = sessionStorage.getItem('munni_admin_screen');
    return saved === 'users' || saved === 'connections' || saved === 'catalog' ? saved : 'overview';
  });
  const openScreen = (next: Screen) => {
    sessionStorage.setItem('munni_admin_screen', next);
    setScreen(next);
  };
  const [sub, setSub] = useState(() => localStorage.getItem('munni_admin_sub') ?? '');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [requisitions, setRequisitions] = useState<AdminRequisition[] | null>(null);
  const [foreignCount, setForeignCount] = useState(0);
  const [quota, setQuota] = useState<ProviderQuota[]>([]);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [catalog, setCatalog] = useState<CatalogDoc | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 'denied' = the api really said 403; 'unreachable' = the ping never
  // got an answer (network/CORS/5xx) — one shared message made a blocked
  // request read as "not an admin" (found live 2026-08-28, control twin)
  const [denied, setDenied] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const blocked = denied || unreachable;
  const reload = useCallback(async () => {
    const ping = await call('/admin/ping').catch(() => null);
    setDenied(ping?.status === 403);
    setUnreachable(!ping || (!ping.ok && ping.status !== 403));
    if (!ping?.ok) return;
    const [usersRes, reqRes, quotaRes, healthRes] = await Promise.all([
      call('/admin/users'),
      call('/admin/gocardless/requisitions'),
      call('/admin/quota'),
      fetch(`${config.apiUrl}/health`).catch(() => null),
    ]);
    if (usersRes.ok) setUsers((await usersRes.json()) as AdminUser[]);
    if (reqRes.ok) {
      const list = (await reqRes.json()) as AdminRequisitionList;
      setRequisitions(list.requisitions);
      setForeignCount(list.foreignCount);
    }
    if (quotaRes.ok) setQuota((await quotaRes.json()) as ProviderQuota[]);
    if (healthRes?.ok) setHealth((await healthRes.json()) as HealthInfo);
    const catalogRes = await call('/catalog').catch(() => null);
    if (catalogRes?.status === 204) setCatalog(EMPTY_CATALOG);
    else if (catalogRes?.ok) setCatalog((await catalogRes.json()) as CatalogDoc);
  }, [call, config.apiUrl]);

  useEffect(() => {
    if (getToken || sub) void reload();
  }, [reload, getToken, sub]);

  const act = async (fn: () => Promise<Response>) => {
    setBusy(true);
    setError(null);
    const res = await fn().catch(() => null);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'request failed');
    }
    await reload();
    setBusy(false);
  };

  // pickProvider retired (#175): both providers are offered to the END
  // USER at connect time — there is no admin-selected "active" one.
  const publishCatalog = (categories: CatalogCategory[], keywords: CatalogKeywordRule[], stores: CatalogStoreRule[]) =>
    act(() => call('/admin/catalog', { method: 'PUT', body: JSON.stringify({ categories, keywords, stores }) }));
  const promote = (userSub: string) => act(() => call(`/admin/admins/${encodeURIComponent(userSub)}`, { method: 'POST' }));
  const demote = (userSub: string) => act(() => call(`/admin/admins/${encodeURIComponent(userSub)}`, { method: 'DELETE' }));

  const deleteSelected = async () => {
    setBusy(true);
    for (const id of selected) {
      await call(`/admin/gocardless/requisitions/${id}`, { method: 'DELETE' }).catch(() => undefined);
    }
    setSelected(new Set());
    await reload();
    setBusy(false);
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          munni<span className="dot">.</span> <span className="brand-sub">admin</span>
        </div>
        <nav>
          {(
            [
              ['overview', 'Overview'],
              ['users', 'Users'],
              ['connections', 'Bank connections'],
              ['catalog', 'Catalog'],
            ] as [Screen, string][]
          ).map(([id, label]) => (
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
              data-testid="admin-sub"
              value={sub}
              placeholder="test subject (X-User-Sub)"
              onChange={(e) => {
                setSub(e.target.value);
                localStorage.setItem('munni_admin_sub', e.target.value);
              }}
            />
          )}
        </div>
      </aside>

      <main className="content">
        {denied && <p className="denied">This account is not on the admin list.</p>}
        {unreachable && <p className="denied">The admin API did not answer — is the environment running (and this origin allowed)?</p>}
        {/* blocked: no data loaded — the empty screens would only mislead */}
        {error && (
          <p className="error" data-testid="admin-error">
            {error}
          </p>
        )}
        {!blocked && screen === 'overview' && (
          <OverviewScreen users={users} requisitions={requisitions} quota={quota} health={health} />
        )}
        {!blocked && screen === 'catalog' && catalog && (
          <CatalogScreen key={catalog.version} doc={catalog} busy={busy} onPublish={publishCatalog} />
        )}
        {!blocked && screen === 'users' && (
          <UsersScreen
            users={users}
            busy={busy}
            onPromote={promote}
            onDemote={demote}
            onDiagnose={async (sub) => {
              const res = await call(`/admin/users/${encodeURIComponent(sub)}/diagnosis`).catch(() => null);
              if (!res?.ok) {
                const reason = res ? `HTTP ${res.status}` : 'network';
                return `request failed (${reason}) — reload and retry`;
              }
              return (await res.json()) as UserDiagnosis;
            }}
          />
        )}
        {!blocked && screen === 'connections' && (
          <ConnectionsScreen
            requisitions={requisitions}
            foreignCount={foreignCount}
            selected={selected}
            busy={busy}
            onToggle={(id) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onDeleteSelected={() => void deleteSelected()}
          />
        )}
      </main>
    </div>
  );
}

function OverviewScreen({
  users,
  requisitions,
  quota,
  health,
}: Readonly<{
  users: AdminUser[];
  requisitions: AdminRequisition[] | null;
  quota: ProviderQuota[];
  health: HealthInfo | null;
}>) {
  const linked = (requisitions ?? []).filter((r) => r.status === 'LN');
  const expiring = (requisitions ?? []).filter(expiresSoon);
  const createdLast30d = (requisitions ?? []).filter(
    (r) => r.created && Date.now() - new Date(r.created).getTime() < 30 * 86_400_000,
  ).length;
  const caps = Object.entries(health?.capabilities ?? {}).filter(([, v]) => typeof v === 'boolean');

  return (
    <>
      <h1>Overview</h1>
      <div className="tiles" data-testid="overview-tiles">
        <Tile label="Users" value={String(users.length)} />
        <Tile label="Space memberships" value={String(users.reduce((sum, u) => sum + u.spaceCount, 0))} />
        <Tile label="Linked banks" value={String(linked.length)} />
        <Tile label="Expiring ≤14d" value={String(expiring.length)} warn={expiring.length > 0} />
      </div>

      <section className="card">
        <h2>GoCardless quota</h2>
        <p className="hint">
          Captured from the nightly sync traffic — no extra calls. {createdLast30d} connection
          {createdLast30d === 1 ? '' : 's'} created in the last 30 days.
        </p>
        <table data-testid="overview-quota">
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
      </section>

      {/* the Bank-data provider toggle retired (#175): the END USER
          picks the provider at connect time now — both are first-class */}
      {health && (
        <section className="card">
          <h2>Server</h2>
          <div className="chips" data-testid="overview-capabilities">
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

function Tile({ label, value, warn = false }: Readonly<{ label: string; value: string; warn?: boolean }>) {
  return (
    <div className={`tile ${warn ? 'tile-warn' : ''}`}>
      <div className="tile-value">{value}</div>
      <div className="tile-label">{label}</div>
    </div>
  );
}

function UsersScreen({
  users,
  busy,
  onPromote,
  onDemote,
  onDiagnose,
}: Readonly<{
  users: AdminUser[];
  busy: boolean;
  onPromote: (sub: string) => void;
  onDemote: (sub: string) => void;
  /** resolves to the diagnosis, or a human-readable failure line */
  onDiagnose: (sub: string) => Promise<UserDiagnosis | string>;
}>) {
  const [query, setQuery] = useState('');
  const [diag, setDiag] = useState<{ sub: string; data: UserDiagnosis | string | null } | null>(null);
  const toggleDiagnosis = (sub: string) => {
    if (diag?.sub === sub) {
      setDiag(null);
      return;
    }
    setDiag({ sub, data: null });
    void onDiagnose(sub).then((data) => setDiag((prev) => (prev?.sub === sub ? { sub, data } : prev)));
  };
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.displayName, u.email, u.sub].some((field) => field?.toLowerCase().includes(q)),
    );
  }, [users, query]);

  return (
    <>
      <h1>Users</h1>
      <input
        data-testid="users-search"
        className="search"
        value={query}
        placeholder="Search name, email or sub…"
        onChange={(e) => setQuery(e.target.value)}
      />
      <section className="card">
        <table data-testid="admin-users">
          <thead>
            <tr>
              <th>User</th>
              <th>Joined</th>
              <th>Spaces</th>
              <th>Role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="cell-title">{u.displayName ?? u.sub}</div>
                  <div className="cell-sub">
                    {u.email ? `${u.email} · ` : ''}
                    {u.sub}
                  </div>
                </td>
                <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                <td>{u.spaceCount} spaces</td>
                <td>
                  {u.bootstrap && <span className="chip on">bootstrap admin</span>}
                  {u.isAdmin && !u.bootstrap && <span className="chip on">admin</span>}
                </td>
                <td className="cell-actions">
                  {!u.isAdmin && (
                    <button data-testid={`promote-${u.sub}`} className="btn" disabled={busy} onClick={() => onPromote(u.sub)}>
                      Promote to admin
                    </button>
                  )}
                  {u.isAdmin && !u.bootstrap && (
                    <button data-testid={`demote-${u.sub}`} className="btn danger" disabled={busy} onClick={() => onDemote(u.sub)}>
                      Demote
                    </button>
                  )}
                  <button
                    data-testid={`diagnose-${u.sub}`}
                    className="btn"
                    onClick={() => toggleDiagnosis(u.sub)}
                  >
                    {diag?.sub === u.sub ? 'Hide' : 'Diagnose'}
                  </button>
                </td>
              </tr>
            ))}
            {diag && (
              <tr data-testid="user-diagnosis">
                <td colSpan={5}>
                  {!diag.data && <span className="sub">loading…</span>}
                  {typeof diag.data === 'string' && <span className="sub">{diag.data}</span>}
                  {diag.data && typeof diag.data !== 'string' && (
                    <div className="diag">
                      <div><strong>member spaces</strong> · {diag.data.memberSpaces.length === 0 ? 'NONE' : diag.data.memberSpaces.join(', ')}</div>
                      <div>
                        <strong>owned feeds</strong> ·{' '}
                        {diag.data.ownedFeeds.length === 0
                          ? 'NONE'
                          : diag.data.ownedFeeds.map((f) => `${f.feedSpaceId.slice(0, 8)}… (ops ${f.maxSeq})`).join(', ')}
                      </div>
                      <div>
                        <strong>attachments</strong> ·{' '}
                        {diag.data.attachments.length === 0
                          ? 'NONE — feeds never attached to a space the user sees'
                          : diag.data.attachments.map((l) => `${l.feedSpaceId.slice(0, 8)}… → ${l.spaceId.slice(0, 12)}…`).join(', ')}
                      </div>
                      <div>
                        <strong>gc links</strong> ·{' '}
                        {diag.data.gcLinks.length === 0
                          ? 'NONE'
                          : diag.data.gcLinks
                              .map((g) => `${g.provider}:${g.iban.slice(-4)} → space ${g.spaceId.slice(0, 12)}… · consent ${g.requisitionId.slice(0, 8)}… (fetched ${g.lastFetchAt ? new Date(g.lastFetchAt).toLocaleString() : 'never'})`)
                              .join(' | ')}
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            )}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5}>—</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}

function ConnectionsScreen({
  requisitions,
  foreignCount,
  selected,
  busy,
  onToggle,
  onDeleteSelected,
}: Readonly<{
  requisitions: AdminRequisition[] | null;
  foreignCount: number;
  selected: Set<string>;
  busy: boolean;
  onToggle: (id: string) => void;
  onDeleteSelected: () => void;
}>) {
  const [onlyExpiring, setOnlyExpiring] = useState(false);
  const rows = (requisitions ?? []).filter((r) => !onlyExpiring || expiresSoon(r));

  return (
    <>
      <h1>Bank connections</h1>
      <p className="muted">
        This environment&apos;s consents only.
        {foreignCount > 0 && (
          <span data-testid="connections-foreign-note">
            {' '}
            {foreignCount} other connection{foreignCount === 1 ? '' : 's'} on the shared GoCardless account belong
            {foreignCount === 1 ? 's' : ''} to other environments — manage those from their own admin.
          </span>
        )}
      </p>
      <div className="toolbar">
        <label className="radio">
          <input
            type="checkbox"
            data-testid="connections-expiring-filter"
            checked={onlyExpiring}
            onChange={(e) => setOnlyExpiring(e.target.checked)}
          />{' '}
          expiring soon only
        </label>
        {selected.size > 0 && (
          <button className="btn danger" disabled={busy} onClick={onDeleteSelected}>
            Delete selected ({selected.size})
          </button>
        )}
      </div>
      <section className="card">
        <table data-testid="admin-requisitions">
          <thead>
            <tr>
              <th />
              <th>Institution</th>
              <th>Status</th>
              <th>Accounts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.requisitionId} className={r.stale ? 'stale' : ''}>
                <td>
                  <input type="checkbox" checked={selected.has(r.requisitionId)} onChange={() => onToggle(r.requisitionId)} />
                </td>
                <td>
                  <div className="cell-title">
                    {r.institutionId} {r.stale && <em>stale</em>} {expiresSoon(r) && <span className="chip warn-chip">expiring</span>}
                  </div>
                  <div className="cell-sub">
                    {r.requisitionId.slice(0, 13)}… · {r.created ? new Date(r.created).toLocaleDateString() : '—'}
                    {r.ownerSub ? ` · ${r.ownerSub.slice(0, 12)}` : ''}
                  </div>
                </td>
                <td>{STATUS_LABEL[r.status] ?? r.status}</td>
                <td>{r.accountCount} acct</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4}>—</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}

const TX_TYPES = ['expense', 'income', 'saving', 'transfer', 'debtPayment', 'investment', 'adjustment'];

/**
 * Catalog editor (AC2): edits the OVERLAY document, not the app bundle —
 * entries here rename, add or retire built-in categories and extend the
 * prediction keywords. Publishing bumps the server-owned version; every
 * client picks it up on its next sync.
 */
/** what every app ships with — the baseline the overlay edits against */
const BUNDLED = bundledCatalog as { categories: BundledCategory[]; keywords: BundledKeywordRule[] };

/** one merged row of the tree: what ships + what the overlay says */
interface TreeRow {
  id: string;
  parentId?: string;
  icon?: string;
  txTypes: string[];
  bundled: boolean;
  overlay?: CatalogCategory;
}

/** synthesized tombstones mark themselves by naming all languages the id */
const isSyntheticTombstone = (c: CatalogCategory) =>
  !!c.deleted && c.names.en === c.id && c.names.nl === c.id && c.names.tr === c.id;

function buildTree(categories: CatalogCategory[]): { mains: TreeRow[]; childrenOf: (id: string) => TreeRow[] } {
  const rows = new Map<string, TreeRow>();
  for (const b of BUNDLED.categories) {
    rows.set(b.id, { id: b.id, parentId: b.parentId, icon: b.icon, txTypes: b.txTypes, bundled: true });
  }
  for (const o of categories) {
    const existing = rows.get(o.id);
    if (existing) existing.overlay = o;
    else rows.set(o.id, { id: o.id, parentId: o.parentId, icon: o.icon, txTypes: o.txTypes ?? [], bundled: false, overlay: o });
  }
  const all = [...rows.values()];
  return {
    mains: all.filter((r) => !r.parentId),
    childrenOf: (id: string) => all.filter((r) => r.parentId === id),
  };
}

const rowLabel = (row: TreeRow) =>
  row.overlay && !isSyntheticTombstone(row.overlay) ? row.overlay.names.en : row.id;

function rowBadge(row: TreeRow): { text: string; cls: string } | null {
  if (row.overlay?.deleted) return { text: 'retired', cls: 'chip danger-chip' };
  if (row.overlay && !row.bundled) return { text: 'new', cls: 'chip ok-chip' };
  if (row.overlay) return { text: 'renamed', cls: 'chip warn-chip' };
  return null;
}

function CatalogScreen({
  doc,
  busy,
  onPublish,
}: Readonly<{
  doc: CatalogDoc;
  busy: boolean;
  onPublish: (categories: CatalogCategory[], keywords: CatalogKeywordRule[], stores: CatalogStoreRule[]) => void;
}>) {
  const [categories, setCategories] = useState<CatalogCategory[]>(doc.categories);
  const [keywords, setKeywords] = useState<CatalogKeywordRule[]>(doc.keywords);
  // raw text per store (parsing on publish — a controlled parse-on-type
  // input would swallow the comma the operator just typed)
  const [storeText, setStoreText] = useState<Record<string, string>>(() =>
    Object.fromEntries((doc.stores ?? []).map((s) => [s.id, s.patterns.join(', ')])),
  );
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; typed: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState({ id: '', parentId: '', en: '', nl: '', tr: '', icon: '', txType: 'expense' });
  const [keywordDraft, setKeywordDraft] = useState({ catId: '', words: '' });
  const storeRules = (): CatalogStoreRule[] =>
    STORE_IDS.flatMap((id) => {
      const patterns = (storeText[id] ?? '').split(',').map((p) => p.trim()).filter(Boolean);
      return patterns.length > 0 ? [{ id, patterns }] : [];
    });
  const dirty =
    JSON.stringify(categories) !== JSON.stringify(doc.categories) ||
    JSON.stringify(keywords) !== JSON.stringify(doc.keywords) ||
    JSON.stringify(storeRules()) !== JSON.stringify(doc.stores ?? []);

  const tree = buildTree(categories);
  const matches = (row: TreeRow) => {
    const q = search.trim().toLowerCase();
    return !q || row.id.toLowerCase().includes(q) || rowLabel(row).toLowerCase().includes(q);
  };

  // keyword UX: humans pick and read category NAMES, ids stay subtitles
  const pretty = (id: string) => id.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
  const catLabel = (id: string) => {
    const overlay = categories.find((c) => c.id === id && !isSyntheticTombstone(c));
    return overlay ? overlay.names.en : pretty(id);
  };
  const selectableCats = tree.mains
    .filter((m) => !m.overlay?.deleted)
    .flatMap((m) => [
      { row: m, sub: false },
      ...tree
        .childrenOf(m.id)
        .filter((s) => !s.overlay?.deleted)
        .flatMap((s) => [{ row: s, sub: true }, ...tree.childrenOf(s.id).filter((l) => !l.overlay?.deleted).map((l) => ({ row: l, sub: true }))]),
    ]);

  const openForm = (prefill: Partial<typeof draft>) => {
    setDraft({ id: '', parentId: '', en: '', nl: '', tr: '', icon: '', txType: 'expense', ...prefill });
    setFormOpen(true);
  };

  const addCategory = () => {
    const id = draft.id.trim();
    if (!id || !draft.en.trim() || !draft.nl.trim() || !draft.tr.trim() || !draft.icon.trim()) return;
    setCategories([
      ...categories.filter((c) => c.id !== id), // re-editing an override replaces it
      {
        id,
        parentId: draft.parentId.trim() || undefined,
        names: { en: draft.en.trim(), nl: draft.nl.trim(), tr: draft.tr.trim() },
        icon: draft.icon.trim(),
        txTypes: [draft.txType],
      },
    ]);
    setFormOpen(false);
  };

  /** retire/restore straight from the tree: bundled rows without an
   *  overlay get a synthesized tombstone; restoring one removes it again */
  const toggleRow = (row: TreeRow) => {
    setConfirmDelete(null);
    if (!row.overlay) {
      setCategories([
        ...categories,
        {
          id: row.id,
          parentId: row.parentId,
          names: { en: row.id, nl: row.id, tr: row.id },
          icon: row.icon ?? 'shape',
          txTypes: row.txTypes,
          deleted: true,
        },
      ]);
      return;
    }
    if (isSyntheticTombstone(row.overlay)) {
      setCategories(categories.filter((c) => c.id !== row.id));
      return;
    }
    setCategories(categories.map((c) => (c.id === row.id ? { ...c, deleted: !c.deleted } : c)));
  };

  const addKeywordRule = () => {
    const catId = keywordDraft.catId.trim();
    const words = keywordDraft.words
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
    if (!catId || words.length === 0) return;
    setKeywords([...keywords, { catId, keywords: words }]);
    setKeywordDraft({ catId: '', words: '' });
  };

  const renderRow = (row: TreeRow, sub: boolean) => {
    const badge = rowBadge(row);
    return (
      <div
        key={row.id}
        className={'tree-row' + (sub ? ' tree-sub' : '') + (row.overlay?.deleted ? ' retired' : '')}
        data-testid={row.overlay ? 'catalog-cat-' + row.id : 'catalog-row-' + row.id}
      >
        <span className="tree-label">
          <span className="tree-name">{rowLabel(row)}</span>
          <code className="tree-id">{row.id}</code>
          {row.icon && <code className="tree-icon">{row.icon}</code>}
          {badge && <span className={badge.cls}>{badge.text}</span>}
        </span>
        <span className="tree-actions">
          {!sub && !row.overlay?.deleted && (
            <button
              data-testid={'catalog-addsub-' + row.id}
              disabled={busy}
              onClick={() => openForm({ parentId: row.id, txType: row.txTypes[0] ?? 'expense' })}
            >
              + sub
            </button>
          )}
          {!row.overlay?.deleted && (
            <button
              data-testid={'catalog-prefill-' + row.id}
              disabled={busy}
              onClick={() =>
                openForm({
                  id: row.id,
                  parentId: row.parentId ?? '',
                  icon: row.overlay?.icon ?? row.icon ?? '',
                  txType: row.overlay?.txTypes?.[0] ?? row.txTypes[0] ?? 'expense',
                  en: row.overlay && !isSyntheticTombstone(row.overlay) ? row.overlay.names.en : '',
                  nl: row.overlay && !isSyntheticTombstone(row.overlay) ? row.overlay.names.nl : '',
                  tr: row.overlay && !isSyntheticTombstone(row.overlay) ? row.overlay.names.tr : '',
                })
              }
            >
              rename
            </button>
          )}
          <CatalogRowAction
            cat={row.overlay ?? { id: row.id, names: { en: row.id, nl: row.id, tr: row.id }, icon: row.icon ?? '', txTypes: row.txTypes }}
            busy={busy}
            confirm={confirmDelete?.id === row.id ? confirmDelete : null}
            onArm={() => setConfirmDelete({ id: row.id, typed: '' })}
            onType={(typed) => setConfirmDelete({ id: row.id, typed })}
            onToggle={() => toggleRow(row)}
          />
        </span>
      </div>
    );
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Catalog</h1>
          <p className="sub">
            The category tree every device ships with, plus this overlay on top — rename, add or retire here and
            publish; clients apply the new version on their next sync. Retired categories detach their
            transactions to Uncategorized; user-created categories are never touched.
          </p>
        </div>
        <span className="chip">v{doc.version}</span>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Categories</h2>
          <span className="card-tools">
            <input
              data-testid="catalog-search"
              className="search"
              placeholder="filter…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button data-testid="catalog-add-main" disabled={busy} onClick={() => openForm({})}>
              + main category
            </button>
          </span>
        </div>

        {formOpen && (
          <div className="editor" data-testid="catalog-editor">
            <div className="editor-grid">
              <input data-testid="catalog-new-id" placeholder="id" value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} />
              <input data-testid="catalog-new-parent" placeholder="parentId (empty = main)" value={draft.parentId} onChange={(e) => setDraft({ ...draft, parentId: e.target.value })} />
              <input data-testid="catalog-new-en" placeholder="EN" value={draft.en} onChange={(e) => setDraft({ ...draft, en: e.target.value })} />
              <input data-testid="catalog-new-nl" placeholder="NL" value={draft.nl} onChange={(e) => setDraft({ ...draft, nl: e.target.value })} />
              <input data-testid="catalog-new-tr" placeholder="TR" value={draft.tr} onChange={(e) => setDraft({ ...draft, tr: e.target.value })} />
              <input data-testid="catalog-new-icon" placeholder="mdi icon" value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} />
              <select data-testid="catalog-new-type" value={draft.txType} onChange={(e) => setDraft({ ...draft, txType: e.target.value })}>
                {TX_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="editor-actions">
              <span className="sub">An EXISTING id renames/overrides; a new id adds. All three languages required.</span>
              <span>
                <button data-testid="catalog-editor-cancel" onClick={() => setFormOpen(false)}>
                  cancel
                </button>
                <button data-testid="catalog-add-category" className="primary" disabled={busy} onClick={addCategory}>
                  Save entry
                </button>
              </span>
            </div>
          </div>
        )}

        <div className="tree" data-testid="catalog-categories">
          {tree.mains.map((main) => {
            const subs = tree.childrenOf(main.id);
            const visible = matches(main) || subs.some(matches);
            if (!visible) return null;
            return (
              <div key={main.id} className="tree-group">
                {renderRow(main, false)}
                {subs
                  .filter((row) => matches(row) || matches(main))
                  .map((row) => (
                    <Fragment key={row.id}>
                      {renderRow(row, true)}
                      {/* overlay additions may nest under a sub (padel
                          under hobby) — render that third level too */}
                      {tree.childrenOf(row.id).map((leaf) => renderRow(leaf, true))}
                    </Fragment>
                  ))}
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Prediction keywords</h2>
          <span className="sub">published rules win ties against the bundled set</span>
        </div>
        {keywords.length > 0 && (
          <table data-testid="catalog-keywords">
            <thead>
              <tr>
                <th>category</th><th>keywords</th><th></th>
              </tr>
            </thead>
            <tbody>
              {keywords.map((rule, i) => (
                <tr key={rule.catId + '-' + i}>
                  <td>
                    <span className="cell-title">{catLabel(rule.catId)}</span>
                    <div className="cell-sub">{rule.catId}</div>
                  </td>
                  <td className="kw-words">{rule.keywords.join(', ')}</td>
                  <td className="cell-actions">
                    <button data-testid={'catalog-kw-remove-' + i} disabled={busy} onClick={() => setKeywords(keywords.filter((_, j) => j !== i))}>
                      remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="form-row">
          <select data-testid="catalog-kw-cat" value={keywordDraft.catId} onChange={(e) => setKeywordDraft({ ...keywordDraft, catId: e.target.value })}>
            <option value="">Category…</option>
            {selectableCats.map(({ row, sub }) => {
              const label = rowLabel(row) === row.id ? pretty(row.id) : rowLabel(row);
              return (
                <option key={row.id} value={row.id}>
                  {sub ? `— ${label}` : label}
                </option>
              );
            })}
          </select>
          <input data-testid="catalog-kw-words" placeholder="keywords, comma, separated" value={keywordDraft.words} onChange={(e) => setKeywordDraft({ ...keywordDraft, words: e.target.value })} />
          <button data-testid="catalog-add-keyword" className="btn" disabled={busy} onClick={addKeywordRule}>
            Add rule
          </button>
        </div>
        <details>
          <summary className="sub" style={{ cursor: 'pointer' }}>
            Bundled baseline: {BUNDLED.keywords.length} keyword rules — click to browse
          </summary>
          <table>
            <thead><tr><th>lang</th><th>category</th><th>keywords</th></tr></thead>
            <tbody>
              {BUNDLED.keywords.map((rule, i) => (
                <tr key={rule.catId + '-' + i}>
                  <td>{rule.lang}</td>
                  <td>
                    <span className="cell-title">{catLabel(rule.catId)}</span>
                    <div className="cell-sub">{rule.catId}</div>
                  </td>
                  <td className="kw-words">{rule.keywords.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      {/* receipts v3 R9: merchant fingerprints per store — the receipt
          auto-matcher tests these against transaction merchants */}
      <section className="card">
        <div className="card-head">
          <h2>Store matching</h2>
          <span className="sub">comma-separated patterns (regex allowed); empty = the bundled fingerprint</span>
        </div>
        <table data-testid="catalog-stores">
          <thead>
            <tr>
              <th>store</th><th>merchant patterns</th>
            </tr>
          </thead>
          <tbody>
            {STORE_IDS.map((id) => (
              <tr key={id}>
                <td><span className="cell-title">{id}</span></td>
                <td>
                  <input
                    data-testid={'catalog-store-' + id}
                    placeholder="albert heijn, \bah\b"
                    value={storeText[id] ?? ''}
                    onChange={(e) => setStoreText((current) => ({ ...current, [id]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className={'pubbar' + (dirty ? ' show' : '')}>
        <span className="sub">{dirty ? 'Unpublished changes' : 'Everything published'}</span>
        <button data-testid="catalog-publish" className="primary" disabled={busy || !dirty} onClick={() => onPublish(categories, keywords, storeRules())}>
          Publish version {doc.version + 1}
        </button>
      </div>
    </>
  );
}

/** retire flow: typing the exact id arms the button (mistake-proof) */
function CatalogRowAction({
  cat,
  busy,
  confirm,
  onArm,
  onType,
  onToggle,
}: Readonly<{
  cat: CatalogCategory;
  busy: boolean;
  confirm: { id: string; typed: string } | null;
  onArm: () => void;
  onType: (typed: string) => void;
  onToggle: () => void;
}>) {
  if (cat.deleted) {
    return (
      <button data-testid={'catalog-restore-' + cat.id} disabled={busy} onClick={onToggle}>
        restore
      </button>
    );
  }
  if (confirm) {
    return (
      <span className="confirm-delete">
        <input
          data-testid="catalog-delete-typed"
          placeholder={'type ' + cat.id}
          value={confirm.typed}
          onChange={(e) => onType(e.target.value)}
        />
        <button data-testid="catalog-delete-confirm" disabled={confirm.typed !== cat.id} onClick={onToggle}>
          retire
        </button>
      </span>
    );
  }
  return (
    <button data-testid={'catalog-delete-' + cat.id} disabled={busy} onClick={onArm}>
      retire…
    </button>
  );
}
