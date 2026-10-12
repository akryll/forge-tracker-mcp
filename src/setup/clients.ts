import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { ProfileError } from "../profiles.js";

export type ClientId =
  | "claude-code"
  | "codex"
  | "claude-desktop"
  | "cursor"
  | "gemini"
  | "vscode"
  | "generic";

export interface ClientChoice {
  readonly id: ClientId;
  readonly label: string;
  readonly hint: string;
  readonly detected: boolean;
}

export interface ServerCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export interface InstallResult {
  readonly summary: string;
  readonly path?: string;
  readonly backupPath?: string;
  readonly preview?: string;
}

function executableExists(name: string): boolean {
  const result = spawnSync(process.platform === "win32" ? "where" : "which", [name], {
    stdio: "ignore",
  });
  return result.status === 0;
}

export function clientChoices(): ClientChoice[] {
  return [
    {
      id: "claude-code",
      label: "Claude Code",
      hint: "глобально через claude mcp",
      detected: executableExists("claude"),
    },
    {
      id: "codex",
      label: "Codex CLI / IDE",
      hint: "общая конфигурация через codex mcp",
      detected: executableExists("codex"),
    },
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      hint: "пользовательский JSON",
      detected: existsSync(dirname(claudeDesktopConfigPath())),
    },
    {
      id: "cursor",
      label: "Cursor",
      hint: "~/.cursor/mcp.json",
      detected: existsSync(join(homedir(), ".cursor")),
    },
    {
      id: "gemini",
      label: "Gemini CLI",
      hint: "~/.gemini/settings.json",
      detected: executableExists("gemini") || existsSync(join(homedir(), ".gemini")),
    },
    {
      id: "vscode",
      label: "VS Code / GitHub Copilot",
      hint: "пользовательский mcp.json",
      detected: executableExists("code") || existsSync(vscodeConfigDir()),
    },
    {
      id: "generic",
      label: "Другой MCP-клиент",
      hint: "показать готовый JSON",
      detected: true,
    },
  ];
}

export function serverCommand(runnerPath: string, slug: string): ServerCommand {
  return { command: process.execPath, args: [runnerPath, slug] };
}

export function defaultServerName(slug: string): string {
  return slug === "forge" ? "forge" : `forge-${slug}`;
}

function assertServerName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(name)) {
    throw new ProfileError("Имя сервера: 1–64 латинских букв, цифр, точек, _ или -.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Сливает один сервер в JSON клиента, не трогая остальные настройки. */
export function mergeJsonServer(
  path: string,
  rootKey: "mcpServers" | "servers",
  name: string,
  server: Record<string, unknown>,
): InstallResult {
  assertServerName(name);
  let root: Record<string, unknown> = {};
  let originalMode = 0o600;
  let backupPath: string | undefined;
  if (existsSync(path)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (cause) {
      throw new ProfileError(
        `Файл ${path} содержит невалидный JSON. Исправьте его — мастер не будет перезаписывать файл вслепую.`,
        { cause },
      );
    }
    if (!isRecord(parsed)) throw new ProfileError(`В корне ${path} должен быть JSON-объект.`);
    root = parsed;
    originalMode = statSync(path).mode & 0o777;
    backupPath = `${path}.backup-${timestamp()}`;
    copyFileSync(path, backupPath);
  }
  const current = root[rootKey];
  if (current !== undefined && !isRecord(current)) {
    throw new ProfileError(`Поле ${rootKey} в ${path} должно быть JSON-объектом.`);
  }
  root[rootKey] = { ...(current ?? {}), [name]: server };
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(root, null, 2)}\n`, {
    encoding: "utf8",
    mode: originalMode,
  });
  renameSync(temporary, path);
  try {
    chmodSync(path, originalMode);
  } catch {
    // Windows управляет доступом через ACL.
  }
  return { summary: `Сервер «${name}» добавлен`, path, backupPath };
}

function claudeDesktopConfigPath(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "Claude", "claude_desktop_config.json");
}

function vscodeConfigDir(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Code", "User");
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Code", "User");
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "Code", "User");
}

function runClient(command: string, args: string[]): InstallResult {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) {
    throw new ProfileError(`Не удалось запустить ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "неизвестная ошибка").trim();
    throw new ProfileError(`${command} завершился с ошибкой: ${detail}`);
  }
  return { summary: (result.stdout || `Настройка ${command} сохранена.`).trim() };
}

export function installClient(
  client: ClientId,
  serverName: string,
  command: ServerCommand,
): InstallResult {
  assertServerName(serverName);
  const stdio = { type: "stdio", command: command.command, args: [...command.args] };
  switch (client) {
    case "claude-code":
      return runClient("claude", [
        "mcp",
        "add-json",
        "--scope",
        "user",
        serverName,
        JSON.stringify(stdio),
      ]);
    case "codex":
      return runClient("codex", ["mcp", "add", serverName, "--", command.command, ...command.args]);
    case "claude-desktop":
      return mergeJsonServer(claudeDesktopConfigPath(), "mcpServers", serverName, {
        command: command.command,
        args: [...command.args],
      });
    case "cursor":
      return mergeJsonServer(join(homedir(), ".cursor", "mcp.json"), "mcpServers", serverName, {
        command: command.command,
        args: [...command.args],
      });
    case "gemini":
      return mergeJsonServer(join(homedir(), ".gemini", "settings.json"), "mcpServers", serverName, {
        command: command.command,
        args: [...command.args],
      });
    case "vscode":
      return mergeJsonServer(join(vscodeConfigDir(), "mcp.json"), "servers", serverName, stdio);
    case "generic": {
      const preview = JSON.stringify({ mcpServers: { [serverName]: stdio } }, null, 2);
      return { summary: "Скопируйте этот фрагмент в конфигурацию MCP-клиента:", preview };
    }
  }
}
