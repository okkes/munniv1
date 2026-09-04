# WebKit engine guard, dockerized — same pattern as deploy/sonar/analyze.ps1:
# the tool runs in a container, nothing is installed on the host. All of iOS
# (Safari, PWA, both native webviews) renders with WebKit, whose flex sizing
# is stricter than Blink's — layout bugs invisible to jsdom (no layout) and
# to the chromium gallery run live here (sheets collapsed to their header on
# iOS, 2026-07-26). The official Playwright image ships every browser; the
# app is a production build served by the container itself, so no dev server
# and no host networking are involved.
#
# Usage: ./deploy/webkit-e2e.ps1   (docker + a prior `npm ci` are the only needs)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$web = Join-Path $root 'apps\web'

Write-Host '-- building the web app (host toolchain, as always)'
Push-Location $web
try {
    npm run build | Select-Object -Last 3
    if ($LASTEXITCODE -ne 0) { throw 'vite build failed' }
}
finally { Pop-Location }

# image tag pinned to the installed @playwright/test (hoisted to the root
# node_modules by npm workspaces — let node resolve it) so browser builds in
# the image match the runner exactly
Push-Location $web
try { $ver = node -p "require('@playwright/test/package.json').version" }
finally { Pop-Location }
if ($LASTEXITCODE -ne 0 -or -not $ver) { throw 'could not resolve @playwright/test version' }
$img = "mcr.microsoft.com/playwright:v$ver-noble"

Write-Host "-- running the webkit project in $img"
docker run --rm -v "${root}:/work" -w /work/apps/web `
    -e PW_WEBKIT=1 -e PW_BASE_URL='http://localhost:4173' `
    $img sh -c 'python3 -m http.server 4173 -d dist >/dev/null 2>&1 & npx playwright test --project=webkit'
exit $LASTEXITCODE
