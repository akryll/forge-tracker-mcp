import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { ForgeApiError, ForgeClient } from "../src/forge-client.js";
import { GUIDE_TEXT, guideHandler, startFakeForge } from "./fake-forge.js";

const KEY = "fga_test-key-not-a-real-one-0000000000000000000";

function clientFor(url: string, extra: Record<string, string> = {}): ForgeClient {
  return new ForgeClient(loadConfig({ FORGE_AGENT_KEY: KEY, FORGE_API_URL: url, ...extra }));
}

test("ключ уходит заголовком X-Agent-Key, памятка возвращается текстом", async () => {
  const forge = await startFakeForge(guideHandler);
  try {
    const text = await clientFor(forge.url).requestText("/agent/guide", {
      accept: "text/markdown",
    });
    assert.equal(text, GUIDE_TEXT);
    assert.equal(forge.requests[0]?.headers["x-agent-key"], KEY);
    assert.equal(forge.requests[0]?.headers.accept, "text/markdown");
  } finally {
    await forge.close();
  }
});

test("отказ Forge разбирается на code и message", async () => {
  const forge = await startFakeForge((_req, res) => {
    res.writeHead(409, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: "conflict", message: "Задача уже взята" }));
  });
  try {
    await assert.rejects(
      () => clientFor(forge.url).requestJson("/agent/tasks/1/claim", { method: "POST" }),
      (error: unknown) => {
        assert.ok(error instanceof ForgeApiError);
        assert.equal(error.code, "conflict");
        assert.equal(error.status, 409);
        assert.equal(error.message, "Задача уже взята");
        return true;
      },
    );
  } finally {
    await forge.close();
  }
});

test("ответ не от Forge не выдаётся за отказ Forge", async () => {
  const forge = await startFakeForge((_req, res) => {
    res.writeHead(502, { "Content-Type": "text/html" });
    res.end("<html>Bad gateway</html>");
  });
  try {
    await assert.rejects(
      () => clientFor(forge.url).requestJson("/agent/tasks"),
      (error: unknown) => {
        assert.ok(error instanceof ForgeApiError);
        assert.equal(error.code, "unknown");
        assert.match(error.message, /502/);
        return true;
      },
    );
  } finally {
    await forge.close();
  }
});

test("недоступный Forge объясняется адресом, а не ключом", async () => {
  const forge = await startFakeForge(guideHandler);
  const url = forge.url;
  await forge.close();
  await assert.rejects(
    () => clientFor(url).requestText("/agent/guide"),
    (error: unknown) => {
      assert.ok(error instanceof ForgeApiError);
      assert.equal(error.code, "network");
      assert.match(error.message, /достучаться/);
      assert.ok(!error.message.includes(KEY));
      return true;
    },
  );
});

test("молчащий Forge обрывается по таймауту, а не висит", async () => {
  const forge = await startFakeForge(() => {
    // Ответа не будет вовсе — ждём, что клиент сам разорвёт запрос.
  });
  try {
    await assert.rejects(
      () => clientFor(forge.url, { FORGE_TIMEOUT_MS: "150" }).requestText("/agent/guide"),
      (error: unknown) => {
        assert.ok(error instanceof ForgeApiError);
        assert.equal(error.code, "network");
        assert.match(error.message, /150 мс/);
        return true;
      },
    );
  } finally {
    await forge.close();
  }
});
