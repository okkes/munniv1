// One-shot port of the legacy TRANSLATIONS dictionary into typed TS modules.
// Usage: node scripts/port-i18n.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const legacyFile = path.resolve(here, '../../legacy/src/shared/i18n.jsx');
const outDir = path.resolve(here, '../src/i18n');

const src = readFileSync(legacyFile, 'utf8');
const start = src.indexOf('export const TRANSLATIONS = {');
if (start === -1) throw new Error('TRANSLATIONS not found');
const objStart = src.indexOf('{', start);
// walk braces to find the matching close, ignoring braces inside string literals
let depth = 0, i = objStart, inStr = null;
for (; i < src.length; i++) {
  const ch = src[i];
  if (inStr) {
    if (ch === '\\') i++;
    else if (ch === inStr) inStr = null;
    continue;
  }
  if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
  if (ch === '{') depth++;
  if (ch === '}') { depth--; if (depth === 0) break; }
}
const objLiteral = src.slice(objStart, i + 1);
const TRANSLATIONS = new Function(`return (${objLiteral});`)();

const langs = Object.keys(TRANSLATIONS);
console.log('languages:', langs.join(', '));
const enKeys = Object.keys(TRANSLATIONS.en);
for (const lang of langs) {
  const keys = Object.keys(TRANSLATIONS[lang]);
  const missing = enKeys.filter((k) => !(k in TRANSLATIONS[lang]));
  console.log(`${lang}: ${keys.length} keys${missing.length ? `, missing vs en: ${missing.length}` : ''}`);
  if (missing.length && missing.length < 40) console.log('  ', missing.join(', '));
}

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
const render = (dict) =>
  Object.entries(dict)
    .map(([k, v]) => `  '${esc(k)}': '${esc(String(v))}',`)
    .join('\n');

mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, 'en.ts'),
  `// Ported from apps/legacy/src/shared/i18n.jsx — source of truth for translation keys.\nexport const en = {\n${render(TRANSLATIONS.en)}\n} as const;\n\nexport type TranslationKey = keyof typeof en;\n`,
);
for (const lang of langs.filter((l) => l !== 'en')) {
  writeFileSync(
    path.join(outDir, `${lang}.ts`),
    `// Ported from apps/legacy/src/shared/i18n.jsx\nimport type { TranslationKey } from './en';\n\nexport const ${lang}: Partial<Record<TranslationKey, string>> = {\n${render(TRANSLATIONS[lang])}\n};\n`,
  );
}
console.log('written to', outDir);
