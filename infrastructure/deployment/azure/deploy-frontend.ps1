param(
  [string]$Version = ('frontend-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))
)
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^[a-zA-Z0-9-]+$') { throw 'Version invalida' }
$azureCliPath = 'C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd'
$repositoryRoot = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$browserDirectory = Join-Path $repositoryRoot 'apps\booking-web\dist\booking-frontend\browser'
$artifactDirectory = Join-Path $repositoryRoot ".tmp\azure-frontend-$Version"
$stagingDirectory = Join-Path $artifactDirectory 'site'
if (-not (Test-Path -LiteralPath (Join-Path $browserDirectory 'index.html'))) { throw 'Falta el build de produccion' }
if (Test-Path -LiteralPath $artifactDirectory) { throw 'Usa una version nueva para conservar los respaldos anteriores' }
New-Item -ItemType Directory -Path $stagingDirectory -Force | Out-Null
Get-ChildItem -LiteralPath $browserDirectory -Force | Copy-Item -Destination $stagingDirectory -Recurse
$accessToken = & $azureCliPath account get-access-token --resource https://management.azure.com/ --query accessToken -o tsv --only-show-errors
if ($LASTEXITCODE -ne 0 -or -not $accessToken) { throw 'No se pudo autenticar con Entra' }
$backupPath = Join-Path $artifactDirectory 'previous-wwwroot.zip'
Invoke-WebRequest -UseBasicParsing -Uri 'https://viveloecuador-hufhcvg6eah6e2fm.scm.brazilsouth-01.azurewebsites.net/api/zip/site/wwwroot/' -Headers @{ Authorization="Bearer $accessToken" } -OutFile $backupPath -TimeoutSec 120
$accessToken = $null
if ((Get-Item -LiteralPath $backupPath).Length -eq 0) { throw 'Respaldo vacio' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$preserved = 0
# Keep immutable assets referenced by open tabs. Never restore an old index or configuration.
foreach ($directory in Get-ChildItem -LiteralPath (Join-Path $repositoryRoot '.tmp') -Directory -Filter 'azure-frontend-*') {
  $archivePath = Join-Path $directory.FullName 'previous-wwwroot.zip'
  if (-not (Test-Path -LiteralPath $archivePath)) { continue }
  $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
  try {
    foreach ($entry in $archive.Entries) {
      $entryName = $entry.FullName.Replace('\','/')
      if ($entryName -notmatch '^(?:main|chunk|styles)-[A-Za-z0-9_-]+\.(?:js|css)$') { continue }
      $destination = Join-Path $stagingDirectory $entryName
      if (Test-Path -LiteralPath $destination) { continue }
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $false)
      $preserved++
    }
  } finally { $archive.Dispose() }
}
$main = Get-ChildItem -LiteralPath $browserDirectory -Filter 'main-*.js' | Select-Object -First 1
$release = @{ version=$Version; main=$main.Name; builtAt=[DateTime]::UtcNow.ToString('o'); preservedAssets=$preserved }
$release | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stagingDirectory 'release.json') -Encoding UTF8
$release | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $artifactDirectory 'manifest.json') -Encoding UTF8
$packagePath = Join-Path $artifactDirectory 'frontend.zip'
Get-ChildItem -LiteralPath $stagingDirectory -Force | Compress-Archive -DestinationPath $packagePath
Write-Output "Version $Version; $preserved archivos inmutables anteriores conservados."
& $azureCliPath webapp deploy -g viveloecuador_group -n viveloecuador --src-path $packagePath --type zip --async true --only-show-errors -o none
if ($LASTEXITCODE -ne 0) { throw 'Fallo el despliegue del frontend' }
Write-Output 'Frontend enviado a Azure; verificar version y archivos publicados.'
