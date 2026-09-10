/**
 * DSM 7 as code (IAC4): the same webapi the deploy pipeline already
 * drives for FileStation. Everything here is idempotent — re-runs
 * converge instead of duplicating:
 *   - reverse-proxy rules (matched by source FQDN)
 *   - the wildcard Let's Encrypt certificate the https hosts need
 *     (DSM's DDNS default covers only <domain> itself — found live
 *     2026-09-10; the wildcard rides in domain_name as "host;*.host",
 *     which is what DSM's own wizard sends), and the binding of the
 *     stack's rules to it (a rule keeps the certificate it was created
 *     with — making another one the default does not move it)
 *   - the live dir on the NAS (apply.sh + the published folder)
 *   - the Task Scheduler entry that applies uploaded bundles (the
 *     poller, root-owned: a password-confirm token stands in for the
 *     dialog DSM shows for root scripts)
 * Auth: SYNOLOGY_URL/USER/PASS env (the deploy account). Every call
 * here is administrator-only on DSM — a non-admin account gets 105/119,
 * an account whose DSM application is denied gets 402 at login; both
 * are named by dsmAdvice(). Nothing below can grant an account those
 * rights: that is the ONE manual step (Control Panel → User & Group).
 *
 * Ownership: the pair's prod twin owns the NAS-wide resources (one
 * certificate, one live dir, one poller task per NAS — both twins share
 * <domain> and SYNOLOGY_PATH); the staging twin only binds its own rules
 * to the certificate it finds. That is what keeps two bootstrap runs
 * from requesting the same certificate twice (Let's Encrypt counts
 * every request: 5 per name set per week).
 *
 * Firewall rules stay manual (the DSM firewall API is undocumented and
 * fragile) — `--verify` probes the outcome instead.
 *
 * API shapes (DSM publishes none) come from DSM's own admin_center.js
 * and open-source clients that captured it: N4S4/synology-api, acme.sh's
 * synology_dsm hook, KastnerRG/krg-infra, phoeluga/synology-proxy-operator,
 * RROrg/rr-addons, 007revad (researched + cross-checked 2026-09-10).
 */

/** DSM error codes as the operator meets them (the ONE text for 402 — validate.mjs reuses it) */
export const DSM_CODE_ADVICE = {
  402: 'the DSM application is denied for this account (its password is right): Control Panel → User & Group → the deploy user → Applications → DSM: Allow, File Station: Allow (a group Deny beats Allow) — and put it in the administrators group (User groups tab): every step bootstrap automates on the NAS is admin-only',
  105: 'the account is not in the administrators group — Control Panel APIs are admin-only: User & Group → the deploy user → User groups → administrators',
  119: 'DSM refused the session for this API — the account is not in the administrators group (User & Group → the deploy user → User groups → administrators)',
  103: 'DSM wants its CSRF token beside the sid (SynoToken) — the login must use enable_syno_token=yes',
  4800: 'DSM rejected the task parameters (4800) — the message only shows in /var/log/synoscgi.log on the NAS',
  5524: 'Let’s Encrypt’s rate limit for this name is used up (5 certificates per exact name set per week) — wait a week; never delete and re-request',
  5503: 'Let’s Encrypt could not validate the domain — with a Synology DDNS name the validation runs through Synology; otherwise port 80 must reach the NAS',
};
/** the codes that mean "fix the account", not "the step failed" */
export const DSM_PERMISSION_CODES = [402, 105, 119];
export const dsmCode = (err) => Number(/"code":\s*(\d+)/.exec(String(err?.message ?? err ?? ''))?.[1]);
export function dsmAdvice(err) {
  const code = dsmCode(err);
  return DSM_CODE_ADVICE[code] ? ` — ${DSM_CODE_ADVICE[code]}` : '';
}
export const isPermissionError = (err) => DSM_PERMISSION_CODES.includes(dsmCode(err));

/* ── transport ───────────────────────────────────────────────────────── */

/**
 * A failure BEFORE DSM answered: no connection, a timeout, a 5xx from
 * DSM's front nginx (its own UI treats 504 on the slow Let's Encrypt
 * call as "still running"), a non-JSON body. Never a DSM-answered error
 * — those carry a code and are final. Only this kind is ever retried,
 * and only this kind makes a long-running request "unknown, look again".
 */
export class DsmTransportError extends Error {
  constructor(message, { cause, status = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DsmTransportError';
    this.status = status;
  }
}
export const isTransport = (e) => e?.name === 'DsmTransportError';
/** ≈ one minute of patience: what a DSM web-server restart (after a certificate change) costs */
export const DSM_RETRY = [2000, 4000, 8000, 15000, 15000, 15000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dsmRequest(url, init, label, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, init);
  } catch (e) {
    throw new DsmTransportError(`DSM ${label}: no answer (${e.cause?.code ?? e.name ?? e.message})`, { cause: e });
  }
  if (typeof res.status === 'number' && res.status >= 500) throw new DsmTransportError(`DSM ${label}: HTTP ${res.status} from the NAS front end`, { status: res.status });
  let body;
  try {
    body = await res.json();
  } catch (e) {
    throw new DsmTransportError(`DSM ${label}: not a JSON answer${typeof res.status === 'number' ? ` (HTTP ${res.status})` : ''}`, { cause: e, status: typeof res.status === 'number' ? res.status : null });
  }
  if (!body.success) throw new Error(`DSM ${label} failed: ${JSON.stringify(body.error)}`);
  return body.data;
}

/** one form-encoded call; `retry` = delays (ms) between attempts, spent only on transport errors */
async function dsmCall(base, path, params, fetchImpl = fetch, { timeoutMs = 30000, retry = [], sleepImpl = sleep } = {}) {
  const label = `${params.api}.${params.method}`;
  for (let attempt = 0; ; attempt++) {
    try {
      return await dsmRequest(`${base}/webapi/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params),
        signal: AbortSignal.timeout(timeoutMs),
      }, label, fetchImpl);
    } catch (e) {
      if (!isTransport(e) || attempt >= retry.length) throw e;
      await sleepImpl(retry[attempt]);
    }
  }
}

/** SYNO.FileStation.Upload: multipart, _sid in the QUERY (as a field DSM answers 119), file last */
async function dsmUpload(base, sid, path, content, name, fetchImpl = fetch, { timeoutMs = 60000 } = {}) {
  const form = new FormData();
  form.append('api', 'SYNO.FileStation.Upload');
  form.append('version', '2');
  form.append('method', 'upload');
  form.append('path', path);
  form.append('create_parents', 'true');
  form.append('overwrite', 'true');
  form.append('file', new Blob([content]), name);
  return dsmRequest(`${base}/webapi/entry.cgi?_sid=${encodeURIComponent(sid)}`, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) }, 'SYNO.FileStation.Upload.upload', fetchImpl);
}

export async function dsmLogin(base, account, passwd, fetchImpl = fetch, { session = 'Core', retry = [], sleepImpl = sleep } = {}) {
  // enable_syno_token: DSM 7 wants the CSRF token beside the sid on
  // state-changing entry.cgi calls (per the documented v7 auth flow)
  const data = await dsmCall(base, 'auth.cgi', {
    api: 'SYNO.API.Auth',
    version: '7',
    method: 'login',
    account,
    passwd,
    session,
    format: 'sid',
    enable_syno_token: 'yes',
  }, fetchImpl, { retry, sleepImpl });
  return { sid: data.sid, token: data.synotoken };
}

export async function dsmLogout(base, sid, fetchImpl = fetch, session = 'Core') {
  await dsmCall(base, 'auth.cgi', { api: 'SYNO.API.Auth', version: '7', method: 'logout', session, _sid: sid }, fetchImpl).catch(() => undefined);
}

/**
 * one logged-in session: call(api, version, method, params, opts) with
 * sid + token; read() = the same with the restart-proof retry (reads are
 * safe to repeat, writes are not — a repeated create duplicates);
 * upload() for FileStation files; and a logout. `session` names the DSM
 * application (Core for Control Panel APIs, FileStation for files).
 */
export async function dsmSession({ url, user, pass }, fetchImpl = fetch, { session = 'Core', retry = DSM_RETRY, sleepImpl = sleep } = {}) {
  const base = url.replace(/\/$/, '');
  const { sid, token } = await dsmLogin(base, user, pass, fetchImpl, { session, retry, sleepImpl });
  const auth = { _sid: sid, ...(token ? { SynoToken: token } : {}) };
  const call = (api, version, method, params = {}, opts = {}) => dsmCall(base, 'entry.cgi', { api, version: String(version), method, ...params, ...auth }, fetchImpl, { sleepImpl, ...opts });
  return {
    base,
    sid,
    session,
    call,
    read: (api, version, method, params = {}, opts = {}) => call(api, version, method, params, { retry, ...opts }),
    upload: (path, content, name, opts) => dsmUpload(base, sid, path, content, name, fetchImpl, opts),
    logout: () => dsmLogout(base, sid, fetchImpl, session),
  };
}

/* ── reverse proxy ───────────────────────────────────────────────────── */

/** the reverse-proxy rules a stack needs: source https host -> local port */
export function proxyRules(stack) {
  const rules = [
    { host: stack.host('web'), port: stack.ports.web },
    { host: stack.host('api'), port: stack.ports.api },
    { host: stack.host('admin'), port: stack.ports.admin },
  ];
  if (stack.sharedServices) {
    rules.push(
      { host: stack.host('logto'), port: stack.ports.logto },
      { host: stack.host('logtoAdmin'), port: stack.ports.logtoAdmin },
      { host: stack.host('glitchtip'), port: stack.ports.glitchtip },
      // the pair's Vaultwarden (secrets-access plan SA1) — LAN-restrict
      // it in the DSM firewall like the *-admin hosts
      { host: stack.host('vault'), port: stack.ports.vault },
    );
  }
  return rules;
}

/** upsert the stack's rules; returns {created, updated, unchanged} */
export async function applyReverseProxy(stack, creds, fetchImpl = fetch, opts = {}) {
  const s = await dsmSession(creds, fetchImpl, opts);
  try {
    const existing = (await s.read('SYNO.Core.AppPortal.ReverseProxy', 1, 'list')).entries ?? [];
    const out = { created: [], updated: [], unchanged: [] };
    for (const rule of proxyRules(stack)) {
      const desired = {
        description: `${stack.stack}: ${rule.host}`,
        frontend: { protocol: 1, fqdn: rule.host, port: 443, acl_id: null, https_hsts: false, https_http2: true },
        backend: { protocol: 0, fqdn: 'localhost', port: rule.port },
        customize_headers: [],
        proxy_connect_timeout: 60,
        proxy_read_timeout: 60,
        proxy_send_timeout: 60,
        proxy_intercept_errors: false,
        proxy_http_version: 1,
      };
      const match = existing.find((e) => e.frontend?.fqdn === rule.host);
      if (!match) {
        await s.call('SYNO.Core.AppPortal.ReverseProxy', 1, 'create', { entry: JSON.stringify(desired) });
        out.created.push(rule.host);
      } else if (match.backend?.port !== rule.port) {
        // keep an access-control profile the operator set by hand (LAN-only admin hosts)
        await s.call('SYNO.Core.AppPortal.ReverseProxy', 1, 'update', { entry: JSON.stringify({ ...desired, frontend: { ...desired.frontend, acl_id: match.frontend?.acl_id ?? null }, uuid: match.uuid }) });
        out.updated.push(rule.host);
      } else {
        out.unchanged.push(rule.host);
      }
    }
    return out;
  } finally {
    await s.logout();
  }
}

/* ── the wildcard certificate ────────────────────────────────────────── */

/** does the certificate DSM serves cover this host? true / false / null (cannot tell) */
export async function tlsCovers(host, fetchImpl = fetch) {
  try {
    await fetchImpl(`https://${host}/`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10000) });
    return { covers: true };
  } catch (e) {
    const code = e.cause?.code ?? e.code ?? e.name;
    if (code === 'ERR_TLS_CERT_ALTNAME_INVALID') return { covers: false, code };
    if (['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_HAS_EXPIRED'].includes(code)) return { covers: false, code };
    return { covers: null, code };
  }
}

const certHasWildcard = (c, domain) => {
  const sans = c.subject?.sub_alt_name ?? [];
  // DSM 7.2 may list the CN only: our own request's description names the wildcard too
  return sans.includes(`*.${domain}`) || String(c.desc ?? '').includes(`*.${domain}`);
};
/** DSM prints valid_till like "Nov  1 23:59:59 2026 GMT"; unparseable stays valid (conservative) */
export const certValid = (c, now = Date.now()) => {
  const t = Date.parse(String(c.valid_till ?? ''));
  return Number.isNaN(t) || t > now;
};
const newest = (certs) => [...certs].sort((a, b) => new Date(b.valid_till ?? 0).getTime() - new Date(a.valid_till ?? 0).getTime())[0];
const listCerts = async (s) => (await s.read('SYNO.Core.Certificate.CRT', 1, 'list')).certificates ?? [];

/**
 * Bind the given reverse-proxy hosts to a certificate. DSM keeps a rule
 * on the certificate it was created with (the default only decides what
 * NEW services get), so a wildcard that arrived after the rules must be
 * moved onto them: SYNO.Core.Certificate.Service set with the service
 * descriptor DSM itself lists under the old certificate, verbatim (what
 * the Settings dialog sends). Returns {bound, migrated, unbound}.
 */
export async function bindRulesToCertificate(s, { certId, hosts }) {
  if (!hosts?.length) return { bound: 0, migrated: [], unbound: [] };
  const entries = (await s.read('SYNO.Core.AppPortal.ReverseProxy', 1, 'list')).entries ?? [];
  const uuidHost = new Map(entries.filter((e) => hosts.includes(e.frontend?.fqdn)).map((e) => [e.uuid, e.frontend.fqdn]));
  const settings = [];
  const seen = new Set();
  for (const c of await listCerts(s)) {
    for (const svc of c.services ?? []) {
      if (svc.subscriber !== 'ReverseProxy' || !uuidHost.has(svc.service)) continue;
      seen.add(svc.service);
      if (c.id !== certId) settings.push({ service: svc, old_id: c.id, id: certId });
    }
  }
  // a rule DSM lists under no certificate: bind it the way the wizard's first assignment does
  for (const [uuid, host] of uuidHost) {
    if (!seen.has(uuid)) settings.push({ service: { display_name: host, isPkg: false, multiple_cert: true, owner: 'root', service: uuid, subscriber: 'ReverseProxy', user_setable: true }, old_id: '', id: certId });
  }
  if (settings.length) await s.call('SYNO.Core.Certificate.Service', 1, 'set', { settings: JSON.stringify(settings) });
  const known = [...uuidHost.values()];
  return { bound: uuidHost.size, migrated: settings.map((x) => uuidHost.get(x.service.service)), unbound: hosts.filter((h) => !known.includes(h)) };
}

/**
 * Make DSM serve a certificate that covers *.<domain> on the given hosts.
 * Probe first (a covered host means nothing to do — never spends a Let's
 * Encrypt request); otherwise DSM's certificate list decides (a probe
 * that cannot tell — DNS down, a runner DSM blocks — is not a reason to
 * stop): reuse a valid wildcard certificate DSM already holds (set it
 * default), else — as the owner — request one through DSM's own Let's
 * Encrypt wizard call; then bind the hosts' rules to it. An expired
 * wildcard counts as absent. Returns {state, ...}: covered | present |
 * set-default | created | pending | absent (a non-owner waiting for the
 * prod twin's request).
 */
export async function ensureWildcardCertificate(creds, { domain, probeHost, email, hosts = [], owner = true, fetchImpl = fetch, probeImpl = null, sleepImpl = sleep } = {}) {
  const target = probeHost ?? domain;
  const probe = await (probeImpl ?? ((h) => tlsCovers(h, fetchImpl)))(target);
  if (probe.covers === true) return { state: 'covered', detail: `the certificate DSM serves covers ${target}` };
  const why = probe.covers === null ? `could not probe ${target} (${probe.code}) — DSM's certificate list decides` : `${target} is not covered (${probe.code})`;
  const s = await dsmSession(creds, fetchImpl, { sleepImpl });
  try {
    const names = `${domain};*.${domain}`;
    const bindNote = async (id) => {
      if (!hosts.length) return '';
      const b = await bindRulesToCertificate(s, { certId: id, hosts });
      const moved = b.migrated.length ? `; ${b.migrated.length} rule${b.migrated.length === 1 ? '' : 's'} moved onto it (${b.migrated.join(', ')})` : `; the ${b.bound} rule${b.bound === 1 ? '' : 's'} already use it`;
      return `${moved}${b.unbound.length ? `; no rule yet for ${b.unbound.join(', ')}` : ''}`;
    };
    const wild = (certs) => certs.filter((c) => certHasWildcard(c, domain));
    const certs = await listCerts(s);
    const valid = wild(certs).filter((c) => certValid(c));
    const expired = wild(certs).filter((c) => !certValid(c));
    if (valid.length) {
      const c = newest(valid);
      if (!c.is_default) {
        try {
          await s.call('SYNO.Core.Certificate.CRT', 1, 'set', { as_default: 'true', desc: JSON.stringify(c.desc ?? ''), id: JSON.stringify(c.id) });
        } catch (e) {
          // DSM restarts its web server on a default change — the answer may not arrive; the list tells
          if (!isTransport(e)) throw e;
          const now = (await listCerts(s)).find((x) => x.id === c.id);
          if (!now?.is_default) throw e;
        }
        return { state: 'set-default', id: c.id, detail: `${why}; DSM already held a wildcard certificate (${c.id}) — set as the default${await bindNote(c.id)}; DSM restarts its web server, the hosts serve it within a minute` };
      }
      return { state: 'present', id: c.id, detail: `${why}; DSM holds a valid wildcard certificate (${c.id}, default)${await bindNote(c.id)}${probe.covers === false ? '; if the hosts still fail TLS in a minute, DSM has not reloaded yet' : ''}` };
    }
    if (!owner) return { state: 'absent', detail: `${why}; no valid wildcard certificate on DSM yet — the prod twin's bootstrap requests it (one per NAS); this twin binds its rules on its next run` };
    const gone = expired.length ? ` (the wildcard DSM held, ${newest(expired).id}, expired ${newest(expired).valid_till})` : '';
    try {
      // DSM's wizard call is synchronous and slow (its own UI waits six minutes)
      await s.call('SYNO.Core.Certificate.LetsEncrypt', 1, 'create', {
        desc: JSON.stringify(names),
        domain_name: JSON.stringify(names),
        email: JSON.stringify(email),
        as_default: 'true',
      }, { timeoutMs: 360000 });
    } catch (e) {
      // only a request DSM never answered is looked up again — a request
      // DSM refused (rate limit 5524, validation 5503) is final and must
      // NOT be repeated: every request counts against the rate limit
      if (!isTransport(e)) throw e;
      const later = wild(await listCerts(s).catch(() => [])).filter((c) => certValid(c));
      if (later.length) {
        const c = newest(later);
        return { state: 'created', id: c.id, detail: `${why}; Let's Encrypt certificate for ${names} arrived (the request outlived the wait: ${e.message})${gone}${await bindNote(c.id)}` };
      }
      return { state: 'pending', detail: `${why}; the Let's Encrypt request for ${names} is still running on the NAS (${e.message}) — check Control Panel → Security → Certificate in a few minutes; do not re-request; the next bootstrap run binds the rules` };
    }
    const c = newest(wild(await listCerts(s).catch(() => [])).filter((x) => certValid(x)));
    return { state: 'created', id: c?.id ?? null, detail: `${why}; Let's Encrypt certificate for ${names} requested through DSM and set as default${gone}${c ? await bindNote(c.id) : ''}; DSM restarts its web server, the hosts serve it within a minute` };
  } finally {
    await s.logout();
  }
}

/* ── the live dir and the poller task ────────────────────────────────── */

export const POLLER_TASK_NAME = 'munni deploy poller';
/** the command the task runs: a throwaway copy of apply.sh, told where the live dir and the published folder are */
export const pollerScript = (liveDir, publishedDir = `${liveDir}/published`) =>
  `cd "${liveDir}" && cp apply.sh .apply.run && MUNNI_LIVE_DIR="${liveDir}" MUNNI_PUBLISHED_DIR="${publishedDir}" sh .apply.run`;

/** daily, every 5 minutes, all day — what DSM's own UI stores for that choice */
export const POLLER_SCHEDULE = {
  version: 4, // what DSM's own get returns for a v4 task; one client reports create wants it too
  date_type: 0,
  week_day: '0,1,2,3,4,5,6',
  repeat_date: 1001,
  monthly_week: [],
  hour: 0,
  minute: 0,
  repeat_hour: 0,
  repeat_min: 5,
  last_work_hour: 23,
  repeat_min_store_config: [1, 5, 10, 15, 20, 30],
  repeat_hour_store_config: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
};

/**
 * The ONE rule for SYNOLOGY_PATH (the FileStation path bundles land in,
 * e.g. /docker/munni/published): the live dir is its PARENT — the same
 * rule deploy-nas.yml (dirname) and nas-diag.yml use. Throws when the
 * path has no parent inside a shared folder.
 */
export function publishedPathParts(publishedPath) {
  const segments = String(publishedPath ?? '').split('/').filter(Boolean);
  if (segments.length < 2) throw new Error(`SYNOLOGY_PATH must be a folder inside a shared folder (the live dir is its parent), e.g. /docker/munni/published — yours: ${segments.length ? `/${segments.join('/')}` : '(empty)'}`);
  return { share: segments[0], publishedSharePath: `/${segments.join('/')}`, liveSharePath: `/${segments.slice(0, -1).join('/')}`, rest: segments.slice(1, -1), leaf: segments[segments.length - 1] };
}

/**
 * The FileStation share path → the dirs on disk (/volume1/docker/munni +
 * …/published) via the share's real path. Never guesses a volume: the
 * poller would run in the wrong place every five minutes. FileStation
 * may refuse a Core session — with creds a FileStation session is tried.
 */
export async function resolveLiveDir(session, publishedPath, { creds = null, fetchImpl = fetch, sleepImpl = sleep } = {}) {
  const parts = publishedPathParts(publishedPath);
  const shareOf = async (s) => ((await s.call('SYNO.FileStation.List', 2, 'list_share', { additional: JSON.stringify(['real_path']) })).shares ?? []).find((x) => x.name === parts.share)?.additional?.real_path ?? null;
  let realShare = null;
  let cause = null;
  try {
    realShare = await shareOf(session);
  } catch (e) {
    cause = e;
    if (creds) {
      const fs = await dsmSession(creds, fetchImpl, { session: 'FileStation', sleepImpl });
      try {
        realShare = await shareOf(fs);
        cause = null;
      } catch (e2) {
        cause = e2;
      } finally {
        await fs.logout();
      }
    }
  }
  if (cause) throw new Error(`could not resolve the real path of the shared folder "${parts.share}" (${cause.message})${dsmAdvice(cause)} — the poller task is not touched`);
  if (!realShare) throw new Error(`no shared folder named "${parts.share}" on the NAS (SYNOLOGY_PATH ${parts.publishedSharePath}) — create it in Control Panel → Shared Folder, or fix the path`);
  const liveDir = `${realShare}${parts.rest.length ? `/${parts.rest.join('/')}` : ''}`;
  return { ...parts, liveDir, publishedDir: `${liveDir}/${parts.leaf}` };
}

/**
 * Put the poller's own script in the live dir and make sure the published
 * folder exists, so the task never runs into an empty dir before the
 * first Deploy (every deploy re-uploads apply.sh too — the task runs a
 * throwaway copy, so overwriting is safe). Returns {state, liveSharePath}.
 */
export async function ensureLiveDir(creds, { publishedPath, applyScript, fetchImpl = fetch, sleepImpl = sleep } = {}) {
  const parts = publishedPathParts(publishedPath);
  const s = await dsmSession(creds, fetchImpl, { session: 'FileStation', sleepImpl });
  try {
    await s.upload(parts.liveSharePath, applyScript, 'apply.sh');
    // force_parent: no error when the folder exists, parents made as needed
    await s.call('SYNO.FileStation.CreateFolder', 2, 'create', { folder_path: JSON.stringify([parts.liveSharePath]), name: JSON.stringify([parts.leaf]), force_parent: 'true' });
    return { state: 'ready', liveSharePath: parts.liveSharePath, detail: `apply.sh uploaded to ${parts.liveSharePath}, ${parts.publishedSharePath} exists` };
  } finally {
    await s.logout();
  }
}

const liveDirOf = (script) => /MUNNI_LIVE_DIR="([^"]*)"/.exec(String(script ?? ''))?.[1] ?? null;

/**
 * Ensure the Task Scheduler entry that applies uploaded bundles exists
 * (root, every 5 minutes, all day). Returns {state, id, liveDir}:
 * present | updated | created. When the live dir cannot be resolved an
 * existing task is left alone (never rewritten onto a guess).
 */
export async function ensurePollerTask(creds, { publishedPath, fetchImpl = fetch, name = POLLER_TASK_NAME, sleepImpl = sleep } = {}) {
  const s = await dsmSession(creds, fetchImpl, { sleepImpl });
  try {
    const tasks = (await s.read('SYNO.Core.TaskScheduler', 3, 'list', { sort_by: 'name', sort_direction: 'ASC', offset: '0', limit: '500' })).tasks ?? [];
    const found = tasks.find((t) => t.name === name);
    const real = found ? (found.real_owner || found.owner || 'root') : 'root';
    const currentOf = async () => (found ? s.read('SYNO.Core.TaskScheduler', 4, 'get', { id: String(found.id), real_owner: real }).catch(() => null) : null);
    let dirs;
    try {
      dirs = await resolveLiveDir(s, publishedPath, { creds, fetchImpl, sleepImpl });
    } catch (e) {
      if (!found) throw e;
      const current = await currentOf();
      const dir = liveDirOf(current?.extra?.script);
      return { state: 'present', id: found.id, liveDir: dir, untouched: true, detail: `Task Scheduler entry "${name}" left as it is (runs in ${dir ?? 'an unknown dir'}) — ${e.message}` };
    }
    const { liveDir, publishedDir } = dirs;
    const script = pollerScript(liveDir, publishedDir);
    const confirm = async () => (await s.call('SYNO.Core.User.PasswordConfirm', 2, 'auth', { password: creds.pass })).SynoConfirmPWToken;
    const payload = (token, schedule = POLLER_SCHEDULE) => ({
      name,
      real_owner: 'root',
      owner: 'root',
      enable: 'true',
      type: 'script',
      schedule: JSON.stringify(schedule),
      extra: JSON.stringify({ script, notify_enable: false, notify_mail: '', notify_if_error: false }),
      SynoConfirmPWToken: token,
    });
    // DSM 7.3 rejects monthly_week on a daily task (4800) while 7.2 accepts it — try both shapes once
    const withRetry = async (method, extra) => {
      const token = await confirm();
      try {
        return await s.call('SYNO.Core.TaskScheduler.Root', 4, method, { ...payload(token), ...extra });
      } catch (e) {
        if (dsmCode(e) !== 4800) throw e;
        const { monthly_week: _mw, ...slim } = POLLER_SCHEDULE;
        return s.call('SYNO.Core.TaskScheduler.Root', 4, method, { ...payload(await confirm(), slim), ...extra });
      }
    };
    if (found) {
      const current = await currentOf();
      if (current?.extra?.script === script && (current.enable ?? true)) return { state: 'present', id: found.id, liveDir, detail: `Task Scheduler already runs "${name}" every 5 minutes in ${liveDir}` };
      await withRetry('set', { id: String(found.id), real_owner: real });
      return { state: 'updated', id: found.id, liveDir, detail: `Task Scheduler entry "${name}" updated to run in ${liveDir}` };
    }
    const created = await withRetry('create', {});
    return { state: 'created', id: created?.id ?? null, liveDir, detail: `Task Scheduler entry "${name}" created (root, every 5 minutes, all day) in ${liveDir} — bundles apply within five minutes from now` };
  } finally {
    await s.logout();
  }
}

/** read-only: what the NAS holds (for --verify) */
export async function inspectNas(creds, { domain, publishedPath, hosts = [], fetchImpl = fetch, name = POLLER_TASK_NAME, sleepImpl = sleep } = {}) {
  const s = await dsmSession(creds, fetchImpl, { sleepImpl });
  try {
    const certs = await listCerts(s);
    const wild = certs.filter((c) => certHasWildcard(c, domain));
    const valid = wild.filter((c) => certValid(c));
    const pick = valid.length ? newest(valid) : (wild.length ? newest(wild) : null);
    const tasks = (await s.read('SYNO.Core.TaskScheduler', 3, 'list', { sort_by: 'name', sort_direction: 'ASC', offset: '0', limit: '500' })).tasks ?? [];
    const task = tasks.find((t) => t.name === name) ?? null;
    let liveDir = null;
    let liveDirError = null;
    try {
      ({ liveDir } = await resolveLiveDir(s, publishedPath, { creds, fetchImpl, sleepImpl }));
    } catch (e) {
      liveDirError = e.message;
    }
    let bindings = null;
    if (pick && hosts.length) {
      const entries = (await s.read('SYNO.Core.AppPortal.ReverseProxy', 1, 'list').catch(() => ({}))).entries ?? [];
      const uuidHost = new Map(entries.filter((e) => hosts.includes(e.frontend?.fqdn)).map((e) => [e.uuid, e.frontend.fqdn]));
      const onWildcard = new Set((pick.services ?? []).filter((x) => x.subscriber === 'ReverseProxy').map((x) => x.service));
      const known = [...uuidHost.values()];
      bindings = {
        bound: [...uuidHost].filter(([u]) => onWildcard.has(u)).map(([, h]) => h),
        elsewhere: [...uuidHost].filter(([u]) => !onWildcard.has(u)).map(([, h]) => h),
        noRule: hosts.filter((h) => !known.includes(h)),
      };
    }
    return {
      wildcard: pick ? { id: pick.id, isDefault: Boolean(pick.is_default), expired: !valid.length, validTill: pick.valid_till ?? null } : null,
      task: task ? { id: task.id, enabled: task.enable !== false } : null,
      liveDir,
      liveDirError,
      bindings,
    };
  } finally {
    await s.logout();
  }
}
