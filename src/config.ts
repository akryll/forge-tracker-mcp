import { readFileSync } from "node:fs";
import { Secret } from "./secret.js";

/** Настройки сервера. Ключ — в обёртке, наружу отдаётся только заглушка. */
export interface Config {
  /** Корень агентского API Forge, без завершающего слэша. */
  readonly apiUrl: string;
  readonly key: Secret;
  /** Потолок на один запрос к Forge, мс. */
  readonly timeoutMs: number;
  /** Потолок на скриншот, байт. Совпадает с лимитом Forge по умолчанию. */
  readonly maxScreenshotBytes: number;
}

export const DEFAULT_API_URL = "http://localhost:8090/api/v1";
export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

/**
 * Сервер не поднялся из-за настроек. Отдельный тип, чтобы точка входа могла
 * показать человеку понятную строку, а не стек вызовов.
 */
export class ConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

function readKey(env: Env): string {
  const inline = env.FORGE_AGENT_KEY?.trim();
  const path = env.FORGE_AGENT_KEY_FILE?.trim();

  // Переменная сильнее файла: её задают точечно для одного запуска, файл —
  // общая настройка машины.
  if (inline) return inline;

  if (path) {
    let contents: string;
    try {
      contents = readFileSync(path, "utf8");
    } catch (cause) {
      throw new ConfigError(
        `Не читается файл с ключом агента: ${path}. Укажите путь в FORGE_AGENT_KEY_FILE ` +
          `или передайте ключ переменной FORGE_AGENT_KEY.`,
        { cause },
      );
    }
    const key = contents.trim();
    if (!key) {
      throw new ConfigError(`Файл с ключом агента пуст: ${path}.`);
    }
    return key;
  }

  throw new ConfigError(
    "Не задан ключ агента. Укажите его переменной FORGE_AGENT_KEY либо положите в файл " +
      "и укажите путь в FORGE_AGENT_KEY_FILE. Ключ выдаёт человек на странице /agents в Forge.",
  );
}

function readApiUrl(env: Env): string {
  const raw = env.FORGE_API_URL?.trim() || DEFAULT_API_URL;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigError(
      `FORGE_API_URL не похож на адрес: ${raw}. Ожидается что-то вроде ${DEFAULT_API_URL}.`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConfigError(`FORGE_API_URL должен быть http или https, а не ${parsed.protocol}`);
  }
  return parsed.toString().replace(/\/+$/, "");
}

function readPositive(env: Env, name: string, fallback: number, units: string): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${name} должен быть целым числом ${units}, а не «${raw}»`);
  }
  return value;
}

/**
 * Собирает настройки из окружения. Без ключа сервер не стартует: молчаливый
 * запуск с неработающими инструментами хуже честного отказа на старте.
 */
export function loadConfig(env: Env = process.env): Config {
  const key = readKey(env);
  if (!key.startsWith("fga_")) {
    throw new ConfigError(
      "Ключ агента не похож на ключ Forge: такие ключи начинаются с «fga_». " +
        "Проверьте, что скопирована вся строка целиком.",
    );
  }
  return {
    apiUrl: readApiUrl(env),
    key: new Secret(key),
    timeoutMs: readPositive(env, "FORGE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, "миллисекунд"),
    maxScreenshotBytes: readPositive(
      env,
      "FORGE_MAX_SCREENSHOT_BYTES",
      DEFAULT_MAX_SCREENSHOT_BYTES,
      "байт",
    ),
  };
}
