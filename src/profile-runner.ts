#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { loadProfileStore, profileEnvironment, profileStorePath } from "./profiles.js";
import { rememberSecret } from "./secret.js";
import { runStdio } from "./transport/stdio.js";

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug || slug === "--help" || slug === "-h") {
    process.stdout.write(
      "forge-mcp-profile <profile>\n\nЗапускает Forge MCP с профилем из " +
        `${profileStorePath()}. Профили создаёт forge-mcp-setup.\n`,
    );
    return;
  }
  const profile = loadProfileStore().profiles[slug];
  if (!profile) {
    throw new Error(`Профиль «${slug}» не найден. Запустите forge-mcp-setup.`);
  }
  const config = loadConfig({ ...process.env, ...profileEnvironment(profile) });
  rememberSecret(config.key);
  await runStdio(config);
}

main().catch((error: unknown) => {
  process.stderr.write(`forge-mcp-profile: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
