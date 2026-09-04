/**
 * Generates tests/gallery/failures.html from failed-test screenshots + error info.
 * Scans tests/results/ for test-failed-1.png + error-context.md pairs.
 * Run: node tests/generate-failures.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, 'results');
const GALLERY_DIR = path.join(__dirname, 'gallery');

const DEPLOY = process.argv.includes('--deploy');
const BASE   = DEPLOY ? '.' : '..';

// ---------------------------------------------------------------------------
// Parse error-context.md into { specFile, testName, location, error, snapshot }
// ---------------------------------------------------------------------------
function parseErrorContext(mdPath) {
  if (!fs.existsSync(mdPath)) return null;
  const text = fs.readFileSync(mdPath, 'utf8');

  // Extract test name + location
  const nameMatch  = text.match(/- Name:\s*(.+)/);
  const locMatch   = text.match(/- Location:\s*(.+)/);

  // Extract error block (between ```  after # Error details and next ```)
  const errBlock = text.match(/# Error details[\s\S]*?```\n([\s\S]*?)```/);

  // Spec file is the part before " >> "
  let specFile = '', testName = '';
  if (nameMatch) {
    const parts = nameMatch[1].split(' >> ');
    specFile = parts[0]?.trim() || '';
    testName = parts[1]?.trim() || nameMatch[1].trim();
  }

  return {
    specFile,
    testName,
    location: locMatch ? locMatch[1].trim() : '',
    error: errBlock ? errBlock[1].trim() : 'Unknown error',
  };
}

// ---------------------------------------------------------------------------
// Scan results dir
// ---------------------------------------------------------------------------
if (!fs.existsSync(RESULTS_DIR)) {
  console.log('No tests/results directory found — run tests first.');
  process.exit(0);
}

const dirs = fs.readdirSync(RESULTS_DIR)
  .filter(d => {
    if (!fs.statSync(path.join(RESULTS_DIR, d)).isDirectory()) return false;
    // Skip retry sub-dirs — we show the original attempt; retries have the same error
    if (/--retry\d+$/.test(d)) return false;
    return true;
  });

const failures = [];

for (const dir of dirs) {
  const contextPath = path.join(RESULTS_DIR, dir, 'error-context.md');
  // error-context.md is the definitive indicator of failure (screenshots may not exist
  // when the page never loaded, e.g. page.goto timeout)
  if (!fs.existsSync(contextPath)) continue;

  const shotPath = path.join(RESULTS_DIR, dir, 'test-failed-1.png');
  const shotExists = fs.existsSync(shotPath);

  const ctx = parseErrorContext(contextPath);
  failures.push({
    dir,
    shotSrc: shotExists ? `${BASE}/results/${dir}/test-failed-1.png` : null,
    specFile:  ctx?.specFile  || dir,
    testName:  ctx?.testName  || dir,
    location:  ctx?.location  || '',
    error:     ctx?.error     || 'No error context found',
  });
}

// Group by spec file
const bySpec = {};
for (const f of failures) {
  (bySpec[f.specFile] = bySpec[f.specFile] || []).push(f);
}

const specCount = Object.keys(bySpec).length;
const totalCount = failures.length;

// ---------------------------------------------------------------------------
// Card HTML
// ---------------------------------------------------------------------------
function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function failureCard(f) {
  // Shorten error to first meaningful line (skip "Error: " prefix variants)
  const firstLine = f.error.split('\n')[0].replace(/^Error:\s*/i, '').trim();
  const errorLines = f.error.split('\n').slice(0, 8).join('\n');

  const mediaBlock = f.shotSrc
    ? `<a href="${f.shotSrc}" target="_blank" class="img-link">
         <img src="${f.shotSrc}" loading="lazy" style="width:100%;display:block;border-radius:8px 8px 0 0"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
         <div class="placeholder" style="display:none">screenshot missing</div>
       </a>`
    : `<div class="placeholder no-shot">page never loaded — no screenshot</div>`;

  return `
    <div class="card">
      ${mediaBlock}
      <div class="card-body">
        <div class="test-name">${escHtml(f.testName)}</div>
        <div class="error-msg">${escHtml(firstLine)}</div>
        <details class="err-details">
          <summary>Full error</summary>
          <pre class="err-pre">${escHtml(errorLines)}</pre>
        </details>
        <div class="card-loc">${escHtml(f.location)}</div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------
const specSections = Object.entries(bySpec).map(([spec, items]) => `
  <section class="spec-section">
    <h2 class="spec-heading">${escHtml(spec)} <span class="spec-count">${items.length} failed</span></h2>
    <div class="cards-grid">
      ${items.map(failureCard).join('\n')}
    </div>
  </section>`).join('\n');

if (!fs.existsSync(GALLERY_DIR)) fs.mkdirSync(GALLERY_DIR, { recursive: true });

const emptyMsg = totalCount === 0
  ? `<div class="empty">No failures found in tests/results/ — all tests passed!</div>`
  : '';

const html = `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>munni — Failed Tests</title>
  <style>
    :root {
      --bg: #fff1f2; --bg1: #fff1f2; --card-bg: #ffffff; --border: #fecdd3; --border2: #fda4af;
      --ink: #0f172a; --ink2: #334155; --ink3: #64748b; --ink4: #475569;
      --heading-bg: #fff1f2; --spec-border: #ef4444; --err-bg: #fef2f2; --err-border: #fca5a5;
      --err-ink: #991b1b; --toggle-bg: #fce7e9; --ph-bg: #fce7e9;
    }
    [data-theme="dark"] {
      --bg: #110809; --bg1: #1a0b0c; --card-bg: #1c0a0b; --border: #450a0a; --border2: #7f1d1d;
      --ink: #fef2f2; --ink2: #fca5a5; --ink3: #f87171; --ink4: #dc2626;
      --heading-bg: #1c0a0b; --spec-border: #dc2626; --err-bg: #1c0a0b; --err-border: #7f1d1d;
      --err-ink: #fca5a5; --toggle-bg: #450a0a; --ph-bg: #450a0a;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--ink); font-family: -apple-system, system-ui, sans-serif; padding: 32px 24px 80px; }

    .site-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
    .site-title { font-size: 24px; font-weight: 800; }
    .site-meta { font-size: 12px; color: var(--ink4); margin-bottom: 24px; }
    .badge-fail { display: inline-block; background: #ef4444; color: #fff; font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 4px; margin-left: 8px; }
    .badge-ok   { display: inline-block; background: #22c55e; color: #fff; font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 4px; margin-left: 8px; }
    a.nav-link { font-size: 12px; color: var(--ink3); text-decoration: none; }
    a.nav-link:hover { text-decoration: underline; }
    .theme-toggle { padding: 5px 14px; border-radius: 20px; border: 1.5px solid var(--border); background: var(--toggle-bg); color: var(--ink3); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; white-space: nowrap; }
    .theme-toggle:hover { border-color: var(--border2); }

    .spec-section { margin-bottom: 48px; }
    .spec-heading { font-size: 15px; font-weight: 700; color: var(--ink); margin-bottom: 16px; padding: 10px 16px; background: var(--heading-bg); border-left: 3px solid var(--spec-border); border-radius: 0 8px 8px 0; display: flex; align-items: center; gap: 8px; }
    .spec-count { font-size: 11px; font-weight: 700; color: #ef4444; background: #fee2e2; padding: 2px 8px; border-radius: 20px; margin-left: auto; }

    .cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }

    .card { background: var(--card-bg); border: 1.5px solid var(--border); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }
    .img-link img { transition: opacity .15s; }
    .img-link:hover img { opacity: .88; }
    .placeholder { aspect-ratio: 393 / 852; background: var(--ph-bg); display: flex; align-items: center; justify-content: center; color: var(--ink4); font-size: 11px; font-family: monospace; text-align: center; padding: 16px; }
    .no-shot { aspect-ratio: 3 / 1; color: #dc2626; font-size: 10px; background: var(--err-bg); border-bottom: 1px solid var(--err-border); }

    .card-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
    .test-name { font-size: 12px; font-weight: 700; color: var(--ink); line-height: 1.45; }
    .error-msg { font-size: 11px; color: #dc2626; font-family: monospace; line-height: 1.4; word-break: break-word; background: var(--err-bg); border: 1px solid var(--err-border); border-radius: 6px; padding: 6px 8px; }
    .err-details summary { font-size: 10px; color: var(--ink4); cursor: pointer; user-select: none; margin-top: 2px; }
    .err-details summary:hover { color: var(--ink2); }
    .err-pre { font-family: monospace; font-size: 9.5px; color: var(--err-ink); white-space: pre-wrap; word-break: break-word; background: var(--err-bg); border: 1px solid var(--err-border); border-radius: 6px; padding: 8px; margin-top: 4px; overflow: auto; max-height: 200px; }
    .card-loc { font-size: 9px; color: var(--ink4); font-family: monospace; }

    .empty { text-align: center; padding: 80px 24px; font-size: 18px; color: #22c55e; font-weight: 700; }

    @media (max-width: 600px) { body { padding: 16px 12px 48px; } }
  </style>
</head>
<body>
  <div class="site-header">
    <h1 class="site-title">munni
      <span style="font-size:14px;font-weight:500;color:var(--ink4)">failed tests</span>
      ${totalCount > 0
        ? `<span class="badge-fail">${totalCount} failed</span>`
        : `<span class="badge-ok">all passed</span>`}
    </h1>
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <a class="nav-link" href="index.html">← Back to gallery</a>
      <button class="theme-toggle" id="theme-toggle">🌙 Dark mode</button>
    </div>
  </div>
  <div class="site-meta">
    ${totalCount} failure${totalCount !== 1 ? 's' : ''} across ${specCount} spec file${specCount !== 1 ? 's' : ''}
    &nbsp;·&nbsp; ${new Date().toLocaleString()}
    &nbsp;·&nbsp; Screenshots taken at moment of failure
  </div>

  ${emptyMsg}
  ${specSections}

  <script>
    const root = document.documentElement;
    const toggleBtn = document.getElementById('theme-toggle');
    function applyTheme(t) {
      root.setAttribute('data-theme', t);
      localStorage.setItem('gallery-theme', t);
      if (toggleBtn) toggleBtn.textContent = t === 'dark' ? '☀️ Light mode' : '🌙 Dark mode';
    }
    applyTheme(localStorage.getItem('gallery-theme') || 'light');
    if (toggleBtn) toggleBtn.addEventListener('click', () => {
      applyTheme((root.getAttribute('data-theme') || 'light') === 'dark' ? 'light' : 'dark');
    });
  </script>
</body>
</html>`;

fs.writeFileSync(path.join(GALLERY_DIR, 'failures.html'), html, 'utf8');
console.log(`Failures → tests/gallery/failures.html  (${totalCount} failures across ${specCount} specs)`);
