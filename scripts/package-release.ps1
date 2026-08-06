# Builds the two shippable zips from the repo + the freshly built installer.
#
#   CodeCanyon zip:  SoftGlaze-Stock-Manager-v<ver>\
#                      LICENSE.txt, START-HERE.txt,
#                      Documentation\index.html   (docs/documentation.html)
#                      Installer\*.exe
#                      Source\<repo without build output or secrets>
#   Source zip:      <repo> at the archive root
#
# Everything it needs lives in the repo, so a release is reproducible:
#   1. npm run dist -w apps/desktop     (builds the installer; runs the hooks guard)
#   2. npm run docs:build               (rebuilds documentation.html)
#   3. powershell -File scripts\package-release.ps1
#
$ErrorActionPreference = "Stop"

$REPO   = Split-Path -Parent $PSScriptRoot          # …\softglaze  (the repo)
$ROOT   = Split-Path -Parent $REPO                  # the folder that holds the repo
$OUT    = Join-Path $ROOT 'deliverables'            # zips live next to the repo, not in it
$ASSETS = Join-Path $REPO 'docs\codecanyon'
$STAGE  = Join-Path $env:TEMP 'softglaze-release-stage'
$VER    = (Get-Content (Join-Path $REPO 'package.json') -Raw | ConvertFrom-Json).version
$SETUP  = Join-Path $REPO "apps\desktop\release\SoftGlaze-Stock-Manager-Setup-$VER.exe"

Write-Output "[release] version $VER"
if (-not (Test-Path $SETUP)) { throw "Installer not found: $SETUP  (run: npm run dist -w apps/desktop)" }
$docs = Join-Path $REPO 'docs\documentation.html'
if (-not (Test-Path $docs)) { throw "Documentation not built: $docs  (run: npm run docs:build)" }
New-Item -ItemType Directory -Force -Path $OUT | Out-Null

# ── 1. Stage a clean copy of the source ───────────────────────────────────────
if (Test-Path $STAGE) { Remove-Item $STAGE -Recurse -Force }
$SRC = Join-Path $STAGE 'Source'
New-Item -ItemType Directory -Force -Path $SRC | Out-Null

$excludeDirs = @('node_modules','dist','release','vendor','.git','.vite','coverage',
                 'test-results','playwright-report','.playwright-mcp','.turbo','.cache')

Get-ChildItem $REPO -Recurse -File -Force | ForEach-Object {
    $rel = $_.FullName.Substring($REPO.Length + 1)
    $parts = $rel -split '\\'
    foreach ($d in $excludeDirs) { if ($parts -contains $d) { return } }
    if ($_.Name -eq '.env') { return }                                   # never ship secrets
    if ($_.Extension -in '.tsbuildinfo','.log','.exe','.zip','.dump','.7z') { return }
    # ship the uploads folder, but never a shop's actual images
    if ($parts -contains 'uploads' -and $_.Name -ne 'README.txt') { return }

    $dest = Join-Path $SRC $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
    Copy-Item $_.FullName $dest -Force
}
Write-Output "[stage] $((Get-ChildItem $SRC -Recurse -File | Measure-Object).Count) source files"

# ── 2. CodeCanyon bundle ──────────────────────────────────────────────────────
$CC = Join-Path $STAGE "SoftGlaze-Stock-Manager-v$VER"
New-Item -ItemType Directory -Force -Path (Join-Path $CC 'Documentation') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $CC 'Installer') | Out-Null

Copy-Item (Join-Path $ASSETS 'LICENSE.txt') (Join-Path $CC 'LICENSE.txt') -Force
# START-HERE carries the version, so template it rather than hand-editing each release
(Get-Content (Join-Path $ASSETS 'START-HERE.txt') -Raw).Replace('{{VERSION}}', $VER) |
    Set-Content (Join-Path $CC 'START-HERE.txt') -Encoding utf8
Copy-Item $docs  (Join-Path $CC 'Documentation\index.html') -Force
Copy-Item $SETUP (Join-Path $CC "Installer\SoftGlaze-Stock-Manager-Setup-$VER.exe") -Force
Copy-Item $SRC   (Join-Path $CC 'Source') -Recurse -Force

$ccZip = Join-Path $OUT "SoftGlaze-Stock-Manager-CodeCanyon-v$VER.zip"
if (Test-Path $ccZip) { Remove-Item $ccZip -Force }
Compress-Archive -Path $CC -DestinationPath $ccZip -CompressionLevel Optimal
Write-Output "[zip] $(Split-Path $ccZip -Leaf)"

# ── 3. Source-only zip ────────────────────────────────────────────────────────
$srcZip = Join-Path $OUT "SoftGlaze-Stock-Manager-v$VER-source.zip"
if (Test-Path $srcZip) { Remove-Item $srcZip -Force }
Compress-Archive -Path (Join-Path $SRC '*') -DestinationPath $srcZip -CompressionLevel Optimal
Write-Output "[zip] $(Split-Path $srcZip -Leaf)"

# ── 4. Standalone installer ───────────────────────────────────────────────────
Copy-Item $SETUP (Join-Path $OUT "SoftGlaze-Stock-Manager-Setup-$VER.exe") -Force
Write-Output "[copy] installer"

Remove-Item $STAGE -Recurse -Force
Get-ChildItem $OUT | Select-Object @{n='MB';e={[math]::Round($_.Length/1MB,2)}},LastWriteTime,Name |
    Format-Table -AutoSize | Out-String -Width 120
