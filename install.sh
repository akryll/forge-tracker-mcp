#!/usr/bin/env sh
set -eu

PACKAGE="${FORGE_MCP_PACKAGE:-forge-tracker-mcp@latest}"
DATA_HOME="${XDG_DATA_HOME:-${HOME:-}/.local/share}"
INSTALL_DIR="${FORGE_MCP_INSTALL_DIR:-$DATA_HOME/forge-mcp}"

fail() {
  printf '\nОшибка: %s\n' "$1" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "не найден Node.js. Установите Node.js 20.11+ с https://nodejs.org/ и повторите команду."
command -v npm >/dev/null 2>&1 || fail "не найден npm. Установите полную поставку Node.js 20.11+."
[ -n "${HOME:-}" ] || [ -n "${FORGE_MCP_INSTALL_DIR:-}" ] || fail "не удалось определить домашнюю папку пользователя."

node -e '
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 20 || (major === 20 && minor < 11)) {
  console.error(`Нужен Node.js 20.11 или новее; сейчас ${process.versions.node}.`);
  process.exit(1);
}
' || exit 1

printf 'Устанавливаю %s в %s…\n' "$PACKAGE" "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
npm install --prefix "$INSTALL_DIR" --no-fund --no-audit "$PACKAGE"

SETUP="$INSTALL_DIR/node_modules/forge-tracker-mcp/dist/setup.js"
[ -f "$SETUP" ] || fail "npm завершился без ошибки, но файл мастера не найден: $SETUP"

if [ -t 0 ]; then
  exec node "$SETUP"
fi

if (: </dev/tty) 2>/dev/null; then
  exec node "$SETUP" </dev/tty
fi

fail "не найден интерактивный терминал. Повторите команду в обычном терминале."
