import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const STACKS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'stacks');
// MUNNI_RENDER_DIR: same test override render/localstore honor
const RENDER_DIR = () => process.env.MUNNI_RENDER_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'rendered');

/**
 * LAN MODE (native-apps ruling 2026-08-28): when infra/rendered/lan-host
 * holds an address (the machine's 192.168.x.y, written by the wizard),
 * every LOCAL stack derives its urls from it instead of localhost — so a
 * phone on the same network reaches web/api/logto, and CI-built native
 * apps can bake these origins. A plain file (not the secret stores)
 * because localstore imports THIS module — a store read here would cycle.
 * Deleting the file + re-running bootstrap flips everything back.
 */
export function lanHost() {
  const file = join(RENDER_DIR(), 'lan-host');
  if (!existsSync(file)) return null;
  const host = readFileSync(file, 'utf8').trim();
  return /^[0-9a-zA-Z.-]+$/.test(host) ? host : null;
}

/** strip // and /* *​/ comments (naive but our files avoid urls-in-strings pitfalls via lookbehind on ':') */
function stripJsonc(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.search(/(?<!:)\/\/(?![^"]*"(?:[^"]*"[^"]*")*[^"]*$)/);
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');
}

/**
 * DYNAMIC local environments (user ruling 2026-08-28: "+" creates any
 * number of them): infra/rendered/local-envs.json lists
 * {name (2-5 lowercase letters), channel (dev|latest), slot}. Ports come
 * from the SLOT (stable across deletions): web 8380+100·slot, admin
 * 8381+…, api 8382+…, logto 3201+100·slot, logtoAdmin 3202+…. The
 * default registry reproduces the original prod (slot 0) + dev (slot 1)
 * family byte-for-byte, so existing machines migrate without a restart.
 */
const ENV_REGISTRY_FILE = () => join(RENDER_DIR(), 'local-envs.json');

export function localEnvRegistry() {
  const file = ENV_REGISTRY_FILE();
  // no registry = no environments (user ruling 2026-08-28: Delete
  // everything forgets prod too; Set up & start recreates it)
  if (!existsSync(file)) return [];
  const envs = JSON.parse(readFileSync(file, 'utf8')).envs ?? [];
  return envs.filter((e) => /^[a-z]{2,5}$/.test(e.name) && Number.isInteger(e.slot));
}

export function saveLocalEnvRegistry(envs) {
  writeFileSync(ENV_REGISTRY_FILE(), `${JSON.stringify({ envs }, null, 2)}\n`);
}

function synthesizeLocalEnv(entry) {
  const s = entry.slot;
  return {
    stack: `munni-local-${entry.name}`,
    pair: `munni-local-${entry.name}`,
    role: 'prod', // self-paired: every env owns its logto
    channel: entry.channel,
    target: 'local',
    sharedStack: 'munni-local-shared',
    appChannel: entry.name === 'prod' ? 'production' : 'staging',
    domain: 'localhost',
    ports: { web: 8380 + 100 * s, admin: 8381 + 100 * s, api: 8382 + 100 * s, logto: 3201 + 100 * s, logtoAdmin: 3202 + 100 * s },
    registry: 'ghcr.io/okkes',
    native: {
      // one store identity PER environment (user ruling 2026-08-28),
      // installable side by side. The SUFFIX is the operator's choice
      // (user ruling 2026-08-31: no black-box numbering) — default is
      // the environment name; a burned package (Play pins the first
      // upload key per package forever) rolls to whatever they type.
      // appGen is the legacy pre-suffix form, kept readable.
      appId: `app.munni.local.${entry.appSuffix ?? `${entry.name}${(entry.appGen ?? 1) > 1 ? entry.appGen : ''}`}`,
      label: `munni ${entry.name}`,
      scheme: entry.name === 'prod' ? 'munni-local' : `munni-local-${entry.name}`,
    },
    features: { telemetry: true },
    envName: entry.name,
    slot: s,
  };
}

export function listStacks() {
  const fileStacks = readdirSync(STACKS_DIR)
    .filter((f) => f.endsWith('.jsonc'))
    .map((f) => f.replace(/\.jsonc$/, ''));
  const envStacks = localEnvRegistry().map((e) => `munni-local-${e.name}`);
  return [...fileStacks, ...envStacks.filter((n) => !fileStacks.includes(n))];
}

/** load a stack file (or synthesize a registry env) and derive the
 * values every module needs */
export function loadStack(name) {
  const file = join(STACKS_DIR, `${name}.jsonc`);
  let cfg;
  if (existsSync(file)) {
    cfg = JSON.parse(stripJsonc(readFileSync(file, 'utf8')));
  } else {
    const entry = localEnvRegistry().find((e) => `munni-local-${e.name}` === name);
    if (!entry) throw new Error(`unknown stack "${name}" — no stack file and no local-envs.json entry`);
    cfg = synthesizeLocalEnv(entry);
  }
  // the NAS domain is treated as a SECRET (public repo): stack files
  // carry a placeholder, the environment provides the value
  if (cfg.domain === '${IAC_DOMAIN}') {
    if (!process.env.IAC_DOMAIN) throw new Error('IAC_DOMAIN is not set — export it (locally) or add the repo secret (CI)');
    cfg.domain = process.env.IAC_DOMAIN;
  }
  if (cfg.stack !== name) throw new Error(`stack file ${file} declares "${cfg.stack}" — must match its filename`);
  // target "local": localhost plain-http by default; in LAN MODE the
  // whole family moves onto REAL https hostnames —
  // <service>.<ip-dashed>.sslip.io (wildcard DNS to the LAN address,
  // user ruling 2026-08-28) behind one family Caddy with a local CA, so
  // browsers get no mixed content and Enable Banking gets a registrable
  // https redirect. The localhost http ports stay published as twins.
  // The VAULT is https in BOTH modes (the Bitwarden web client refuses
  // plain http outright).
  const local = cfg.target === 'local';
  const lan = local ? lanHost() : null;
  const sslipBase = lan ? `${lan.replaceAll('.', '-')}.sslip.io` : null;
  const envPart = cfg.envName ? `munni-${cfg.envName}` : null;
  const sslipHost = (key) => {
    if (envPart) {
      const suffix = { web: '', admin: '-admin', api: '-api', logto: '-logto', logtoAdmin: '-logto-admin' }[key] ?? `-${key}`;
      return `${envPart}${suffix}.${sslipBase}`;
    }
    return `${key === 'logtoAdmin' ? 'logto-admin' : key}.${sslipBase}`;
  };
  const host = (key) => {
    if (!local) return `${cfg.hosts[key]}.${cfg.domain}`;
    return sslipBase ? sslipHost(key) : 'localhost';
  };
  const url = (key) => {
    if (!local) return `https://${host(key)}`;
    if (sslipBase) return `https://${sslipHost(key)}`;
    if (key === 'vault') return `https://localhost:${cfg.ports[key]}`;
    return `http://localhost:${cfg.ports[key]}`;
  };
  // a stack only gets urls for services it actually addresses (a shared
  // stack has no web/api; an env stack pointing at a shared stack has no
  // glitchtip of its own) — locally that is "port defined", hosted
  // "host defined"
  const keys = ['web', 'api', 'admin', 'logto', 'logtoAdmin', 'glitchtip', 'vault', 'control', 'pgadmin'];
  const urls = Object.fromEntries(
    keys.filter((k) => (local ? cfg.ports?.[k] !== undefined : cfg.hosts?.[k] !== undefined)).map((k) => [k, url(k)]),
  );
  return { ...cfg, file, urls, host };
}

/** the prod twin of a stack's pair (where the pair's services live);
 * self for prod twins and for role:"shared" stacks */
export function pairProd(stack) {
  if (stack.role === 'prod' || stack.role === 'shared') return stack;
  const sibling = listStacks()
    .map((name) => loadStack(name))
    .find((s) => s.pair === stack.pair && s.role === 'prod');
  if (!sibling) throw new Error(`no prod twin found for pair "${stack.pair}"`);
  return sibling;
}

/** where a stack's cross-environment services (glitchtip, vault, ocr,
 * postgres) live: its declared sharedStack when the topology is split
 * (local three-stack), else the pair's prod twin (iac pairs) */
export function sharedOf(stack) {
  return stack.sharedStack ? loadStack(stack.sharedStack) : pairProd(stack);
}
