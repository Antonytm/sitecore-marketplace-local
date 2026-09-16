# Set the root of the sitecore folder - the compose project dir
$SitecoreRoot = Resolve-Path "$PSScriptRoot\.."

Write-Host "Down containers..." -ForegroundColor Green
try {
  Push-Location $SitecoreRoot
  docker compose down
  Pop-Location
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Container down failed, see errors above."
  }
}
finally {
}
