import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, DEFAULT_API_URL, DEFAULT_TIMEOUT_MS, loadConfig } from "../src/config.js";

const KEY = "fga_test-key-not-a-real-one-0000000000000000000";

test("без ключа сервер не стартует и говорит, чего не хватает", () => {
  assert.throws(
    () => loadConfig({}),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /FORGE_AGENT_KEY/);
      assert.match(error.message, /\/agents/);
      return true;
    },
  );
});

test("ключ не из Forge отвергается на старте", () => {
  assert.throws(
    () => loadConfig({ FORGE_AGENT_KEY: "просто строка" }),
    /fga_/,
  );
});

test("ключ читается из файла", () => {
  const dir = mkdtempSync(join(tmpdir(), "forge-mcp-"));
  const file = join(dir, "key");
  writeFileSync(file, `${KEY}\n`);
  const config = loadConfig({ FORGE_AGENT_KEY_FILE: file });
  assert.equal(config.key.expose(), KEY);
});

test("пропавший файл с ключом объясняется, а не падает стеком", () => {
  assert.throws(
    () => loadConfig({ FORGE_AGENT_KEY_FILE: "/нет/такого/файла" }),
    (error: unknown) => error instanceof ConfigError && /Не читается файл/.test(error.message),
  );
});

test("переменная сильнее файла", () => {
  const dir = mkdtempSync(join(tmpdir(), "forge-mcp-"));
  const file = join(dir, "key");
  writeFileSync(file, "fga_из_файла_но_длинный_достаточно");
  const config = loadConfig({ FORGE_AGENT_KEY: KEY, FORGE_AGENT_KEY_FILE: file });
  assert.equal(config.key.expose(), KEY);
});

test("адрес API по умолчанию, завершающий слэш снимается", () => {
  assert.equal(loadConfig({ FORGE_AGENT_KEY: KEY }).apiUrl, DEFAULT_API_URL);
  assert.equal(
    loadConfig({ FORGE_AGENT_KEY: KEY, FORGE_API_URL: "https://forge.example/api/v1/" }).apiUrl,
    "https://forge.example/api/v1",
  );
});

test("негодный адрес и негодный таймаут объясняются", () => {
  assert.throws(() => loadConfig({ FORGE_AGENT_KEY: KEY, FORGE_API_URL: "форж" }), /FORGE_API_URL/);
  assert.throws(
    () => loadConfig({ FORGE_AGENT_KEY: KEY, FORGE_API_URL: "ftp://forge" }),
    /http/,
  );
  assert.throws(
    () => loadConfig({ FORGE_AGENT_KEY: KEY, FORGE_TIMEOUT_MS: "скоро" }),
    /FORGE_TIMEOUT_MS/,
  );
  assert.equal(loadConfig({ FORGE_AGENT_KEY: KEY }).timeoutMs, DEFAULT_TIMEOUT_MS);
});
