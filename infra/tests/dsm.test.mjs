// DSM as code: the calls are shaped exactly like DSM's own UI's (captured by
// open-source clients); a fetch stub reads the form body back.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyReverseProxy, ensureWildcardCertificate, ensureLiveDir, ensurePollerTask, inspectNas, resolveLiveDir, publishedPathParts,
  dsmAdvice, dsmLogin, dsmSession, isPermissionError, isTransport, pollerScript, POLLER_TASK_NAME, tlsCovers, certValid,
} from '../modules/dsm.mjs';

const CREDS = { url: 'https://nas.example:5001/', user: 'deploy', pass: 'pw' };
const noWait = async () => {};

/** a DSM stub: routes by api+method, records every call's params (form body or multipart; _sid also from the query) */
function dsm(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const p = init?.body instanceof FormData
      ? Object.fromEntries([...init.body].map(([k, v]) => [k, v]))
      : Object.fromEntries(new URLSearchParams(init?.body ?? ''));
    if (u.searchParams.get('_sid')) p._sid = u.searchParams.get('_sid');
    const key = `${p.api}.${p.method}`;
    calls.push({ url, key, params: p, init });
    if (p.api === 'SYNO.API.Auth' && p.method === 'login') return { json: async () => ({ success: true, data: { sid: `SID-${p.session}`, synotoken: 'TOK' } }) };
    if (p.api === 'SYNO.API.Auth' && p.method === 'logout') return { json: async () => ({ success: true }) };
    const r = routes[key];
    if (!r) return { json: async () => ({ success: false, error: { code: 103 } }) };
    const out = typeof r === 'function' ? await r(p, calls) : r;
    if (out instanceof Error) throw out;
    if (out?.__http) return { status: out.__http, json: async () => { throw new SyntaxError('Unexpected token <'); }, text: async () => '<html>gateway</html>' };
    return { json: async () => out };
  };
  return { calls, fetchImpl };
}
const ok = (data = {}) => ({ success: true, data });
const fail = (code, extra = {}) => ({ success: false, error: { code, ...extra } });
const netErr = (code) => { const e = new Error('fetch failed'); e.cause = { code }; return e; };
const stack = { stack: 'munni-iac-prod', sharedServices: false, host: (k) => `${k}.nas.example`, ports: { web: 8290, api: 8292, admin: 8291 } };
const NOT_COVERED = async () => ({ covers: false, code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
const OLD = { id: 'old1', desc: 'nas.example', is_default: true, subject: { common_name: 'nas.example', sub_alt_name: ['nas.example'] }, valid_till: 'Oct 20 17:39:26 2036 GMT', services: [] };
const WILD = { id: 'wild1', desc: 'nas.example;*.nas.example', is_default: false, subject: { common_name: 'nas.example', sub_alt_name: ['nas.example', '*.nas.example'] }, valid_till: 'Dec  9 00:00:00 2036 GMT', services: [] };
const RULE_U1 = { display_name: 'web.nas.example', display_name_i18n: '', isPkg: false, multiple_cert: true, owner: 'root', service: 'u1', subscriber: 'ReverseProxy', user_setable: true };
const RULES = ok({ entries: [{ uuid: 'u1', frontend: { fqdn: 'web.nas.example' } }, { uuid: 'u9', frontend: { fqdn: 'other.nas.example' } }] });

test('dsm: every call rides the sid AND the SynoToken; error codes come with the operator advice; a hand-set access profile survives an update', async () => {
  const { calls, fetchImpl } = dsm({
    'SYNO.Core.AppPortal.ReverseProxy.list': ok({ entries: [{ uuid: 'a1', frontend: { fqdn: 'admin.nas.example', acl_id: 'lan-only' }, backend: { port: 1 } }] }),
    'SYNO.Core.AppPortal.ReverseProxy.create': ok({}),
    'SYNO.Core.AppPortal.ReverseProxy.update': ok({}),
  });
  const out = await applyReverseProxy(stack, CREDS, fetchImpl);
  assert.deepEqual(out.created, ['web.nas.example', 'api.nas.example']);
  assert.deepEqual(out.updated, ['admin.nas.example']);
  const list = calls.find((c) => c.key === 'SYNO.Core.AppPortal.ReverseProxy.list');
  assert.equal(list.params._sid, 'SID-Core');
  assert.equal(list.params.SynoToken, 'TOK');
  assert.equal(calls[0].params.enable_syno_token, 'yes');
  const update = JSON.parse(calls.find((c) => c.key === 'SYNO.Core.AppPortal.ReverseProxy.update').params.entry);
  assert.equal(update.uuid, 'a1');
  assert.equal(update.frontend.acl_id, 'lan-only', 'the LAN-only profile the operator set is kept');
  assert.equal(update.backend.port, 8291);
  assert.match(dsmAdvice(new Error('DSM SYNO.API.Auth.login failed: {"code":402}')), /DSM application is denied/);
  assert.match(dsmAdvice(new Error('DSM SYNO.API.Auth.login failed: {"code":402}')), /administrators group/, '402 names the admin step too — one text with validate.mjs');
  assert.match(dsmAdvice(new Error('DSM x failed: {"code":119}')), /administrators group/);
  assert.match(dsmAdvice(new Error('DSM x failed: {"code":5524}')), /rate limit/);
  assert.equal(dsmAdvice(new Error('nothing')), '');
  assert.equal(isPermissionError(new Error('DSM x failed: {"code":402}')), true);
  assert.equal(isPermissionError(new Error('DSM x failed: {"code":105}')), true);
  assert.equal(isPermissionError(new Error('DSM x failed: {"code":5524}')), false);
});

test('dsm transport: a login that gets no answer fails fast for the wizard check, and is retried through a web-server restart for a session', async () => {
  let n = 0;
  const flaky = async (url, init) => {
    n++;
    if (n === 1) throw netErr('ECONNREFUSED');
    const p = Object.fromEntries(new URLSearchParams(init.body));
    return { json: async () => ({ success: true, data: { sid: 'S', synotoken: 'T', session: p.session } }) };
  };
  await assert.rejects(dsmLogin('https://nas.example', 'u', 'p', flaky), (e) => isTransport(e) && /no answer \(ECONNREFUSED\)/.test(e.message));
  assert.equal(n, 1, 'no retry by default');
  n = 0;
  const s = await dsmSession(CREDS, flaky, { sleepImpl: noWait });
  assert.equal(s.sid, 'S');
  assert.equal(n, 2, 'a session retries the login once the NAS answers again');
  // a DSM-answered error is never a transport error
  const refused = dsm({});
  await assert.rejects(dsmSession(CREDS, async () => ({ json: async () => fail(402) }), { sleepImpl: noWait }), (e) => !isTransport(e) && /"code":402/.test(e.message));
  assert.equal(refused.calls.length, 0);
});

test('certificate: a covered host costs nothing; an uncovered one reuses a held wildcard (set default + bind the rules) or requests one the way the wizard does', async () => {
  // covered → not even a login
  const a = dsm({});
  const covered = await ensureWildcardCertificate(CREDS, { domain: 'nas.example', probeHost: 'web.nas.example', email: 'x@y.z', fetchImpl: a.fetchImpl, probeImpl: async () => ({ covers: true }) });
  assert.equal(covered.state, 'covered');
  assert.equal(a.calls.length, 0);

  // uncovered, a wildcard exists but is not the default → CRT set as_default (JSON-quoted strings),
  // then the rule the old certificate lists is moved onto it with the descriptor verbatim
  const b = dsm({
    'SYNO.Core.Certificate.CRT.list': ok({ certificates: [{ ...OLD, services: [RULE_U1] }, WILD] }),
    'SYNO.Core.Certificate.CRT.set': ok({}),
    'SYNO.Core.AppPortal.ReverseProxy.list': RULES,
    'SYNO.Core.Certificate.Service.set': ok({ restart_httpd: true }),
  });
  const reused = await ensureWildcardCertificate(CREDS, { domain: 'nas.example', probeHost: 'web.nas.example', email: 'x@y.z', hosts: ['web.nas.example', 'api.nas.example'], fetchImpl: b.fetchImpl, probeImpl: NOT_COVERED });
  assert.equal(reused.state, 'set-default');
  const set = b.calls.find((c) => c.key === 'SYNO.Core.Certificate.CRT.set');
  assert.equal(set.params.as_default, 'true');
  assert.equal(set.params.id, '"wild1"');
  assert.ok(!b.calls.some((c) => c.key === 'SYNO.Core.Certificate.LetsEncrypt.create'), 'no new request when one is held');
  const bind = JSON.parse(b.calls.find((c) => c.key === 'SYNO.Core.Certificate.Service.set').params.settings);
  assert.deepEqual(bind, [{ service: RULE_U1, old_id: 'old1', id: 'wild1' }]);
  assert.match(reused.detail, /1 rule moved onto it \(web\.nas\.example\)/);
  assert.match(reused.detail, /no rule yet for api\.nas\.example/);

  // uncovered, nothing held → LetsEncrypt create with "host;*.host" in domain_name (the wizard's shape),
  // as default, with the six-minute wait; the new certificate is then bound to a rule DSM listed nowhere
  let listed = 0;
  const c = dsm({
    'SYNO.Core.Certificate.CRT.list': () => ok({ certificates: listed++ === 0 ? [OLD] : [OLD, { ...WILD, id: 'new', is_default: true }] }),
    'SYNO.Core.Certificate.LetsEncrypt.create': ok({ restart_httpd: true }),
    'SYNO.Core.AppPortal.ReverseProxy.list': RULES,
    'SYNO.Core.Certificate.Service.set': ok({}),
  });
  const waits = [];
  const origTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (ms) => { waits.push(ms); return origTimeout.call(AbortSignal, ms); };
  let created;
  try {
    created = await ensureWildcardCertificate(CREDS, { domain: 'nas.example', probeHost: 'web.nas.example', email: 'ops@nas.example', hosts: ['web.nas.example'], fetchImpl: c.fetchImpl, probeImpl: NOT_COVERED });
  } finally {
    AbortSignal.timeout = origTimeout;
  }
  assert.equal(created.state, 'created');
  assert.equal(created.id, 'new');
  const create = c.calls.find((x) => x.key === 'SYNO.Core.Certificate.LetsEncrypt.create');
  assert.equal(create.params.domain_name, '"nas.example;*.nas.example"');
  assert.equal(create.params.email, '"ops@nas.example"');
  assert.equal(create.params.as_default, 'true');
  assert.equal(create.params.version, '1');
  assert.ok(waits.includes(360000), 'the wizard call waits six minutes like DSM’s own UI');
  assert.ok(waits.includes(30000), 'every other call keeps the short timeout');
  const firstBind = JSON.parse(c.calls.find((x) => x.key === 'SYNO.Core.Certificate.Service.set').params.settings);
  assert.equal(firstBind.length, 1);
  assert.equal(firstBind[0].old_id, '');
  assert.equal(firstBind[0].id, 'new');
  assert.equal(firstBind[0].service.service, 'u1');
  assert.equal(firstBind[0].service.subscriber, 'ReverseProxy');

  // a probe that cannot tell (DNS down, a runner DSM blocks) is not a reason to stop: the list decides
  const e = dsm({ 'SYNO.Core.Certificate.CRT.list': ok({ certificates: [OLD, { ...WILD, is_default: true }] }) });
  const unknownPresent = await ensureWildcardCertificate(CREDS, { domain: 'nas.example', probeHost: 'web.nas.example', email: 'x@y.z', fetchImpl: e.fetchImpl, probeImpl: async () => ({ covers: null, code: 'ENOTFOUND' }) });
  assert.equal(unknownPresent.state, 'present');
  assert.match(unknownPresent.detail, /could not probe web\.nas\.example \(ENOTFOUND\)/);
  const f = dsm({ 'SYNO.Core.Certificate.CRT.list': ok({ certificates: [OLD] }), 'SYNO.Core.Certificate.LetsEncrypt.create': ok({}) });
  const unknownCreated = await ensureWildcardCertificate(CREDS, { domain: 'nas.example', probeHost: 'web.nas.example', email: 'x@y.z', fetchImpl: f.fetchImpl, probeImpl: async () => ({ covers: null, code: 'ETIMEDOUT' }) });
  assert.equal(unknownCreated.state, 'created');
  assert.equal(f.calls.filter((x) => x.key === 'SYNO.Core.Certificate.LetsEncrypt.create').length, 1);
});

test('certificate: an expired wildcard counts as absent; a non-owner never requests; only a request DSM never answered is looked up again', async () => {
  // the default wildcard expired (DSM 7.3 leaves the old object bound) → a new request, never "present"
  const expired = { ...WILD, id: 'stale', is_default: true, valid_till: 'Jan  1 00:00:00 2020 GMT' };
  let listed = 0;
  const a = dsm({
    'SYNO.Core.Certificate.CRT.list': () => ok({ certificates: listed++ === 0 ? [expired] : [expired, { ...WILD, id: 'fresh', is_default: true }] }),
    'SYNO.Core.Certificate.LetsEncrypt.create': ok({}),
  });
  const renewed = await ensureWildcardCertificate(CREDS, { domain: 'nas.example', probeHost: 'web.nas.example', email: 'x@y.z', fetchImpl: a.fetchImpl, probeImpl: async () => ({ covers: false, code: 'CERT_HAS_EXPIRED' }) });
  assert.equal(renewed.state, 'created');
  assert.equal(renewed.id, 'fresh');
  assert.match(renewed.detail, /stale, expired/);
  assert.equal(certValid(expired), false);
  assert.equal(certValid(WILD), true);
  assert.equal(certValid({ valid_till: 'not a date' }), true, 'unparseable stays valid');

  // the staging twin: binds its rules to a wildcard it finds, never requests one
  const b = dsm({ 'SYNO.Core.Certificate.CRT.list': ok({ certificates: [OLD] }) });
  const absent = await ensureWildcardCertificate(CREDS, { domain: 'nas.example', probeHost: 'web.nas.example', email: 'x@y.z', owner: false, fetchImpl: b.fetchImpl, probeImpl: NOT_COVERED });
  assert.equal(absent.state, 'absent');
  assert.match(absent.detail, /prod twin/);
  assert.ok(!b.calls.some((x) => x.key === 'SYNO.Core.Certificate.LetsEncrypt.create'));
  const b2 = dsm({
    'SYNO.Core.Certificate.CRT.list': ok({ certificates: [{ ...OLD, services: [RULE_U1] }, { ...WILD, is_default: true }] }),
    'SYNO.Core.AppPortal.ReverseProxy.list': RULES,
    'SYNO.Core.Certificate.Service.set': ok({}),
  });
  const adopted = await ensureWildcardCertificate(CREDS, { domain: 'nas.example', probeHost: 'web.nas.example', email: 'x@y.z', owner: false, hosts: ['web.nas.example'], fetchImpl: b2.fetchImpl, probeImpl: NOT_COVERED });
  assert.equal(adopted.state, 'present');
  assert.ok(b2.calls.some((x) => x.key === 'SYNO.Core.Certificate.Service.set'), 'the non-owner still moves its rules onto the wildcard');

  // a wizard call that outlives the wait is NOT retried: the list decides (arrived → created)
  let listedLate = 0;
  const d = dsm({
    'SYNO.Core.Certificate.CRT.list': () => ok({ certificates: listedLate++ === 0 ? [] : [{ ...WILD, id: 'late', is_default: true }] }),
    'SYNO.Core.Certificate.LetsEncrypt.create': () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; return e; },
  });
  const late = await ensureWildcardCertificate(CREDS, { domain: 'nas.example', probeHost: 'web.nas.example', email: 'x@y.z', fetchImpl: d.fetchImpl, probeImpl: NOT_COVERED });
  assert.equal(late.state, 'created');
  assert.equal(late.id, 'late');
  assert.equal(d.calls.filter((x) => x.key === 'SYNO.Core.Certificate.LetsEncrypt.create').length, 1);

  // …and still nothing after the wait → pending, exactly one request ever
  const p = dsm({
    'SYNO.Core.Certificate.CRT.list': ok({ certificates: [] }),
    'SYNO.Core.Certificate.LetsEncrypt.create': () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; return e; },
  });
  const pending = await ensureWildcardCertificate(CREDS, { domain: 'nas.example', probeHost: 'web.nas.example', email: 'x@y.z', fetchImpl: p.fetchImpl, probeImpl: NOT_COVERED });
  assert.equal(pending.state, 'pending');
  assert.match(pending.detail, /do not re-request/);
  assert.equal(p.calls.filter((x) => x.key === 'SYNO.Core.Certificate.LetsEncrypt.create').length, 1);

  // DSM's front nginx answering 504 (its own UI's slow-request case) is the same: look again
  let listed504 = 0;
  const g = dsm({
    'SYNO.Core.Certificate.CRT.list': () => ok({ certificates: listed504++ === 0 ? [] : [{ ...WILD, id: 'via504', is_default: true }] }),
    'SYNO.Core.Certificate.LetsEncrypt.create': { __http: 504 },
  });
  const gateway = await ensureWildcardCertificate(CREDS, { domain: 'nas.example', probeHost: 'web.nas.example', email: 'x@y.z', fetchImpl: g.fetchImpl, probeImpl: NOT_COVERED });
  assert.equal(gateway.state, 'created');
  assert.match(gateway.detail, /HTTP 504/);

  // a failure DSM ANSWERED — even one whose text says "Timeout" — is final: no second list, no second request
  const h = dsm({
    'SYNO.Core.Certificate.CRT.list': ok({ certificates: [] }),
    'SYNO.Core.Certificate.LetsEncrypt.create': fail(5503, { errors: { msg: 'Fetching http://nas.example/.well-known/acme-challenge/x: Timeout during connect' } }),
  });
  await assert.rejects(ensureWildcardCertificate(CREDS, { domain: 'nas.example', probeHost: 'web.nas.example', email: 'x@y.z', fetchImpl: h.fetchImpl, probeImpl: NOT_COVERED }), /"code":5503/);
  assert.equal(h.calls.filter((x) => x.key === 'SYNO.Core.Certificate.CRT.list').length, 1);
  assert.equal(h.calls.filter((x) => x.key === 'SYNO.Core.Certificate.LetsEncrypt.create').length, 1);
  const rate = dsm({ 'SYNO.Core.Certificate.CRT.list': ok({ certificates: [] }), 'SYNO.Core.Certificate.LetsEncrypt.create': fail(5524) });
  await assert.rejects(ensureWildcardCertificate(CREDS, { domain: 'nas.example', probeHost: 'web.nas.example', email: 'x@y.z', fetchImpl: rate.fetchImpl, probeImpl: NOT_COVERED }), (e) => /"code":5524/.test(e.message) && /rate limit/.test(dsmAdvice(e)));

  // set-as-default whose answer is lost to DSM's web-server restart: the list confirms it
  let setTried = false;
  const k = dsm({
    'SYNO.Core.Certificate.CRT.list': () => ok({ certificates: [OLD, { ...WILD, is_default: setTried }] }),
    'SYNO.Core.Certificate.CRT.set': () => { setTried = true; return netErr('ECONNRESET'); },
  });
  const dropped = await ensureWildcardCertificate(CREDS, { domain: 'nas.example', probeHost: 'web.nas.example', email: 'x@y.z', fetchImpl: k.fetchImpl, probeImpl: NOT_COVERED, sleepImpl: noWait });
  assert.equal(dropped.state, 'set-default');
});

test('live dir: ONE rule — the parent of SYNOLOGY_PATH — resolved through the share’s real path, never guessed', async () => {
  assert.deepEqual(publishedPathParts('/docker/munni/published'), { share: 'docker', publishedSharePath: '/docker/munni/published', liveSharePath: '/docker/munni', rest: ['munni'], leaf: 'published' });
  assert.equal(publishedPathParts('docker/munni-iac/incoming/').liveSharePath, '/docker/munni-iac', 'the parent, whatever the leaf is called (deploy-nas.yml uses dirname)');
  assert.equal(publishedPathParts('/docker/published').liveSharePath, '/docker');
  assert.throws(() => publishedPathParts('/docker'), /inside a shared folder/);
  assert.throws(() => publishedPathParts(''), /inside a shared folder/);
  const shares = { shares: [{ name: 'docker', additional: { real_path: '/volume2/docker' } }] };
  const s = { call: async () => shares };
  assert.deepEqual(await resolveLiveDir(s, 'docker/munni/published'), { share: 'docker', publishedSharePath: '/docker/munni/published', liveSharePath: '/docker/munni', rest: ['munni'], leaf: 'published', liveDir: '/volume2/docker/munni', publishedDir: '/volume2/docker/munni/published' });
  assert.equal((await resolveLiveDir(s, '/docker/munni/')).liveDir, '/volume2/docker', 'no /published suffix magic: the parent of the last segment');
  await assert.rejects(resolveLiveDir({ call: async () => ({ shares: [] }) }, '/docker/munni/published'), /no shared folder named "docker"/);
  await assert.rejects(resolveLiveDir({ call: async () => { throw new Error('DSM SYNO.FileStation.List.list_share failed: {"code":119}'); } }, '/docker/munni/published'), /could not resolve the real path .*administrators group.*not touched/);
  // FileStation may refuse the Core session: with creds, a FileStation session is tried
  const fsOnly = dsm({ 'SYNO.FileStation.List.list_share': (p) => (p._sid === 'SID-FileStation' ? ok(shares) : fail(119)) });
  const core = await dsmSession(CREDS, fsOnly.fetchImpl, { sleepImpl: noWait });
  const viaFs = await resolveLiveDir(core, '/docker/munni/published', { creds: CREDS, fetchImpl: fsOnly.fetchImpl, sleepImpl: noWait });
  assert.equal(viaFs.liveDir, '/volume2/docker/munni');
  assert.ok(fsOnly.calls.some((c) => c.key === 'SYNO.API.Auth.login' && c.params.session === 'FileStation'));
});

test('poller task: created root-owned behind a password-confirm token, every 5 minutes all day, in the live dir next to published; present → untouched; 4800 → retried without monthly_week; an unresolved live dir never rewrites a task', async () => {
  const shares = ok({ shares: [{ name: 'docker', additional: { real_path: '/volume2/docker' } }] });
  const a = dsm({
    'SYNO.FileStation.List.list_share': shares,
    'SYNO.Core.TaskScheduler.list': ok({ tasks: [{ id: 3, name: 'other', owner: 'root', real_owner: 'root' }] }),
    'SYNO.Core.User.PasswordConfirm.auth': ok({ SynoConfirmPWToken: 'CONFIRM' }),
    'SYNO.Core.TaskScheduler.Root.create': ok({ id: 42 }),
  });
  const created = await ensurePollerTask(CREDS, { publishedPath: 'docker/munni-iac/published', fetchImpl: a.fetchImpl });
  assert.equal(created.state, 'created');
  assert.equal(created.id, 42);
  assert.equal(created.liveDir, '/volume2/docker/munni-iac', 'the share’s real path replaces the FileStation share name');
  const create = a.calls.find((c) => c.key === 'SYNO.Core.TaskScheduler.Root.create');
  assert.equal(create.params.name, POLLER_TASK_NAME);
  assert.equal(create.params.real_owner, 'root');
  assert.equal(create.params.type, 'script');
  assert.equal(create.params.SynoConfirmPWToken, 'CONFIRM');
  assert.equal(create.params.version, '4');
  const schedule = JSON.parse(create.params.schedule);
  assert.equal(schedule.repeat_min, 5);
  assert.equal(schedule.last_work_hour, 23);
  assert.equal(schedule.repeat_date, 1001);
  assert.equal(schedule.week_day, '0,1,2,3,4,5,6');
  const extra = JSON.parse(create.params.extra);
  assert.equal(extra.script, pollerScript('/volume2/docker/munni-iac'));
  assert.equal(extra.script, 'cd "/volume2/docker/munni-iac" && cp apply.sh .apply.run && MUNNI_LIVE_DIR="/volume2/docker/munni-iac" MUNNI_PUBLISHED_DIR="/volume2/docker/munni-iac/published" sh .apply.run', 'quoted cd (share names may hold spaces), both dirs passed — apply.sh guesses nothing');
  const confirm = a.calls.find((c) => c.key === 'SYNO.Core.User.PasswordConfirm.auth');
  assert.equal(confirm.params.password, 'pw');

  // present with the right script → no write at all
  const b = dsm({
    'SYNO.FileStation.List.list_share': shares,
    'SYNO.Core.TaskScheduler.list': ok({ tasks: [{ id: 42, name: POLLER_TASK_NAME, owner: 'root', real_owner: 'root', enable: true }] }),
    'SYNO.Core.TaskScheduler.get': ok({ id: 42, enable: true, extra: { script: pollerScript('/volume2/docker/munni-iac') } }),
  });
  const present = await ensurePollerTask(CREDS, { publishedPath: '/docker/munni-iac/published', fetchImpl: b.fetchImpl });
  assert.equal(present.state, 'present');
  assert.ok(!b.calls.some((c) => c.key.startsWith('SYNO.Core.TaskScheduler.Root')));

  // present with a stale command → set
  const c = dsm({
    'SYNO.FileStation.List.list_share': shares,
    'SYNO.Core.TaskScheduler.list': ok({ tasks: [{ id: 42, name: POLLER_TASK_NAME, owner: 'root', real_owner: 'root' }] }),
    'SYNO.Core.TaskScheduler.get': ok({ id: 42, extra: { script: 'old' } }),
    'SYNO.Core.User.PasswordConfirm.auth': ok({ SynoConfirmPWToken: 'CONFIRM' }),
    'SYNO.Core.TaskScheduler.Root.set': ok({}),
  });
  const updated = await ensurePollerTask(CREDS, { publishedPath: '/docker/munni-iac/published', fetchImpl: c.fetchImpl });
  assert.equal(updated.state, 'updated');
  assert.equal(c.calls.find((x) => x.key === 'SYNO.Core.TaskScheduler.Root.set').params.id, '42');

  // 4800 on the first shape → the same create without monthly_week, with a fresh token
  let attempts = 0;
  const d = dsm({
    'SYNO.FileStation.List.list_share': shares,
    'SYNO.Core.TaskScheduler.list': ok({ tasks: [] }),
    'SYNO.Core.User.PasswordConfirm.auth': ok({ SynoConfirmPWToken: 'CONFIRM' }),
    'SYNO.Core.TaskScheduler.Root.create': (p) => { attempts++; return JSON.parse(p.schedule).monthly_week ? fail(4800) : ok({ id: 7 }); },
  });
  const retried = await ensurePollerTask(CREDS, { publishedPath: 'docker/munni/published', fetchImpl: d.fetchImpl });
  assert.equal(retried.state, 'created');
  assert.equal(attempts, 2);

  // the share cannot be resolved (neither session) and a task exists → left alone, its own dir reported
  const e = dsm({
    'SYNO.FileStation.List.list_share': fail(119),
    'SYNO.Core.TaskScheduler.list': ok({ tasks: [{ id: 42, name: POLLER_TASK_NAME, owner: 'root', real_owner: 'root' }] }),
    'SYNO.Core.TaskScheduler.get': ok({ id: 42, extra: { script: pollerScript('/volume1/docker/munni') } }),
  });
  const kept = await ensurePollerTask(CREDS, { publishedPath: '/docker/munni/published', fetchImpl: e.fetchImpl, sleepImpl: noWait });
  assert.equal(kept.state, 'present');
  assert.equal(kept.untouched, true);
  assert.equal(kept.liveDir, '/volume1/docker/munni');
  assert.match(kept.detail, /left as it is/);
  assert.ok(!e.calls.some((x) => x.key.startsWith('SYNO.Core.TaskScheduler.Root')), 'never rewritten onto a guess');
  // …and with no task at all the failure is loud
  const f = dsm({ 'SYNO.FileStation.List.list_share': fail(119), 'SYNO.Core.TaskScheduler.list': ok({ tasks: [] }) });
  await assert.rejects(ensurePollerTask(CREDS, { publishedPath: '/docker/munni/published', fetchImpl: f.fetchImpl, sleepImpl: noWait }), /could not resolve the real path/);
  await assert.rejects(ensurePollerTask(CREDS, { publishedPath: '', fetchImpl: f.fetchImpl, sleepImpl: noWait }), /inside a shared folder/);
});

test('live dir: apply.sh is uploaded through FileStation (multipart, _sid in the query, file last) and the published folder is created', async () => {
  const a = dsm({
    'SYNO.FileStation.Upload.upload': ok({ file: 'apply.sh' }),
    'SYNO.FileStation.CreateFolder.create': ok({ folders: [] }),
  });
  const out = await ensureLiveDir(CREDS, { publishedPath: '/docker/munni-iac/published', applyScript: '#!/bin/sh\necho hi\n', fetchImpl: a.fetchImpl });
  assert.equal(out.state, 'ready');
  assert.equal(out.liveSharePath, '/docker/munni-iac');
  const login = a.calls.find((c) => c.key === 'SYNO.API.Auth.login');
  assert.equal(login.params.session, 'FileStation');
  const up = a.calls.find((c) => c.key === 'SYNO.FileStation.Upload.upload');
  assert.equal(up.params._sid, 'SID-FileStation');
  assert.ok(/\/webapi\/entry\.cgi\?_sid=SID-FileStation$/.test(up.url), 'the sid rides the query string, as upload.sh does');
  assert.equal(up.params.path, '/docker/munni-iac');
  assert.equal(up.params.create_parents, 'true');
  assert.equal(up.params.overwrite, 'true');
  assert.ok(up.params.file instanceof Blob);
  assert.equal(up.params.file.name, 'apply.sh');
  assert.equal(await up.params.file.text(), '#!/bin/sh\necho hi\n');
  assert.equal([...up.init.body.keys()].at(-1), 'file', 'the file is the last multipart field (FileStation reads the parameters before it)');
  const folder = a.calls.find((c) => c.key === 'SYNO.FileStation.CreateFolder.create');
  assert.equal(folder.params.version, '2');
  assert.deepEqual(JSON.parse(folder.params.folder_path), ['/docker/munni-iac']);
  assert.deepEqual(JSON.parse(folder.params.name), ['published']);
  assert.equal(folder.params.force_parent, 'true');
  assert.equal(folder.params._sid, 'SID-FileStation');
});

test('inspectNas + tlsCovers: read-only views the verify step prints — certificate, bindings, task, live dir', async () => {
  const a = dsm({
    'SYNO.Core.Certificate.CRT.list': ok({ certificates: [{ id: 'w', desc: 'd;*.d', is_default: true, subject: { common_name: 'd' }, valid_till: 'Dec  9 00:00:00 2036 GMT', services: [{ service: 'u1', subscriber: 'ReverseProxy' }] }] }),
    'SYNO.Core.TaskScheduler.list': ok({ tasks: [{ id: 9, name: POLLER_TASK_NAME, enable: true }] }),
    'SYNO.FileStation.List.list_share': fail(119),
    'SYNO.Core.AppPortal.ReverseProxy.list': ok({ entries: [{ uuid: 'u1', frontend: { fqdn: 'web.d' } }, { uuid: 'u2', frontend: { fqdn: 'api.d' } }] }),
  });
  const view = await inspectNas(CREDS, { domain: 'd', publishedPath: '/docker/munni/published', hosts: ['web.d', 'api.d', 'admin.d'], fetchImpl: a.fetchImpl, sleepImpl: noWait });
  assert.deepEqual(view.wildcard, { id: 'w', isDefault: true, expired: false, validTill: 'Dec  9 00:00:00 2036 GMT' });
  assert.deepEqual(view.task, { id: 9, enabled: true });
  assert.equal(view.liveDir, null);
  assert.match(view.liveDirError, /could not resolve the real path/);
  assert.deepEqual(view.bindings, { bound: ['web.d'], elsewhere: ['api.d'], noRule: ['admin.d'] });
  const b = dsm({
    'SYNO.Core.Certificate.CRT.list': ok({ certificates: [{ id: 'x', desc: 'd;*.d', is_default: true, valid_till: 'Jan  1 00:00:00 2020 GMT' }] }),
    'SYNO.Core.TaskScheduler.list': ok({ tasks: [] }),
    'SYNO.FileStation.List.list_share': ok({ shares: [{ name: 'docker', additional: { real_path: '/volume1/docker' } }] }),
  });
  const stale = await inspectNas(CREDS, { domain: 'd', publishedPath: '/docker/munni/published', fetchImpl: b.fetchImpl });
  assert.equal(stale.wildcard.expired, true);
  assert.equal(stale.task, null);
  assert.equal(stale.liveDir, '/volume1/docker/munni');
  assert.equal(stale.bindings, null);
  const bad = await tlsCovers('x.example', async () => { throw netErr('ERR_TLS_CERT_ALTNAME_INVALID'); });
  assert.deepEqual(bad, { covers: false, code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
  const good = await tlsCovers('x.example', async () => ({ status: 200 }));
  assert.deepEqual(good, { covers: true });
  const dns = await tlsCovers('x.example', async () => { throw netErr('ENOTFOUND'); });
  assert.equal(dns.covers, null);
});
