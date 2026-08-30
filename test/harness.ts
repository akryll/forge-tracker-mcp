import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../src/config.js";
import { createServer } from "../src/server.js";
import { startFakeForge, type FakeForge, type Routes, routed } from "./fake-forge.js";

export const KEY = "fga_test-key-not-a-real-one-0000000000000000000";

export interface Harness {
  readonly client: Client;
  readonly forge: FakeForge;
  /** Текст первого блока ответа инструмента — то, что читает агент. */
  call(name: string, args?: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  close(): Promise<void>;
}

/** Сервер и агент, соединённые напрямую: без транспорта, но по-настоящему. */
export async function harness(
  routes: Routes,
  env: Record<string, string> = {},
): Promise<Harness> {
  const forge = await startFakeForge(routed(routes));
  const server = createServer(
    loadConfig({ FORGE_AGENT_KEY: KEY, FORGE_API_URL: forge.url, ...env }),
  );
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

  return {
    client,
    forge,
    async call(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      const content = result.content as { type: string; text?: string }[];
      return { text: content[0]?.text ?? "", isError: result.isError === true };
    },
    async close() {
      await client.close();
      await server.close();
      await forge.close();
    },
  };
}
