# Builds a production zip in dist-release/qqnotice-<version>.zip.
# Excludes node_modules, source TS, tests, agent docs, .env.
#
# Run from repo root:  pwsh -File scripts/package-release.ps1
#
# Assumes server\dist and web\dist have already been built. The script will
# refuse to package if either is missing.

$ErrorActionPreference = "Stop"

$root = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location $root

if (-not (Test-Path "$root\server\dist\index.js")) {
    Write-Error "server\dist not found. Run: pnpm -C server build"
}
if (-not (Test-Path "$root\web\dist\index.html")) {
    Write-Error "web\dist not found. Run: pnpm -C web build"
}

$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$staging = Join-Path $root "release\staging-$stamp"
$outDir  = Join-Path $root "release"
$outZip  = Join-Path $outDir "qqnotice-$stamp.zip"

if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
if (Test-Path $outZip) { Remove-Item -Force $outZip }

New-Item -ItemType Directory -Path $staging | Out-Null

# Top-level files
Copy-Item "$root\package.json"        $staging
Copy-Item "$root\pnpm-workspace.yaml" $staging
Copy-Item "$root\pnpm-lock.yaml"      $staging
Copy-Item "$root\.env.example"        $staging
Copy-Item "$root\.gitattributes"      $staging -ErrorAction SilentlyContinue
Copy-Item "$root\README.md"           $staging
Copy-Item "$root\scripts\release-template\DEPLOY.md"  $staging
Copy-Item "$root\scripts\release-template\start.cmd"  $staging

# server: only what's needed at runtime
$serverDst = Join-Path $staging "server"
New-Item -ItemType Directory -Path $serverDst | Out-Null
Copy-Item "$root\server\package.json"     $serverDst
Copy-Item "$root\server\dist"             $serverDst -Recurse
Copy-Item "$root\server\prisma"           $serverDst -Recurse
Copy-Item "$root\server\scripts"          $serverDst -Recurse

# web: only the built static bundle
$webDst = Join-Path $staging "web"
New-Item -ItemType Directory -Path $webDst | Out-Null
Copy-Item "$root\web\package.json" $webDst
Copy-Item "$root\web\dist"         $webDst -Recurse

# Defensive cleanup of anything that snuck in.
Get-ChildItem -Path $staging -Recurse -Force -Include `
    "*.test.js","*.test.ts","*.test.d.ts", "tsconfig*.json", `
    "vitest.config.*", ".env", ".env.local" `
    | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path $staging -Recurse -Directory -Force -Include `
    "node_modules","__tests__",".scratch",".git",".vscode" `
    | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

Compress-Archive -Path "$staging\*" -DestinationPath $outZip -CompressionLevel Optimal
Remove-Item -Recurse -Force $staging

$size = [math]::Round((Get-Item $outZip).Length / 1KB, 1)
Write-Host "Wrote $outZip ($size KB)"
