import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface Recorded {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

export interface FakeForge {
  readonly url: string;
  readonly requests: Recorded[];
  close(): Promise<void>;
}

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

/** Forge понарошку: отдаёт то, что попросили, и запоминает, чем к нему пришли. */
export async function startFakeForge(handler: Handler): Promise<FakeForge> {
  const requests: Recorded[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body,
      });
      handler(req, res, body);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/api/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

export const GUIDE_TEXT = "# Памятка агента Forge\n\nЧто агенту доверено, а что нет.\n";

/** Обычный Forge: памятка по /agent/guide, на всё прочее — 404 как у настоящего. */
export function guideHandler(req: IncomingMessage, res: ServerResponse): void {
  if (req.url === "/api/v1/agent/guide") {
    res.writeHead(200, { "Content-Type": "text/markdown" });
    res.end(GUIDE_TEXT);
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ code: "not_found", message: "Задача не найдена" }));
}

/** Маршруты: ключ — «METHOD /path», значение — что ответить. */
export type Routes = Record<string, (body: string) => { status: number; json: unknown }>;

/** Forge, отвечающий по таблице маршрутов; на всё прочее — 404, как настоящий. */
export function routed(routes: Routes): Handler {
  return (req, res, body) => {
    const key = `${req.method} ${(req.url ?? "").replace("/api/v1", "")}`;
    const route = routes[key];
    if (!route) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: "not_found", message: "Задача не найдена" }));
      return;
    }
    const answer = route(body);
    res.writeHead(answer.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(answer.json));
  };
}
