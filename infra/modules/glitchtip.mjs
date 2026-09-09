import { execFileSync } from 'node:child_process';
import { localAwareFetch } from './insecure-fetch.mjs';

/**
 * GlitchTip-as-code (IAC8: "GlitchTip org/DSN creation has an API —
 * automate, easy"). After the pair's GlitchTip boots, the ONE remaining
 * manual step is creating the first account + an API token (auth tokens
 * live under profile → Auth Tokens). With that token stored
 * (IAC_GLITCHTIP_API_TOKEN), bootstrap ensures the org, the team and the
 * per-stack projects, then writes each DSN back where CI reads it —
 * runbook §4 dies. The API is Sentry-shaped: /api/0/…, Bearer auth.
 */

async function api(base, token, path, init = {}) {
  const res = await localAwareFetch(`${base}/api/0${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`glitchtip ${init.method ?? 'GET'} ${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}

async function ensureOrg(base, token, slug) {
  const orgs = await api(base, token, '/organizations/');
  const match = orgs.find((o) => o.slug === slug || o.name === slug);
  return match ?? (await api(base, token, '/organizations/', { method: 'POST', body: JSON.stringify({ name: slug }) }));
}

async function ensureTeam(base, token, org, slug) {
  const teams = await api(base, token, `/organizations/${org}/teams/`);
  const match = teams.find((t) => t.slug === slug);
  return match ?? (await api(base, token, `/organizations/${org}/teams/`, { method: 'POST', body: JSON.stringify({ slug }) }));
}

async function ensureProject(base, token, org, team, name, platform) {
  const projects = await api(base, token, `/organizations/${org}/projects/`);
  const match = projects.find((p) => p.slug === name || p.name === name);
  return (
    match ??
    (await api(base, token, `/teams/${org}/${team}/projects/`, { method: 'POST', body: JSON.stringify({ name, platform }) }))
  );
}

async function projectDsn(base, token, org, project) {
  const keys = await api(base, token, `/projects/${org}/${project}/keys/`);
  const key = keys[0] ?? (await api(base, token, `/projects/${org}/${project}/keys/`, { method: 'POST', body: JSON.stringify({ name: 'default' }) }));
  const dsn = key?.dsn?.public;
  if (!dsn) throw new Error(`glitchtip project ${project} returned a key without a public DSN`);
  return dsn;
}

/**
 * Ensure org/team/projects for one stack on the PAIR's GlitchTip and
 * return its three DSNs. Idempotent by slug.
 */
export async function applyGlitchTip(pairStack, stack, token) {
  const base = pairStack.urls.glitchtip;
  const orgSlug = stack.pair;
  const org = await ensureOrg(base, token, orgSlug);
  const team = await ensureTeam(base, token, org.slug, orgSlug);
  const dsns = {};
  for (const [key, suffix, platform] of [
    ['web', 'pwa', 'javascript'],
    ['api', 'api', 'csharp'],
    ['admin', 'admin', 'javascript'],
  ]) {
    const project = await ensureProject(base, token, org.slug, team.slug, `${stack.stack}-${suffix}`, platform);
    dsns[key] = await projectDsn(base, token, org.slug, project.slug);
  }
  return dsns;
}

/** write the DSNs where CI reads them (mirrors logto's writeBack) */
export function writeBackDsns(stack, dsns) {
  const env = stack.githubEnvironment;
  execFileSync('gh', ['secret', 'set', 'NAS_API_SENTRY_DSN', '--env', env, '--body', dsns.api]);
  execFileSync('gh', ['variable', 'set', 'VITE_GLITCHTIP_DSN', '--env', env, '--body', dsns.web]);
  execFileSync('gh', ['variable', 'set', 'VITE_GLITCHTIP_DSN_ADMIN', '--env', env, '--body', dsns.admin]);
}
