$ErrorActionPreference = "Stop";

# Set the root of the sitecore folder - the compose project dir and the
# working directory the Sitecore CLI expects.
$SitecoreRoot = Resolve-Path "$PSScriptRoot\.."

# Store the location of the .env file
$envFileLocation = "$SitecoreRoot/.env"

# Preflight: fail with a useful message instead of halfway through a build.
if (-not (Test-Path $envFileLocation)) {
    throw "sitecore/.env not found. Run 'sitecore\scripts\init.ps1 -InitEnv' from an elevated PowerShell first."
}

$ErrorActionPreference = "Continue"
$dockerOs = docker version --format '{{.Server.Os}}' 2>$null
$ErrorActionPreference = "Stop"
if ($dockerOs -ne "windows") {
    throw "Docker is not on the Windows container engine (server OS: '$dockerOs'). Switch Docker Desktop to Windows containers, or run: docker context use desktop-windows"
}

$projectName = ((Get-Content $envFileLocation -Encoding UTF8) | Where-Object { $_ -imatch "^COMPOSE_PROJECT_NAME=.+" }).Split("=")[1]
$ownTraefik = docker ps -q --filter "label=com.docker.compose.project=$projectName" --filter "label=com.docker.compose.service=traefik"
$port443 = Get-NetTCPConnection -State Listen -LocalPort 443 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($port443 -and -not $ownTraefik) {
    $owner = (Get-Process -Id $port443.OwningProcess -ErrorAction SilentlyContinue).ProcessName
    throw "Port 443 is already in use (by '$owner'). Another container stack, e.g. another SitecoreAI (XM Cloud) starter clone, is probably running - stop it with 'docker compose down' in that stack's compose folder."
}

. $SitecoreRoot\scripts\upFunctions.ps1

Validate-LicenseExpiry -EnvFileName $envFileLocation

$envContent = Get-Content $envFileLocation -Encoding UTF8
$xmCloudHost = $envContent | Where-Object { $_ -imatch "^CM_HOST=.+" }
$sitecoreDockerRegistry = $envContent | Where-Object { $_ -imatch "^SITECORE_DOCKER_REGISTRY=.+" }
$sitecoreVersion = $envContent | Where-Object { $_ -imatch "^SITECORE_VERSION=.+" }
$ClientCredentialsLogin = $envContent | Where-Object { $_ -imatch "^SITECORE_FedAuth_dot_Auth0_dot_ClientCredentialsLogin=.+" }
$sitecoreApiKey = ($envContent | Where-Object { $_ -imatch "^SITECORE_API_KEY_APP_STARTER=.+" }).Split("=")[1]
$xmcloudDockerToolsImage = ($envContent | Where-Object { $_ -imatch "^TOOLS_IMAGE=.+" }).Split("=")[1]

$xmCloudHost = $xmCloudHost.Split("=")[1]
$sitecoreDockerRegistry = $sitecoreDockerRegistry.Split("=")[1]
$sitecoreVersion = $sitecoreVersion.Split("=")[1]
$ClientCredentialsLogin = $ClientCredentialsLogin.Split("=")[1]
if ($ClientCredentialsLogin -eq "true") {
    $xmCloudClientCredentialsLoginDomain = $envContent | Where-Object { $_ -imatch "^SITECORE_FedAuth_dot_Auth0_dot_Domain=.+" }
    $xmCloudClientCredentialsLoginAudience = $envContent | Where-Object { $_ -imatch "^SITECORE_FedAuth_dot_Auth0_dot_ClientCredentialsLogin_Audience=.+" }
    $xmCloudClientCredentialsLoginClientId = $envContent | Where-Object { $_ -imatch "^SITECORE_FedAuth_dot_Auth0_dot_ClientCredentialsLogin_ClientId=.+" }
    $xmCloudClientCredentialsLoginClientSecret = $envContent | Where-Object { $_ -imatch "^SITECORE_FedAuth_dot_Auth0_dot_ClientCredentialsLogin_ClientSecret=.+" }
    $xmCloudClientCredentialsLoginDomain = $xmCloudClientCredentialsLoginDomain.Split("=")[1]
    $xmCloudClientCredentialsLoginAudience = $xmCloudClientCredentialsLoginAudience.Split("=")[1]
    $xmCloudClientCredentialsLoginClientId = $xmCloudClientCredentialsLoginClientId.Split("=")[1]
    $xmCloudClientCredentialsLoginClientSecret = $xmCloudClientCredentialsLoginClientSecret.Split("=")[1]
}

# NODEJS_VERSION comes straight from .env; this repo has no xmcloud.build.json.

# Double check whether init has been run
$envCheckVariable = "HOST_LICENSE_FOLDER"
$envCheck = $envContent | Where-Object { $_ -imatch "^$envCheckVariable=.+" }
if (-not $envCheck) {
    throw "$envCheckVariable does not have a value. Did you run 'init.ps1 -InitEnv'?"
}

Write-Host "Keeping SitecoreAI (XM Cloud) base image up to date" -ForegroundColor Green
docker pull "$($sitecoreDockerRegistry)sitecore-xmcloud-cm:$($sitecoreVersion)"

Write-Host "Keeping SitecoreAI (XM Cloud) Tools image up to date" -ForegroundColor Green
docker pull "$($xmcloudDockerToolsImage):$($sitecoreVersion)"

# Moving into the compose project folder
Write-Host "Moving location into the sitecore folder..." -ForegroundColor Green
Push-Location $SitecoreRoot

# Build all containers in the Sitecore instance, forcing a pull of latest base containers
Write-Host "Building containers..." -ForegroundColor Green
docker compose build
if ($LASTEXITCODE -ne 0) {
    Write-Error "Container build failed, see errors above."
}

# Start the Sitecore instance
Write-Host "Starting Sitecore environment..." -ForegroundColor Green
docker compose up -d

# Wait for Traefik to expose CM route
Write-Host "Waiting for CM to become available..." -ForegroundColor Green
$startTime = Get-Date
do {
    Start-Sleep -Milliseconds 100
    try {
        $status = Invoke-RestMethod "http://localhost:8079/api/http/routers/cm-secure@docker"
    } catch {
        if ($_.Exception.Response.StatusCode.value__ -ne "404") {
            throw
        }
    }
} while ($status.status -ne "enabled" -and $startTime.AddSeconds(15) -gt (Get-Date))
if (-not $status.status -eq "enabled") {
    $status
    Write-Error "Timeout waiting for Sitecore CM to become available via Traefik proxy. Check CM container logs."
}

# Return to the original directory
Pop-Location

# The Sitecore CLI resolves .config/dotnet-tools.json, sitecore.json and authoring/
# from the working directory, and writes its token to .sitecore/user.json beside them.
# All four live under sitecore/, so run the whole CLI block from there.
Push-Location $SitecoreRoot

Write-Host "Restoring Sitecore CLI..." -ForegroundColor Green
dotnet tool restore
Write-Host "Installing Sitecore CLI Plugins..."
dotnet sitecore --help | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Unexpected error installing Sitecore CLI Plugins"
}

#####################################

Write-Host "Logging into Sitecore..." -ForegroundColor Green
if ($ClientCredentialsLogin -eq "true") {
    dotnet sitecore cloud login --client-id $xmCloudClientCredentialsLoginClientId --client-secret $xmCloudClientCredentialsLoginClientSecret --client-credentials true
    dotnet sitecore login --authority $xmCloudClientCredentialsLoginDomain --audience $xmCloudClientCredentialsLoginAudience --client-id $xmCloudClientCredentialsLoginClientId --client-secret $xmCloudClientCredentialsLoginClientSecret --cm https://$xmCloudHost --client-credentials true --allow-write true
}
else {
    dotnet sitecore cloud login
    dotnet sitecore connect --ref xmcloud --cm https://$xmCloudHost --allow-write true -n default
}

if ($LASTEXITCODE -ne 0) {
    Write-Error "Unable to log into Sitecore, did the Sitecore environment start correctly? See logs above."
}

# Populate Solr managed schemas to avoid errors during item deploy
Write-Host "Populating Solr managed schema..." -ForegroundColor Green
dotnet sitecore index schema-populate
if ($LASTEXITCODE -ne 0) {
    Write-Error "Populating Solr managed schema failed, see errors above."
}

# Rebuild indexes
Write-Host "Rebuilding indexes ..." -ForegroundColor Green
dotnet sitecore index rebuild

Write-Host "Pushing Default rendering host configuration" -ForegroundColor Green
dotnet sitecore ser push -i nextjs-starter

Write-Host "Pushing sitecore API key" -ForegroundColor Green 
& $SitecoreRoot\docker\build\cm\templates\import-templates.ps1 -RenderingSiteName "App-Starter" -SitecoreApiKey $sitecoreApiKey

Pop-Location

if ($ClientCredentialsLogin -ne "true") {
    Write-Host "Opening site..." -ForegroundColor Green
    
    Start-Process https://xmcloudcm.localhost/sitecore/
}

$renderingHost = ($envContent | Where-Object { $_ -imatch "^RENDERING_HOST_NEXTJS=.+" }).Split("=")[1]

Write-Host ""
Write-Host "SitecoreAI is up:" -ForegroundColor Green
Write-Host "  CM              https://$xmCloudHost/sitecore/"
Write-Host "  GraphQL IDE     https://$xmCloudHost/sitecore/api/authoring/graphql/ide/"
Write-Host "  Rendering host  https://$renderingHost"
Write-Host "  Traefik         http://localhost:8079"
Write-Host ""
Write-Host "Next: 'pnpm dev' for the Marketplace host, then 'pnpm probe:endpoints'." -ForegroundColor Green
Write-Host "Logs: 'pnpm sitecore:logs' (CM), or 'docker compose logs -f rendering-nextjs' in sitecore/." -ForegroundColor Green
Write-Host ""
