import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeJsonServer } from "../src/setup/clients.js";

test("настройка клиента сохраняет чужие поля и делает backup", () => {
  const directory = mkdtempSync(join(tmpdir(), "forge-client-"));
  const path = join(directory, "mcp.json");
  writeFileSync(path, JSON.stringify({ theme: "dark", mcpServers: { other: { command: "other" } } }));

  const result = mergeJsonServer(path, "mcpServers", "forge-work", {
    command: "/usr/bin/node",
    args: ["/opt/forge/profile-runner.js", "work"],
  });
  const written = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  assert.equal(written.theme, "dark");
  assert.deepEqual(written.mcpServers, {
    other: { command: "other" },
    "forge-work": {
      command: "/usr/bin/node",
      args: ["/opt/forge/profile-runner.js", "work"],
    },
  });
  assert.ok(result.backupPath);
  assert.match(readFileSync(result.backupPath, "utf8"), /other/);
});

test("невалидный клиентский JSON не перезаписывается", () => {
  const directory = mkdtempSync(join(tmpdir(), "forge-client-invalid-"));
  const path = join(directory, "mcp.json");
  writeFileSync(path, "{ broken");
  assert.throws(() => mergeJsonServer(path, "mcpServers", "forge", { command: "node" }), /невалидный JSON/);
  assert.equal(readFileSync(path, "utf8"), "{ broken");
});
