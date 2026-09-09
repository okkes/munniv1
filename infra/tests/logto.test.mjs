import test from 'node:test';
import assert from 'node:assert/strict';
import { applySocialConnectors } from '../modules/logto.mjs';

const pair = { urls: { logto: 'http://logto.test' } };
const creds = { m2mId: 'm2m', m2mSecret: 's' };
const ok = (body = {}) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

/** a Logto management API in a box: token, connector list, the mutations */
function fakeLogto(connectors) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    // the token call is form-encoded, the management calls are JSON
    const raw = init.body === undefined ? null : String(init.body);
    calls.push({ url, method: init.method ?? 'GET', body: raw?.startsWith('{') ? JSON.parse(raw) : raw });
    if (url.endsWith('/oidc/token')) return ok({ access_token: 't' });
    if (url.includes('/api/connectors?')) return ok(connectors);
    if (init.method === 'DELETE') return { ok: true, status: 204, text: async () => '' };
    return ok({});
  };
  return { calls, fetchImpl };
}

const withEnv = async (env, fn) => {
  const prev = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

test('social connectors live under their FIXED ids — a generated-id instance is replaced so the documented callback is the real one', async () => {
  await withEnv({ LOGTO_GOOGLE_CLIENT_ID: 'cid', LOGTO_GOOGLE_CLIENT_SECRET: 'sec', LOGTO_APPLE_CLIENT_ID: '', LOGTO_APPLE_TEAM_ID: '', LOGTO_APPLE_KEY_ID: '', LOGTO_APPLE_PRIVATE_KEY: '' }, async () => {
    // the live 2026-09-09 shape: Google under a random id → redirect_uri_mismatch
    const stale = fakeLogto([{ id: 'r72tfa2jqdxd', connectorId: 'google-universal', target: 'google' }]);
    const out = await applySocialConnectors(pair, creds, { fetchImpl: stale.fetchImpl });
    assert.deepEqual(out.applied, ['google']);
    assert.deepEqual(out.renamed, ['r72tfa2jqdxd → google-universal']);
    assert.equal(out.callbacks.google, 'http://logto.test/callback/google-universal');
    const del = stale.calls.find((c) => c.method === 'DELETE');
    assert.equal(del.url, 'http://logto.test/api/connectors/r72tfa2jqdxd');
    const post = stale.calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/connectors'));
    assert.equal(post.body.id, 'google-universal', 'the proposed id IS the factory id');
    assert.equal(post.body.connectorId, 'google-universal');
    assert.equal(post.body.config.clientId, 'cid');
    const exp = stale.calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/sign-in-exp'));
    assert.deepEqual(exp.body.socialSignInConnectorTargets, ['google']);

    // already under the fixed id → config refreshed in place, nothing deleted
    const fine = fakeLogto([{ id: 'google-universal', connectorId: 'google-universal', target: 'google' }]);
    const out2 = await applySocialConnectors(pair, creds, { fetchImpl: fine.fetchImpl });
    assert.deepEqual(out2.renamed, []);
    assert.ok(!fine.calls.some((c) => c.method === 'DELETE'));
    const patch = fine.calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/api/connectors/google-universal'));
    assert.equal(patch.body.config.clientSecret, 'sec');

    // nothing configured → nothing touched
    const none = fakeLogto([]);
    await withEnv({ LOGTO_GOOGLE_CLIENT_ID: '', LOGTO_GOOGLE_CLIENT_SECRET: '' }, async () => {
      const out3 = await applySocialConnectors(pair, creds, { fetchImpl: none.fetchImpl });
      assert.deepEqual(out3.applied, []);
      assert.ok(!none.calls.some((c) => c.url.includes('/api/connectors')));
    });
  });
});
