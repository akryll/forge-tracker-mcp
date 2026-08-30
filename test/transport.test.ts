import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig } from "../src/config.js";
import { runHttp } from "../src/transport/http.js";
import { GUIDE_TEXT, guideHandler, startFakeForge } from "./fake-forge.js";

const KEY = "fga_test-key-not-a-real-one-0000000000000000000";
const ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));

function childEnv(apiUrl: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    FORGE_AGENT_KEY: KEY,
    FORGE_API_URL: apiUrl,
    ...extra,
  };
}

test("stdio: агент видит инструмент и получает памятку, ключ наружу не выходит", async () => {
  const forge = await startFakeForge(guideHandler);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", ENTRY],
    env: childEnv(forge.url),
    stderr: "pipe",
  });

  let log = "";
  const client = new Client({ name: "test", version: "0" });
  try {
    await client.connect(transport);
    transport.stderr?.on("data", (chunk: Buffer) => {
      log += chunk.toString("utf8");
    });

    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "forge_guide"));

    const called = await client.callTool({ name: "forge_guide" });
    assert.equal(called.isError, undefined);
    assert.deepEqual(called.content, [{ type: "text", text: GUIDE_TEXT }]);

    const resources = await client.listResources();
    assert.deepEqual(
      resources.resources.map((resource) => resource.uri),
      ["forge://guide"],
    );
    const read = await client.readResource({ uri: "forge://guide" });
    const first = read.contents[0];
    assert.ok(first && "text" in first);
    assert.equal(first.text, GUIDE_TEXT);

    // Ключ отдал сервер, а не агент: заголовок дошёл, но в ответах его нет.
    assert.equal(forge.requests[0]?.headers["x-agent-key"], KEY);
    assert.ok(!JSON.stringify([tools, called, resources, read]).includes(KEY));
    assert.ok(!log.includes(KEY), "ключ попал в лог");
  } finally {
    await client.close();
    await forge.close();
  }
});

test("http: тот же сервер отвечает удалённому агенту", async () => {
  const forge = await startFakeForge(guideHandler);
  const config = loadConfig({ FORGE_AGENT_KEY: KEY, FORGE_API_URL: forge.url });
  const server = await runHttp(config, { host: "127.0.0.1", port: 0, path: "/mcp" });

  const client = new Client({ name: "test", version: "0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
    const called = await client.callTool({ name: "forge_guide" });
    assert.deepEqual(called.content, [{ type: "text", text: GUIDE_TEXT }]);
    assert.ok(!JSON.stringify(called).includes(KEY));
  } finally {
    await client.close();
    await server.close();
    await forge.close();
  }
});

test("отказ Forge доходит до агента текстом, а не молчанием", async () => {
  const forge = await startFakeForge((_req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "unauthorized", message: "Ключ не действует" }));
  });
  const config = loadConfig({ FORGE_AGENT_KEY: KEY, FORGE_API_URL: forge.url });
  const server = await runHttp(config, { host: "127.0.0.1", port: 0, path: "/mcp" });

  const client = new Client({ name: "test", version: "0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
    const called = await client.callTool({ name: "forge_guide" });
    assert.equal(called.isError, true);
    const [first] = called.content as { text: string }[];
    assert.match(first?.text ?? "", /Ключ агента не действует: отозван или введён неверно/);
  } finally {
    await client.close();
    await server.close();
    await forge.close();
  }
});

test("без ключа сервер не поднимается и объясняет, чего не хватает", async () => {
  const child = spawn(process.execPath, ["--import", "tsx", ENTRY], {
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stderr.on("data", (chunk: Buffer) => {
    log += chunk.toString("utf8");
  });

  const [code] = (await once(child, "exit")) as [number | null];
  assert.equal(code, 1);
  assert.match(log, /FORGE_AGENT_KEY/);
  assert.ok(!log.includes("at "), `вместо сообщения показан стек:\n${log}`);
});
