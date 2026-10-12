#!/usr/bin/env sh
set -eu

PACKAGE="${FORGE_MCP_PACKAGE:-forge-tracker-mcp@latest}"

fail() {
  printf '\nОшибка: %s\n' "$1" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "не найден Node.js. Установите Node.js 20.11+ с https://nodejs.org/ и повторите команду."
command -v npm >/dev/null 2>&1 || fail "не найден npm. Установите полную поставку Node.js 20.11+."

node -e '
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 20 || (major === 20 && minor < 11)) {
  console.error(`Нужен Node.js 20.11 или новее; сейчас ${process.versions.node}.`);
  process.exit(1);
}
' || exit 1

printf 'Устанавливаю %s…\n' "$PACKAGE"
npm install --global "$PACKAGE"

command -v forge-mcp-setup >/dev/null 2>&1 || fail "пакет установлен, но forge-mcp-setup не найден в PATH. Добавьте глобальный bin-каталог npm в PATH."

if [ -r /dev/tty ]; then
  exec forge-mcp-setup </dev/tty
fi

fail "не найден интерактивный терминал. Запустите forge-mcp-setup вручную."
