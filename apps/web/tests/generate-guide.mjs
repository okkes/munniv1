/**
 * Generates the in-app user guide (public/guide/) from the curated
 * sections in tests/guide/content.mjs + the committed gallery
 * screenshots. Ships with the PWA at /guide/.
 * Run: npm run guide   (from apps/web)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GUIDE } from './guide/content.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = path.join(__dirname, 'screenshots');
const OUT_DIR = path.join(__dirname, '..', 'public', 'guide');
const OUT_SHOTS = path.join(OUT_DIR, 'shots');

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_SHOTS, { recursive: true });

/** best committed variant for a scene: the plain shot, else the first sub-shot */
function resolveShot(scene) {
  const all = fs.readdirSync(SHOTS_DIR).filter((f) => f.startsWith(`${scene}--`));
  if (all.length === 0) return null;
  const plain = all.find((f) => /--en-light-mobile\.png$/.test(f));
  return plain ?? all.sort((a, b) => a.localeCompare(b))[0];
}

const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const sections = GUIDE.map((section) => {
  const figures = section.shots
    .map((scene) => {
      const file = resolveShot(scene);
      if (!file) {
        console.warn(`guide: no screenshot for ${scene}`);
        return '';
      }
      fs.copyFileSync(path.join(SHOTS_DIR, file), path.join(OUT_SHOTS, file));
      return `<figure><img src="shots/${file}" alt="${esc(section.title)}" loading="lazy"></figure>`;
    })
    .join('\n');
  const tips = (section.tips ?? []).map((tip) => `<li>${esc(tip)}</li>`).join('\n');
  return `
  <section id="${section.id}">
    <h2>${esc(section.title)}</h2>
    <p>${esc(section.body)}</p>
    ${tips ? `<ul class="tips">${tips}</ul>` : ''}
    <div class="shots">${figures}</div>
  </section>`;
}).join('\n');

const toc = GUIDE.map((s) => `<a href="#${s.id}">${esc(s.title)}</a>`).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>munni — user guide</title>
<style>
  :root { --bg:#faf7f0; --ink:#1d1d1b; --ink2:#5f5c55; --line:#e6e1d5; --accent:#08372B; --card:#fff; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#191714; --ink:#efece4; --ink2:#a8a49a; --line:#33302a; --accent:#7fbfab; --card:#211f1b; }
  }
  * { box-sizing: border-box; margin: 0; }
  body { background: var(--bg); color: var(--ink); font: 15px/1.65 system-ui, sans-serif; }
  main { max-width: 880px; margin: 0 auto; padding: 32px 20px 80px; }
  h1 { font-size: 28px; letter-spacing: -.02em; }
  .sub { color: var(--ink2); margin: 4px 0 20px; }
  nav { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 28px; }
  nav a { color: var(--accent); text-decoration: none; font-size: 13px; font-weight: 600;
          border: 1px solid var(--line); border-radius: 999px; padding: 5px 12px; background: var(--card); }
  section { margin-bottom: 44px; }
  h2 { font-size: 20px; margin-bottom: 8px; }
  p { color: var(--ink2); max-width: 62ch; }
  .tips { margin: 10px 0 0 0; padding: 12px 16px 12px 32px; background: var(--card);
          border: 1px solid var(--line); border-radius: 12px; color: var(--ink2); font-size: 13.5px; }
  .shots { display: flex; gap: 12px; overflow-x: auto; padding: 14px 2px 6px; }
  figure { flex: 0 0 auto; }
  .shots img { width: 220px; border-radius: 14px; border: 1px solid var(--line); display: block; }
  footer { color: var(--ink2); font-size: 12px; border-top: 1px solid var(--line); padding-top: 14px; }
  a.back { color: var(--accent); }
</style>
</head>
<body>
<main>
  <h1>munni — user guide</h1>
  <p class="sub">How to use the app, screen by screen. <a class="back" href="../">← back to the app</a></p>
  <nav>${toc}</nav>
  ${sections}
  <footer>Generated ${new Date().toISOString().slice(0, 10)} from the app's own test screenshots — always the current UI.</footer>
</main>
</body>
</html>`;

fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html);
console.log(`guide: ${GUIDE.length} sections → public/guide/ (${fs.readdirSync(OUT_SHOTS).length} screenshots)`);
