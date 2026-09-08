// One-shot port of the legacy country list + currency map to TS.
// Usage: node scripts/port-countries.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { COUNTRIES } = await import(pathToFileURL(path.resolve(here, '../../legacy/src/shared/data/countries.js')));

// constants.js imports JSX — extract the object literal textually
const constantsSrc = readFileSync(path.resolve(here, '../../legacy/src/shared/constants.js'), 'utf8');
const start = constantsSrc.indexOf('COUNTRY_CURRENCY = {');
const end = constantsSrc.indexOf('};', start);
const COUNTRY_CURRENCY = new Function(`return ${constantsSrc.slice(start + 'COUNTRY_CURRENCY = '.length, end + 1)};`)();

const out = path.resolve(here, '../src/domain/countries.ts');
writeFileSync(
  out,
  `// GENERATED from apps/legacy shared data by scripts/port-countries.mjs.
export interface Country {
  code: string;
  en: string;
  nl: string;
  tr: string;
  native: string;
}

export const COUNTRIES: Country[] = [
${COUNTRIES.map((c) => `  ${JSON.stringify(c)},`).join('\n')}
];

export const COUNTRY_CURRENCY: Record<string, string> = ${JSON.stringify(COUNTRY_CURRENCY)};

export const currencyForCountry = (code: string): string => COUNTRY_CURRENCY[code] ?? 'EUR';
`,
);
console.log(`countries: ${COUNTRIES.length}, currencies: ${Object.keys(COUNTRY_CURRENCY).length}`);
