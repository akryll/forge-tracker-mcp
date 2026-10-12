import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyProfileStore,
  loadProfileStore,
  nodeVersionSupported,
  profileEnvironment,
  profileStorePath,
  publicProfile,
  removeProfile,
  saveProfileStore,
  suggestProfileSlug,
  upsertProfile,
} from "../src/profiles.js";

const KEY = "fga_test-key-not-a-real-one-0000000000000000000";

test("профили сохраняются атомарно, читаются и не раскрывают ключ", () => {
  const directory = mkdtempSync(join(tmpdir(), "forge-profiles-"));
  const path = join(directory, "nested", "profiles.json");
  const stored = upsertProfile(
    emptyProfileStore(),
    "claude-work",
    { name: "Claude / работа", apiUrl: "https://forge.example/api/v1/", agentKey: KEY },
    new Date("2026-01-02T03:04:05.000Z"),
  );
  saveProfileStore(stored, path);

  const loaded = loadProfileStore(path);
  const profile = loaded.profiles["claude-work"];
  assert.ok(profile);
  assert.equal(profile.apiUrl, "https://forge.example/api/v1");
  assert.equal(profileEnvironment(profile).FORGE_AGENT_KEY, KEY);
  assert.doesNotMatch(JSON.stringify(publicProfile("claude-work", profile)), /test-key/);
  if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.match(readFileSync(path, "utf8"), /claude-work/);

  assert.deepEqual(removeProfile(loaded, "claude-work").profiles, {});
});

test("путь профилей учитывает XDG, Windows и явное переопределение", () => {
  assert.equal(profileStorePath({ FORGE_MCP_CONFIG: "/custom/file" }, "linux", "/home/u"), "/custom/file");
  assert.equal(profileStorePath({ XDG_CONFIG_HOME: "/xdg" }, "linux", "/home/u"), "/xdg/forge-mcp/profiles.json");
  assert.equal(profileStorePath({ APPDATA: "C:\\Users\\u\\AppData" }, "win32", "C:\\Users\\u"), join("C:\\Users\\u\\AppData", "forge-mcp", "profiles.json"));
});

test("валидация профиля и версии Node.js", () => {
  assert.throws(() => upsertProfile(emptyProfileStore(), "Bad slug", { name: "x", agentKey: KEY }), /Идентификатор/);
  assert.throws(() => upsertProfile(emptyProfileStore(), "ok", { name: "x", agentKey: "secret" }), /fga_/);
  assert.equal(suggestProfileSlug("  My Claude / Work "), "my-claude-work");
  assert.equal(nodeVersionSupported("20.10.0"), false);
  assert.equal(nodeVersionSupported("20.11.0"), true);
  assert.equal(nodeVersionSupported("22.0.0"), true);
});
