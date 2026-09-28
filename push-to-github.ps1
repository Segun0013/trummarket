$ErrorActionPreference = "Stop"

$repoUrl = "https://github.com/Segun0013/trummarket.git"

if (-not (Test-Path ".git")) {
  git init
}

$origin = (git remote get-url origin 2>$null)
if (-not $origin) {
  git remote add origin $repoUrl
} elseif ($origin -ne $repoUrl) {
  git remote set-url origin $repoUrl
}

git branch -M main

$remoteLine = (git ls-remote origin refs/heads/main)
if (-not $remoteLine) {
  throw "Could not read current GitHub main. Check GitHub login and network."
}
$remoteSha = ($remoteLine -split "\s+")[0]

$head = (git rev-parse HEAD)
if (-not $head) {
  throw "The local Git repository has no commits."
}

Write-Host "Pushing commit $head"
Write-Host "Current GitHub main: $remoteSha"
Write-Host "Updating main to the TrumMarket release."

git push origin "HEAD:main" "--force-with-lease=refs/heads/main:$remoteSha"
Write-Host "Done: https://github.com/Segun0013/trummarket"
