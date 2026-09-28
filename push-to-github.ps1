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
  throw "Не удалось получить текущий main с GitHub. Проверьте вход в GitHub и сеть."
}
$remoteSha = ($remoteLine -split "\s+")[0]

$head = (git rev-parse HEAD)
if (-not $head) {
  throw "Локальный Git не содержит коммитов."
}

Write-Host "Отправляется коммит $head"
Write-Host "Текущий GitHub main: $remoteSha"
Write-Host "Ветка main будет обновлена на готовую версию TrumMarket."

git push origin "HEAD:main" "--force-with-lease=refs/heads/main:$remoteSha"
Write-Host "Готово: https://github.com/Segun0013/trummarket"
