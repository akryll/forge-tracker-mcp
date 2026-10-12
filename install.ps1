$ErrorActionPreference = "Stop"
$Package = if ($env:FORGE_MCP_PACKAGE) { $env:FORGE_MCP_PACKAGE } else { "forge-tracker-mcp@latest" }
$DefaultBase = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME ".local/share" }
$InstallDir = if ($env:FORGE_MCP_INSTALL_DIR) { $env:FORGE_MCP_INSTALL_DIR } else { Join-Path $DefaultBase "forge-mcp" }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Не найден Node.js. Установите Node.js 20.11+ с https://nodejs.org/ и повторите команду."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "Не найден npm. Установите полную поставку Node.js 20.11+."
}

node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<20||(a===20&&b<11)){console.error(`Нужен Node.js 20.11 или новее; сейчас ${process.versions.node}.`);process.exit(1)}'
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Устанавливаю $Package…"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
npm install --prefix $InstallDir --no-fund --no-audit $Package
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$Setup = Join-Path $InstallDir "node_modules/forge-tracker-mcp/dist/setup.js"
if (-not (Test-Path $Setup -PathType Leaf)) {
  throw "npm завершился без ошибки, но файл мастера не найден: $Setup"
}

node $Setup
