import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const STACKS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'stacks');

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

export function listStacks() {
  return readdirSync(STACKS_DIR)
    .filter((f) => f.endsWith('.jsonc'))
    .map((f) => f.replace(/\.jsonc$/, ''));
}

/** load a stack file and derive the values every module needs */
export function loadStack(name) {
  const file = join(STACKS_DIR, `${name}.jsonc`);
  const cfg = JSON.parse(stripJsonc(readFileSync(file, 'utf8')));
  // the NAS domain is treated as a SECRET (public repo): stack files
  // carry a placeholder, the environment provides the value
  if (cfg.domain === '${IAC_DOMAIN}') {
    if (!process.env.IAC_DOMAIN) throw new Error('IAC_DOMAIN is not set — export it (locally) or add the repo secret (CI)');
    cfg.domain = process.env.IAC_DOMAIN;
  }
  if (cfg.stack !== name) throw new Error(`stack file ${file} declares "${cfg.stack}" — must match its filename`);
  const host = (key) => `${cfg.hosts[key]}.${cfg.domain}`;
  const url = (key) => `https://${host(key)}`;
  return {
    ...cfg,
    file,
    urls: {
      web: url('web'),
      api: url('api'),
      admin: url('admin'),
      logto: url('logto'),
      logtoAdmin: url('logtoAdmin'),
      glitchtip: url('glitchtip'),
    },
    host,
  };
}

/** the prod twin of a stack's pair (where the shared services live) */
export function pairProd(stack) {
  if (stack.role === 'prod') return stack;
  const sibling = listStacks()
    .map((name) => loadStack(name))
    .find((s) => s.pair === stack.pair && s.role === 'prod');
  if (!sibling) throw new Error(`no prod twin found for pair "${stack.pair}"`);
  return sibling;
}
