// Regenerates src/generated/bundledCatalog.json from the web app's
// bundled category + keyword data, so the admin catalog editor can show
// what the baseline contains (admin shares no runtime code with the
// member app — this build-time copy keeps that boundary).
//   node scripts/gen-bundled-catalog.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// both files carry one JSON object per line — extract them verbatim
const rows = (source) =>
  [...source.matchAll(/^\s*(\{".*\}),?\s*$/gm)].map((m) => JSON.parse(m[1]));

const categories = rows(read('../../web/src/domain/categories.ts'));
const keywords = rows(read('../../web/src/domain/keyword-categories.ts'));

mkdirSync(new URL('../src/generated', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../src/generated/bundledCatalog.json', import.meta.url),
  JSON.stringify({ categories, keywords }, null, 1),
);
console.log(`${categories.length} categories, ${keywords.length} keyword rules`);
