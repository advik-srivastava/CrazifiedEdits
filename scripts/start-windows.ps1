# CrazifiedEdits local setup — run from this project directory in PowerShell.
$ErrorActionPreference = "Stop"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js 22+ is required: https://nodejs.org/"
}
Write-Host "CrazifiedEdits local setup" -ForegroundColor Magenta
if (-not (Test-Path ".env.local")) {
  Copy-Item ".env.example" ".env.local"
  Write-Host "Created .env.local — fill in your Supabase and Google OAuth details before signing in." -ForegroundColor Yellow
  Write-Host "These are your unique secrets. Copy them into .env.local:" -ForegroundColor Yellow
  node scripts/generate-secrets.mjs
}
Write-Host "Installing dependencies..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
Write-Host "Starting the app at http://localhost:3000" -ForegroundColor Green
npm run dev
