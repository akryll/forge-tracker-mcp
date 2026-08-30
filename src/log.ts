import { redact } from "./secret.js";

/**
 * Лог идёт в stderr, и только в него: в транспорте stdio stdout занят самим
 * протоколом MCP, и любая посторонняя строка там ломает диалог с агентом.
 *
 * Каждая строка проходит через `redact`: логировать ключ нельзя даже случайно.
 */
function write(level: string, message: string): void {
  process.stderr.write(`${new Date().toISOString()} ${level} ${redact(message)}\n`);
}

export function logInfo(message: string): void {
  write("info", message);
}

export function logError(message: string): void {
  write("error", message);
}
