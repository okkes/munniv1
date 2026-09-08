// Regenerates src/generated/mdiNames.ts from the self-hosted @mdi/font
// css — run after bumping @mdi/font: node scripts/gen-mdi-index.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const css = readFileSync(require.resolve('@mdi/font/css/materialdesignicons.css'), 'utf8');
const names = [...new Set([...css.matchAll(/\.mdi-([a-z0-9-]+)::?before/g)].map((m) => m[1]))].sort((a, b) =>
  a.localeCompare(b),
);
writeFileSync(
  new URL('../src/generated/mdiNames.ts', import.meta.url),
  '// GENERATED from @mdi/font css (scripts/gen-mdi-index.mjs) — do not edit.\n' +
    '// Every glyph the self-hosted webfont renders — offline icon search.\n' +
    `export const MDI_NAMES: readonly string[] = ${JSON.stringify(names)};\n`,
);
console.log(`${names.length} icons`);
