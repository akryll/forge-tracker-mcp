$ErrorActionPreference = "Stop"
$Package = if ($env:FORGE_MCP_PACKAGE) { $env:FORGE_MCP_PACKAGE } else { "forge-tracker-mcp@latest" }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Не найден Node.js. Установите Node.js 20.11+ с https://nodejs.org/ и повторите команду."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "Не найден npm. Установите полную поставку Node.js 20.11+."
}

node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<20||(a===20&&b<11)){console.error(`Нужен Node.js 20.11 или новее; сейчас ${process.versions.node}.`);process.exit(1)}'
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Устанавливаю $Package…"
npm install --global $Package
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not (Get-Command forge-mcp-setup -ErrorAction SilentlyContinue)) {
  throw "Пакет установлен, но forge-mcp-setup не найден в PATH. Добавьте глобальный bin-каталог npm в PATH."
}

forge-mcp-setup
