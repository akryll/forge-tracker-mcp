import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "../config.js";
import { logError, logInfo } from "../log.js";
import { createServer } from "../server.js";

export interface HttpOptions {
  readonly host: string;
  readonly port: number;
  readonly path: string;
}

export const DEFAULT_HTTP_HOST = "127.0.0.1";
export const DEFAULT_HTTP_PORT = 8765;
export const DEFAULT_HTTP_PATH = "/mcp";

/** Поднятый сервер: адрес, по которому он реально слушает, и способ погасить. */
export interface HttpHandle {
  readonly url: string;
  close(): Promise<void>;
}

function reject(res: ServerResponse, status: number, code: string, message: string): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ code, message }));
}

/**
 * Транспорт для удалённых агентов. Сессия на подключение: идентификатор
 * выдаёт сервер и присылает его в заголовке, дальше агент им и представляется.
 *
 * Слушаем по умолчанию только localhost и требуем совпадения Host: сервер
 * держит ключ агента, и открывать его наружу без нужды нельзя.
 */
export async function runHttp(config: Config, options: HttpOptions): Promise<HttpHandle> {
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  // Порт может быть выбран системой (0 в тестах), поэтому проверку Host
  // собираем по факту прослушивания, а не по тому, что просили.
  let listeningPort = options.port;

  const http = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res).catch((error: unknown) => {
      logError(`Запрос не обработан: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) {
        reject(res, 500, "internal", "Внутренняя ошибка MCP-сервера");
      }
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? options.host}`);
    if (url.pathname !== options.path) {
      reject(res, 404, "not_found", `MCP слушает ${options.path}, а не ${url.pathname}`);
      return;
    }

    const sessionId = req.headers["mcp-session-id"];
    const known = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
    if (known) {
      await known.handleRequest(req, res);
      return;
    }
    if (typeof sessionId === "string") {
      reject(res, 404, "not_found", "Сессия неизвестна или уже закрыта — начните заново");
      return;
    }
    if (req.method !== "POST") {
      reject(res, 400, "validation", "Первым запросом должен быть POST с initialize");
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableDnsRebindingProtection: true,
      allowedHosts: [`${options.host}:${listeningPort}`, `localhost:${listeningPort}`],
      onsessioninitialized: (id) => {
        sessions.set(id, transport);
        logInfo(`Сессия ${id} открыта`);
      },
      onsessionclosed: (id) => {
        sessions.delete(id);
        logInfo(`Сессия ${id} закрыта`);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };

    await createServer(config).connect(transport);
    await transport.handleRequest(req, res);
  }

  await new Promise<void>((resolve, reject_) => {
    http.once("error", reject_);
    http.listen(options.port, options.host, () => {
      http.off("error", reject_);
      listeningPort = (http.address() as AddressInfo).port;
      resolve();
    });
  });

  const url = `http://${options.host}:${listeningPort}${options.path}`;
  logInfo(`forge-mcp поднят по HTTP на ${url}, API ${config.apiUrl}`);

  return {
    url,
    close: async () => {
      for (const transport of sessions.values()) await transport.close();
      sessions.clear();
      await new Promise<void>((resolve, reject_) =>
        http.close((error) => (error ? reject_(error) : resolve())),
      );
    },
  };
}
