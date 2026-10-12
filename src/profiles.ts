import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ConfigError, DEFAULT_API_URL, DEFAULT_TIMEOUT_MS } from "./config.js";

export const PROFILE_STORE_VERSION = 1;

export interface Profile {
  readonly name: string;
  readonly apiUrl: string;
  readonly agentKey: string;
  readonly timeoutMs: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProfileStore {
  readonly version: typeof PROFILE_STORE_VERSION;
  readonly profiles: Record<string, Profile>;
}

export interface ProfileInput {
  readonly name: string;
  readonly apiUrl?: string;
  readonly agentKey: string;
  readonly timeoutMs?: number;
}

export class ProfileError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProfileError";
  }
}

export function profileStorePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): string {
  if (env.FORGE_MCP_CONFIG?.trim()) return env.FORGE_MCP_CONFIG.trim();
  if (platform === "win32" && env.APPDATA?.trim()) {
    return join(env.APPDATA.trim(), "forge-mcp", "profiles.json");
  }
  const configHome = env.XDG_CONFIG_HOME?.trim() || join(home, ".config");
  return join(configHome, "forge-mcp", "profiles.json");
}

export function emptyProfileStore(): ProfileStore {
  return { version: PROFILE_STORE_VERSION, profiles: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateStoredProfile(slug: string, value: unknown): Profile {
  if (!isRecord(value)) throw new ProfileError(`Профиль «${slug}» повреждён.`);
  const { name, apiUrl, agentKey, timeoutMs, createdAt, updatedAt } = value;
  if (
    typeof name !== "string" ||
    typeof apiUrl !== "string" ||
    typeof agentKey !== "string" ||
    typeof timeoutMs !== "number" ||
    typeof createdAt !== "string" ||
    typeof updatedAt !== "string"
  ) {
    throw new ProfileError(`В профиле «${slug}» не хватает обязательных полей.`);
  }
  validateProfileInput({ name, apiUrl, agentKey, timeoutMs });
  return { name, apiUrl: normalizeApiUrl(apiUrl), agentKey, timeoutMs, createdAt, updatedAt };
}

export function loadProfileStore(path = profileStorePath()): ProfileStore {
  if (!existsSync(path)) return emptyProfileStore();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new ProfileError(`Не удалось прочитать хранилище профилей: ${path}`, { cause });
  }
  if (!isRecord(parsed) || parsed.version !== PROFILE_STORE_VERSION || !isRecord(parsed.profiles)) {
    throw new ProfileError(`Неподдерживаемый или повреждённый формат профилей: ${path}`);
  }
  const profiles: Record<string, Profile> = {};
  for (const [slug, value] of Object.entries(parsed.profiles)) {
    validateProfileSlug(slug);
    profiles[slug] = validateStoredProfile(slug, value);
  }
  return { version: PROFILE_STORE_VERSION, profiles };
}

/** Атомарная запись с закрытыми правами: в файле лежат ключи агентов. */
export function saveProfileStore(store: ProfileStore, path = profileStorePath()): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    chmodSync(directory, 0o700);
  } catch {
    // На Windows POSIX-права неприменимы; доступ ограничивает профиль пользователя.
  }
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, path);
    try {
      chmodSync(path, 0o600);
    } catch {
      // См. комментарий выше про Windows.
    }
  } catch (cause) {
    throw new ProfileError(`Не удалось сохранить профили в ${path}`, { cause });
  }
}

export function validateProfileSlug(slug: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(slug)) {
    throw new ProfileError(
      "Идентификатор профиля: 1–48 строчных латинских букв, цифр, _ или -, начиная с буквы/цифры.",
    );
  }
}

export function normalizeApiUrl(raw: string): string {
  const value = raw.trim() || DEFAULT_API_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProfileError(`Адрес Forge не похож на URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProfileError("Адрес Forge должен начинаться с http:// или https://");
  }
  return url.toString().replace(/\/+$/, "");
}

export function validateProfileInput(input: ProfileInput): void {
  if (!input.name.trim()) throw new ProfileError("Название профиля не может быть пустым.");
  if (!input.agentKey.trim().startsWith("fga_")) {
    throw new ProfileError("Ключ Forge должен начинаться с fga_.");
  }
  normalizeApiUrl(input.apiUrl ?? DEFAULT_API_URL);
  const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new ProfileError("Таймаут должен быть положительным целым числом миллисекунд.");
  }
}

export function upsertProfile(
  store: ProfileStore,
  slug: string,
  input: ProfileInput,
  now = new Date(),
): ProfileStore {
  validateProfileSlug(slug);
  validateProfileInput(input);
  const previous = store.profiles[slug];
  const timestamp = now.toISOString();
  const profile: Profile = {
    name: input.name.trim(),
    apiUrl: normalizeApiUrl(input.apiUrl ?? DEFAULT_API_URL),
    agentKey: input.agentKey.trim(),
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    createdAt: previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  return { ...store, profiles: { ...store.profiles, [slug]: profile } };
}

export function removeProfile(store: ProfileStore, slug: string): ProfileStore {
  if (!store.profiles[slug]) throw new ProfileError(`Профиль «${slug}» не найден.`);
  const profiles = { ...store.profiles };
  delete profiles[slug];
  return { ...store, profiles };
}

export function profileEnvironment(profile: Profile): Record<string, string> {
  return {
    FORGE_AGENT_KEY: profile.agentKey,
    FORGE_API_URL: profile.apiUrl,
    FORGE_TIMEOUT_MS: String(profile.timeoutMs),
  };
}

/** Безопасное представление: ключ не возвращается даже частично. */
export function publicProfile(slug: string, profile: Profile): Record<string, string | number> {
  return {
    id: slug,
    name: profile.name,
    apiUrl: profile.apiUrl,
    timeoutMs: profile.timeoutMs,
    key: "[СКРЫТО]",
  };
}

/** Проверяет профиль тем же безопасным GET, который первым делает MCP-клиент. */
export async function testProfile(profile: Profile): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${profile.apiUrl}/agent/guide`, {
      headers: { "X-Agent-Key": profile.agentKey, Accept: "text/markdown" },
      signal: AbortSignal.timeout(profile.timeoutMs),
    });
  } catch (cause) {
    const reason = cause instanceof Error && cause.name === "TimeoutError" ? "истёк таймаут" : "нет соединения";
    throw new ProfileError(`Проверка Forge не прошла: ${reason} (${profile.apiUrl}).`);
  }
  if (!response.ok) {
    throw new ProfileError(`Forge ответил HTTP ${response.status}. Проверьте адрес и ключ агента.`);
  }
}

/** Преобразует удобное человеку имя в стабильный идентификатор. */
export function suggestProfileSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "forge";
}

/** Проверяет версию рантайма без стороннего semver-пакета. */
export function nodeVersionSupported(version = process.versions.node): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 20 || (major === 20 && minor >= 11);
}

/** Конвертирует ошибки общей конфигурации в понятный тип мастера. */
export function asProfileError(error: unknown): ProfileError {
  if (error instanceof ProfileError) return error;
  if (error instanceof ConfigError) return new ProfileError(error.message, { cause: error });
  return new ProfileError(error instanceof Error ? error.message : String(error), { cause: error });
}
