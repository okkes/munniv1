# Runs a local SonarQube analysis of the web app (and the API when the
# .NET sonarscanner + Java are available). One-time setup is described in
# deploy/docker-compose.sonar.yml.
#
#   ./deploy/sonar/analyze.ps1
#
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$hostUrl = 'http://localhost:9000'

# token from deploy/env/.env.local (SONAR_TOKEN=...) or the environment
$token = $env:SONAR_TOKEN
$envFile = Join-Path $repo 'deploy\env\.env.local'
if (-not $token -and (Test-Path $envFile)) {
    $line = Get-Content $envFile | Where-Object { $_ -match '^SONAR_TOKEN=' } | Select-Object -First 1
    if ($line) { $token = $line.Substring('SONAR_TOKEN='.Length).Trim() }
}
if (-not $token) {
    Write-Error "No SONAR_TOKEN found. Generate one at $hostUrl (My Account / Security) and add SONAR_TOKEN=<token> to deploy/env/.env.local"
}

try { Invoke-RestMethod "$hostUrl/api/system/status" | Out-Null } catch {
    Write-Error "SonarQube is not reachable at $hostUrl. Start it with: docker compose -f deploy/docker-compose.sonar.yml up -d"
}

# --- web: coverage + scanner CLI (dockerized, nothing to install) ---
Write-Host "==> vitest coverage (apps/web)" -ForegroundColor Cyan
Push-Location (Join-Path $repo 'apps\web')
try {
    # cmd /c merges the tools' stderr progress output so PS 5.1 does not
    # promote it to a terminating error under redirection
    cmd /c "npx vitest run --coverage --coverage.reporter=lcov 2>&1"
    if ($LASTEXITCODE -ne 0) { Write-Error 'vitest failed - fix tests before analyzing' }

    Write-Host "==> sonar-scanner (munni-web)" -ForegroundColor Cyan
    cmd /c "docker run --rm -e SONAR_HOST_URL=http://host.docker.internal:9000 -e SONAR_TOKEN=$token -v `"$PWD`:/usr/src`" sonarsource/sonar-scanner-cli 2>&1"
    if ($LASTEXITCODE -ne 0) { Write-Error 'web analysis failed' }
} finally { Pop-Location }

# --- admin: same scanner CLI, tiny project -------------------------------
Write-Host "==> vitest coverage (apps/admin)" -ForegroundColor Cyan
Push-Location (Join-Path $repo 'apps\admin')
try {
    cmd /c "npx vitest run --coverage --coverage.reporter=lcov 2>&1"
    if ($LASTEXITCODE -ne 0) { Write-Error 'admin vitest failed - fix tests before analyzing' }

    Write-Host "==> sonar-scanner (munni-admin)" -ForegroundColor Cyan
    cmd /c "docker run --rm -e SONAR_HOST_URL=http://host.docker.internal:9000 -e SONAR_TOKEN=$token -v `"$PWD`:/usr/src`" sonarsource/sonar-scanner-cli 2>&1"
    if ($LASTEXITCODE -ne 0) { Write-Error 'admin analysis failed' }
} finally { Pop-Location }

# --- control: the shared-services cockpit, same regime as admin ----------
Write-Host "==> vitest coverage (apps/control)" -ForegroundColor Cyan
Push-Location (Join-Path $repo 'apps\control')
try {
    cmd /c "npx vitest run --coverage --coverage.reporter=lcov 2>&1"
    if ($LASTEXITCODE -ne 0) { Write-Error 'control vitest failed - fix tests before analyzing' }

    Write-Host "==> sonar-scanner (munni-control)" -ForegroundColor Cyan
    cmd /c "docker run --rm -e SONAR_HOST_URL=http://host.docker.internal:9000 -e SONAR_TOKEN=$token -v `"$PWD`:/usr/src`" sonarsource/sonar-scanner-cli 2>&1"
    if ($LASTEXITCODE -ne 0) { Write-Error 'control analysis failed' }
} finally { Pop-Location }

# --- api: SonarScanner for .NET, dockerized (nothing to install) ---
# coverage runs on the HOST (Testcontainers/Docker are unavailable inside
# the scanner container); the opencover report's absolute Windows paths
# are rewritten to the container mount so Sonar can match the files
Write-Host "==> dotnet test coverage (server, host)" -ForegroundColor Cyan
$testResults = Join-Path $repo 'server\tests\Munni.Api.Tests\TestResults'
if (Test-Path $testResults) { Remove-Item $testResults -Recurse -Force }
Push-Location (Join-Path $repo 'server')
try {
    cmd /c "dotnet test Munni.slnx --nologo -v q --collect:`"XPlat Code Coverage;Format=opencover`" 2>&1"
    if ($LASTEXITCODE -ne 0) { Write-Error 'dotnet test failed - fix tests before analyzing' }
} finally { Pop-Location }
$report = Get-ChildItem $testResults -Recurse -Filter coverage.opencover.xml | Select-Object -First 1
if (-not $report) { Write-Error 'no opencover report produced' }
$serverPrefix = [regex]::Escape((Join-Path $repo 'server') + '\')
$evaluator = { param($m) 'fullPath="/src/' + ($m.Groups[1].Value -replace '\\', '/') + '"' }
$rewritten = [regex]::Replace((Get-Content $report.FullName -Raw), "fullPath=`"$serverPrefix([^`"]*)`"", $evaluator)
New-Item -ItemType Directory -Force (Join-Path $repo 'server\coverage') | Out-Null
Set-Content -Path (Join-Path $repo 'server\coverage\opencover.xml') -Value $rewritten -Encoding utf8

Write-Host "==> dotnet-sonarscanner (munni-api, dockerized)" -ForegroundColor Cyan
cmd /c "docker build -q -t munni-sonar-dotnet -f `"$repo\deploy\sonar\Dockerfile.dotnet`" `"$repo\deploy\sonar`" 2>&1"
if ($LASTEXITCODE -ne 0) { Write-Error 'failed to build the dotnet scanner image' }
# EF migrations are generated code — excluded from analysis
# the host test run leaves Windows-built obj/bin behind — the Linux
# build inside the container chokes on them (MSB3491), so start clean
$inner = "rm -rf src/Munni.Api/obj src/Munni.Api/bin tests/Munni.Api.Tests/obj tests/Munni.Api.Tests/bin && dotnet sonarscanner begin /k:munni-api /n:munni-api /d:sonar.host.url=http://host.docker.internal:9000 /d:sonar.token=$token /d:sonar.exclusions=**/Migrations/** /d:sonar.cs.opencover.reportsPaths=/src/coverage/opencover.xml && dotnet build Munni.slnx --no-incremental && dotnet sonarscanner end /d:sonar.token=$token"
cmd /c "docker run --rm -v `"$repo\server`:/src`" munni-sonar-dotnet sh -c `"$inner`" 2>&1"
if ($LASTEXITCODE -ne 0) { Write-Error 'api analysis failed' }

Write-Host "Done - results at $hostUrl" -ForegroundColor Green
