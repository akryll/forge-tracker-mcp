#!/usr/bin/env node
import { ConfigError, loadConfig } from "./config.js";
import { logError } from "./log.js";
import { rememberSecret } from "./secret.js";
import { runStdio } from "./transport/stdio.js";
import {
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PATH,
  DEFAULT_HTTP_PORT,
  runHttp,
} from "./transport/http.js";

const USAGE = `forge-mcp — MCP-сервер поверх агентского API Forge

  forge-mcp [--stdio]                 транспорт для локального агента (по умолчанию)
  forge-mcp --http [--port N] [--host H] [--path P]   транспорт для удалённого агента

Переменные окружения:
  FORGE_AGENT_KEY        ключ агента (fga_…); либо FORGE_AGENT_KEY_FILE — путь к файлу с ним
  FORGE_AGENT_KEY_FILE   файл с ключом, если держать его в переменной неудобно
  FORGE_API_URL          адрес API Forge, по умолчанию http://localhost:8090/api/v1
  FORGE_TIMEOUT_MS       потолок на запрос к Forge, по умолчанию 15000
`;

interface Args {
  readonly transport: "stdio" | "http";
  readonly host: string;
  readonly port: number;
  readonly path: string;
  readonly help: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  let transport: "stdio" | "http" = "stdio";
  let host = process.env.FORGE_MCP_HOST?.trim() || DEFAULT_HTTP_HOST;
  let port = Number(process.env.FORGE_MCP_PORT?.trim() || DEFAULT_HTTP_PORT);
  let path = process.env.FORGE_MCP_PATH?.trim() || DEFAULT_HTTP_PATH;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--stdio":
        transport = "stdio";
        break;
      case "--http":
        transport = "http";
        break;
      case "--host":
        host = argv[++i] ?? host;
        break;
      case "--port":
        port = Number(argv[++i]);
        break;
      case "--path":
        path = argv[++i] ?? path;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        throw new ConfigError(`Непонятный аргумент: ${arg}\n\n${USAGE}`);
    }
  }

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new ConfigError("--port должен быть числом от 1 до 65535");
  }
  if (!path.startsWith("/")) {
    throw new ConfigError("--path должен начинаться со слэша");
  }
  return { transport, host, port, path, help };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  const config = loadConfig();
  // С этого момента ключ известен затирающему фильтру: он не выйдет наружу,
  // даже если попадёт в чужой текст.
  rememberSecret(config.key);

  if (args.transport === "stdio") {
    await runStdio(config);
  } else {
    await runHttp(config, { host: args.host, port: args.port, path: args.path });
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    // Настройки — вина человека, а не сбой: показываем строку, не стек.
    logError(error.message);
  } else {
    logError(error instanceof Error ? (error.stack ?? error.message) : String(error));
  }
  process.exitCode = 1;
});
