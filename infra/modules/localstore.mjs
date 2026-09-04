import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST, generateValue, vapidPair } from './secrets.mjs';
import { loadStack } from './stack.mjs';

// MUNNI_RENDER_DIR: test override so specs never touch a real rendered/
const OUT_DIR = process.env.MUNNI_RENDER_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'rendered');

/**
 * Secret stores for target:"local" stacks — file-backed twins of the
 * GitHub Environments, one per stack under
 * infra/rendered/<stack>/.secrets.local.json (gitignored). In the
 * three-stack topology (plan LS1-LS3) values split by OWNERSHIP:
 * family-wide roots and the shared services' own secrets live in the
 * SHARED stack's store; per-environment values (logto apps/M2M, VAPID,
 * admin subs, DSNs) live in each env stack's store. Env reads see the
 * merged view; env writes of shared names land in the shared store.
 */
const storeFile = (stackName) => join(OUT_DIR, stackName, '.secrets.local.json');

/** names owned by the FAMILY's shared stack (everything else is per-env) */
export const SHARED_LOCAL_NAMES = new Set([
  'NAS_GHCR_PAT',
  'NAS_GOCARDLESS_SECRET_ID',
  'NAS_GOCARDLESS_SECRET_KEY',
  'NAS_ENABLEBANKING_APPLICATION_ID',
  'NAS_ENABLEBANKING_PRIVATE_KEY_PEM',
  'NAS_FCM_SERVICE_ACCOUNT_JSON',
  'NAS_LOGODEV_SECRET_KEY',
  'NAS_LOGODEV_PUBLIC_TOKEN',
  'LOGTO_GOOGLE_CLIENT_ID',
  'LOGTO_GOOGLE_CLIENT_SECRET',
  'NAS_GLITCHTIP_EMAIL_URL',
  'NAS_GLITCHTIP_SECRET_KEY',
  'NAS_PGADMIN_PASSWORD',
  'VAULT_SIGNUPS_ALLOWED',
  'VAULT_ADMIN_EMAIL',
  'VAULT_MASTER_PASSWORD',
  'IAC_GLITCHTIP_API_TOKEN',
  'GLITCHTIP_ADMIN_EMAIL',
  'GLITCHTIP_ADMIN_PASSWORD',
  'CONTROL_LOGTO_APP_ID',
  // store-publishing roots (one Play/ASC account serves every channel)
  'PLAY_SERVICE_ACCOUNT_JSON',
  'ASC_KEY_ID',
  'ASC_ISSUER_ID',
  'ASC_KEY_P8',
  'APPLE_TEAM_ID',
  // the MACHINE-owned upload keystore (Play pins the first upload key
  // forever — it must outlive every repo copy)
  'ANDROID_KEYSTORE_BASE64',
  'ANDROID_KEYSTORE_PASSWORD',
  'ANDROID_KEY_ALIAS',
  'ANDROID_KEY_PASSWORD',
]);

/** generated names the shared stack mints (env stacks never do) */
const SHARED_GENERATED = new Set(['NAS_GLITCHTIP_SECRET_KEY', 'NAS_PGADMIN_PASSWORD']);

/** minted by EVERY stack into its OWN store: each postgres server gets
 * its own password, so one environment's credentials never open another
 * environment's database (user isolation ruling 2026-08-27) */
const PER_STACK_GENERATED = new Set(['NAS_POSTGRES_PASSWORD']);

const readStore = (stackName) => {
  const file = storeFile(stackName);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
};
const writeStore = (stackName, values) => {
  const file = storeFile(stackName);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(values, null, 2)}\n`);
  return values;
};

/** one-time migration from the retired single-twin store: shared names
 * seed the shared stack's store, the rest seeds munni-local-prod (the
 * twin's successor — same ports, same consents) */
function legacySeed(stackName) {
  const legacy = readStore('munni-local');
  if (!legacy) return {};
  if (stackName === 'munni-local-prod') {
    return Object.fromEntries(Object.entries(legacy).filter(([k]) => !SHARED_LOCAL_NAMES.has(k)));
  }
  const stack = safeLoad(stackName);
  if (stack?.role === 'shared') {
    return Object.fromEntries(Object.entries(legacy).filter(([k]) => SHARED_LOCAL_NAMES.has(k)));
  }
  return {};
}
const safeLoad = (name) => {
  try { return loadStack(name); } catch { return null; }
};

/** the stack's OWN stored values (plus the one-time legacy seed) */
export function loadLocalValues(stack) {
  const own = readStore(stack.stack);
  if (own) return own;
  const seeded = legacySeed(stack.stack);
  return Object.keys(seeded).length ? writeStore(stack.stack, seeded) : {};
}

/** merged view an env stack renders with: shared values under its own */
export function familyValues(stack) {
  const own = loadLocalValues(stack);
  if (!stack.sharedStack) return own;
  const shared = readStore(stack.sharedStack) ?? legacySeedInto(stack.sharedStack);
  return { ...shared, ...own };
}
const legacySeedInto = (sharedName) => {
  const seeded = legacySeed(sharedName);
  return Object.keys(seeded).length ? writeStore(sharedName, seeded) : {};
};

/** save: shared-owned names route to the family's shared store */
export function saveLocalValues(stack, values) {
  if (!stack.sharedStack) return writeStore(stack.stack, values);
  const own = {};
  const shared = readStore(stack.sharedStack) ?? {};
  let sharedChanged = false;
  for (const [name, value] of Object.entries(values)) {
    if (SHARED_LOCAL_NAMES.has(name)) {
      if (shared[name] !== value) { shared[name] = value; sharedChanged = true; }
    } else {
      own[name] = value;
    }
  }
  if (sharedChanged) writeStore(stack.sharedStack, shared);
  return writeStore(stack.stack, own);
}

/** manifest entries that apply to a local stack (nas/ci platforms skip) */
export const localManifestEntries = () => MANIFEST.secrets.filter((s) => !['nas', 'ci'].includes(s.platform));

/** the entries a PARTICULAR local stack is responsible for */
export function stackManifestEntries(stack) {
  const entries = localManifestEntries();
  if (stack.role === 'shared') return entries.filter((e) => SHARED_LOCAL_NAMES.has(e.name) || PER_STACK_GENERATED.has(e.name));
  if (stack.sharedStack) return entries.filter((e) => !SHARED_LOCAL_NAMES.has(e.name));
  return entries;
}

function ensureVapid(values, rotate, minted) {
  const needed =
    rotate.includes('NAS_PUSH_VAPID_PUBLIC_KEY') || !values.NAS_PUSH_VAPID_PUBLIC_KEY || !values.NAS_PUSH_VAPID_PRIVATE_KEY;
  if (!needed) return;
  const pair = vapidPair();
  values.NAS_PUSH_VAPID_PUBLIC_KEY = pair.publicKey;
  values.NAS_PUSH_VAPID_PRIVATE_KEY = pair.privateKey;
  minted.push('NAS_PUSH_VAPID_PUBLIC_KEY', 'NAS_PUSH_VAPID_PRIVATE_KEY');
}

/**
 * Mint the generated secrets THIS stack owns, absorb operator values
 * offered via process.env (routed by ownership), report the required
 * operator values still absent across the merged view.
 */
export function ensureLocalSecrets(stack, { rotate = [] } = {}) {
  const values = familyValues(stack);
  const own = loadLocalValues(stack);
  const minted = [];
  const missingOperator = [];
  const isShared = stack.role === 'shared';

  const ownsGenerated = (name) =>
    PER_STACK_GENERATED.has(name) || (isShared ? SHARED_GENERATED.has(name) : !SHARED_GENERATED.has(name));
  // per-stack names must exist in THIS stack's store — the merged view
  // would satisfy the check with another stack's value
  const present = (name) => (PER_STACK_GENERATED.has(name) ? own[name] : values[name]);

  if (!isShared) ensureVapid(values, rotate, minted);

  const applyEntry = (entry) => {
    const ownedHere = isShared ? SHARED_LOCAL_NAMES.has(entry.name) : true; // env stacks absorb env names; shared names route on save
    if (entry.owner === 'operator' && ownedHere && process.env[entry.name]) values[entry.name] = process.env[entry.name];
    const needed = rotate.includes(entry.name) || !present(entry.name);
    if (!needed) return;
    if (entry.owner === 'generated' && ownsGenerated(entry.name)) {
      values[entry.name] = generateValue(entry.name);
      minted.push(entry.name);
    } else if (entry.owner === 'operator' && !entry.optional && stackManifestEntries(stack).some((e) => e.name === entry.name)) {
      missingOperator.push(entry.name);
    }
  };
  for (const entry of localManifestEntries()) {
    if (!entry.name.startsWith('NAS_PUSH_VAPID_')) applyEntry(entry);
  }
  saveLocalValues(stack, values);
  return { values: familyValues(stack), minted, missingOperator };
}
