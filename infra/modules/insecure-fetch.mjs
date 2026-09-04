import { request } from 'node:https';

/**
 * fetch-shaped https client that SKIPS certificate verification — for
 * talking to OUR OWN local services only: the family Caddy signs
 * localhost and the sslip.io LAN hostnames with a locally-minted
 * internal CA, which node rightly distrusts. Never use this for
 * anything on the public internet; the global fetch stays strict for
 * everything else.
 */

/** does this url point at one of OUR locally-signed origins? */
export const isLocalTlsUrl = (url) =>
  /^https:\/\/(localhost(:\d+)?|[a-z0-9-]+\.\d+-\d+-\d+-\d+\.sslip\.io)(\/|$)/.test(String(url));

/** strict fetch for the world, unverified for our own local-CA https */
export const localAwareFetch = (url, init) => (isLocalTlsUrl(url) ? insecureFetch(url, init) : fetch(url, init));
export function insecureFetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request( // NOSONAR S4830 S5527 - deliberate: our own local-CA services only, gated by isLocalTlsUrl
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: init.method ?? 'GET',
        headers: init.headers,
        signal: init.signal,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text: async () => body,
            json: async () => JSON.parse(body),
          });
        });
      },
    );
    req.on('error', reject);
    if (init.body) req.write(typeof init.body === 'string' || Buffer.isBuffer(init.body) ? init.body : String(init.body));
    req.end();
  });
}
