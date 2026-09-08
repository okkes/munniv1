/**
 * DSM 7 as code (IAC4, reverse-proxy part): the same webapi the deploy
 * pipeline already drives for FileStation. Creates/updates the stack's
 * reverse-proxy rules idempotently — matched by source FQDN, so re-runs
 * converge instead of duplicating. Auth: SYNOLOGY_URL/USER/PASS env
 * (the deploy account, which needs DSM admin for AppPortal writes).
 *
 * Firewall rules stay manual (the DSM firewall API is undocumented and
 * fragile) — `--verify` probes the outcome instead.
 */

async function dsmCall(base, path, params) {
  const res = await fetch(`${base}/webapi/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const body = await res.json();
  if (!body.success) throw new Error(`DSM ${params.api}.${params.method} failed: ${JSON.stringify(body.error)}`);
  return body.data;
}

export async function dsmLogin(base, account, passwd) {
  // enable_syno_token: DSM 7 wants the CSRF token beside the sid on
  // state-changing entry.cgi calls (per the documented v7 auth flow)
  const data = await dsmCall(base, 'auth.cgi', {
    api: 'SYNO.API.Auth',
    version: '7',
    method: 'login',
    account,
    passwd,
    session: 'Core',
    format: 'sid',
    enable_syno_token: 'yes',
  });
  return { sid: data.sid, token: data.synotoken };
}

export async function dsmLogout(base, sid) {
  await dsmCall(base, 'auth.cgi', { api: 'SYNO.API.Auth', version: '7', method: 'logout', session: 'Core', _sid: sid }).catch(() => undefined);
}

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
    );
  }
  return rules;
}

/** upsert the stack's rules; returns {created, updated, unchanged} */
export async function applyReverseProxy(stack, { url, user, pass }) {
  const base = url.replace(/\/$/, '');
  const { sid, token } = await dsmLogin(base, user, pass);
  const auth = { _sid: sid, ...(token ? { SynoToken: token } : {}) };
  try {
    const existing = (
      await dsmCall(base, 'entry.cgi', {
        api: 'SYNO.Core.AppPortal.ReverseProxy',
        version: '1',
        method: 'list',
        ...auth,
      })
    ).entries ?? [];
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
        await dsmCall(base, 'entry.cgi', {
          api: 'SYNO.Core.AppPortal.ReverseProxy',
          version: '1',
          method: 'create',
          entry: JSON.stringify(desired),
          ...auth,
        });
        out.created.push(rule.host);
      } else if (match.backend?.port !== rule.port) {
        await dsmCall(base, 'entry.cgi', {
          api: 'SYNO.Core.AppPortal.ReverseProxy',
          version: '1',
          method: 'update',
          entry: JSON.stringify({ ...desired, uuid: match.uuid }),
          ...auth,
        });
        out.updated.push(rule.host);
      } else {
        out.unchanged.push(rule.host);
      }
    }
    return out;
  } finally {
    await dsmLogout(base, sid);
  }
}
