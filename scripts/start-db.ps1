# Starts the local PostgreSQL database for SoftGlaze (portable install, no Docker needed).
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\start-db.ps1
# The portable Postgres lives OUTSIDE the repo at ..\pg (binaries in ..\pg\pgsql, data in ..\pg\data).

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$pgRoot   = Join-Path (Split-Path -Parent $repoRoot) "pg"
$bin      = Join-Path $pgRoot "pgsql\bin"
$data     = Join-Path $pgRoot "data"
$log      = Join-Path $pgRoot "pg.log"

if (-not (Test-Path (Join-Path $bin "pg_ctl.exe"))) {
    Write-Host "Portable Postgres not found at $bin" -ForegroundColor Red
    Write-Host "Install the portable PostgreSQL runtime into ..\pg first (see README)."
    exit 1
}

$status = & (Join-Path $bin "pg_ctl.exe") -D $data status 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "Database is already running." -ForegroundColor Green
    exit 0
}

& (Join-Path $bin "pg_ctl.exe") -D $data -l $log -w start
if ($LASTEXITCODE -eq 0) {
    Write-Host "Database started on localhost:5432 (user: softglaze, db: softglaze)." -ForegroundColor Green
} else {
    Write-Host "Failed to start database — see log: $log" -ForegroundColor Red
    exit 1
}
