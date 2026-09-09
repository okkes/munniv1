import { execFileSync } from 'node:child_process';
import { randomBytes, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'secrets.manifest.json'), 'utf8'),
);

const b64url = (buf) => buf.toString('base64url');

/** RFC 8292 VAPID pair: raw P-256 public point (65B) + private scalar, base64url */
export function vapidPair() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ]);
  return { publicKey: b64url(pub), privateKey: jwk.d };
}

function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input });
}

export function generateValue(name) {
  if (name === 'NAS_PUSH_VAPID_PUBLIC_KEY' || name === 'NAS_PUSH_VAPID_PRIVATE_KEY') {
    throw new Error('VAPID keys are generated as a pair — handled by ensureSecrets');
  }
  return b64url(randomBytes(32));
}

/** environments are created implicitly on first use */
export function ensureEnvironment(env) {
  gh(['api', '-X', 'PUT', `repos/{owner}/{repo}/environments/${encodeURIComponent(env)}`]);
}

/** secret names already present in a GitHub Environment */
export function existingEnvSecrets(env) {
  const out = gh(['api', `repos/{owner}/{repo}/environments/${encodeURIComponent(env)}/secrets`, '--paginate', '-q', '.secrets[].name']);
  return new Set(out.split(/\s+/).filter(Boolean));
}

/** repository-level secret names — where scope:"global" operator roots live */
export function existingRepoSecrets() {
  const out = gh(['api', 'repos/{owner}/{repo}/actions/secrets', '--paginate', '-q', '.secrets[].name']);
  return new Set(out.split(/\s+/).filter(Boolean));
}

export function setEnvSecret(env, name, value) {
  gh(['secret', 'set', name, '--env', env, '--body', value]);
}

/**
 * First-run + drift repair: mint every generated secret missing from the
 * stack's environment; report which operator secrets are still absent.
 * `rotate` re-mints the named generated secrets even when present.
 */
export function ensureSecrets(stack, { rotate = [] } = {}) {
  const env = stack.githubEnvironment;
  ensureEnvironment(env);
  const present = existingEnvSecrets(env);
  // scope:"global" operator roots may live at REPO level (the wizard and
  // README A1 store them there, shared by every stack) — count those too
  const repoLevel = existingRepoSecrets();
  const minted = [];
  const missingOperator = [];

  const vapidNeeded =
    rotate.includes('NAS_PUSH_VAPID_PUBLIC_KEY') ||
    !present.has('NAS_PUSH_VAPID_PUBLIC_KEY') ||
    !present.has('NAS_PUSH_VAPID_PRIVATE_KEY');
  if (vapidNeeded) {
    const pair = vapidPair();
    setEnvSecret(env, 'NAS_PUSH_VAPID_PUBLIC_KEY', pair.publicKey);
    setEnvSecret(env, 'NAS_PUSH_VAPID_PRIVATE_KEY', pair.privateKey);
    minted.push('NAS_PUSH_VAPID_PUBLIC_KEY', 'NAS_PUSH_VAPID_PRIVATE_KEY');
  }

  for (const entry of MANIFEST.secrets) {
    if (entry.name.startsWith('NAS_PUSH_VAPID_')) continue;
    const anywhere = present.has(entry.name) || (entry.scope === 'global' && repoLevel.has(entry.name));
    const needed = rotate.includes(entry.name) || !anywhere;
    if (!needed) continue;
    if (entry.owner === 'generated') {
      setEnvSecret(env, entry.name, generateValue(entry.name));
      minted.push(entry.name);
    } else if (entry.owner === 'operator' && !entry.optional) {
      missingOperator.push(entry.name);
    }
    // owner === 'module': written back later (logto module) — never minted
  }
  return { minted, missingOperator };
}

/** manifest-vs-reality check used by --verify (no writes) */
export function verifySecrets(stack) {
  const present = existingEnvSecrets(stack.githubEnvironment);
  const repoLevel = existingRepoSecrets();
  const satisfied = (s) => present.has(s.name) || (s.scope === 'global' && repoLevel.has(s.name));
  // module-owned secrets arrive when their module runs — absence is a
  // pending step, not manifest drift
  const missing = MANIFEST.secrets.filter((s) => !s.optional && s.owner !== 'module' && !satisfied(s)).map((s) => s.name);
  const unmanaged = [...present].filter((name) => !MANIFEST.secrets.some((s) => s.name === name));
  return { missing, unmanaged };
}

export { MANIFEST };
