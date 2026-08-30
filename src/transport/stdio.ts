import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Config } from "../config.js";
import { logInfo } from "../log.js";
import { createServer } from "../server.js";

/**
 * Транспорт для локальных агентов: Claude Code, Codex. Диалог идёт по
 * stdin/stdout, поэтому в stdout не должно попасть ничего постороннего —
 * весь лог уходит в stderr (см. `log.ts`).
 */
export async function runStdio(config: Config): Promise<void> {
  const server = createServer(config);
  await server.connect(new StdioServerTransport());
  logInfo(`forge-mcp поднят по stdio, API ${config.apiUrl}`);
}
