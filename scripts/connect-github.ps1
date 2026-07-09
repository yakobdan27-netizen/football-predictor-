# One-time setup: connect this repo to GitHub + Vercel Git CI
# Run from project root: powershell -ExecutionPolicy Bypass -File scripts/connect-github.ps1

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host "Checking GitHub CLI auth..."
gh auth status 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Log in to GitHub (browser will open)..."
  gh auth login --hostname github.com --git-protocol https --web
}

$repoName = "football-predictor"
$owner = (gh api user -q .login)
$remote = "https://github.com/$owner/$repoName.git"

if (-not (git remote get-url origin 2>$null)) {
  Write-Host "Creating GitHub repo $owner/$repoName ..."
  gh repo create $repoName --private --source=. --remote=origin --push
} else {
  Write-Host "Pushing to origin..."
  git push -u origin main
}

Write-Host "Connecting Vercel project to Git..."
vercel git connect $remote

Write-Host "Done. Future pushes to main will auto-deploy to production."
