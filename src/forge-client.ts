import type { Config } from "./config.js";
import { redact } from "./secret.js";

/** Коды ошибок, которые отдаёт Forge (`Error.code` в спецификации). */
export type ForgeErrorCode =
  | "not_found"
  | "validation"
  | "conflict"
  | "unauthorized"
  | "forbidden"
  | "too_many_requests"
  | "internal";

/**
 * Отказ от Forge. `status` и `code` нужны верхнему слою, чтобы объяснить
 * агенту, что произошло: «404 на чужую задачу» — это граница прав, а не сбой.
 */
export class ForgeApiError extends Error {
  readonly status: number;
  readonly code: ForgeErrorCode | "network" | "unknown";

  constructor(status: number, code: ForgeApiError["code"], message: string) {
    super(redact(message));
    this.name = "ForgeApiError";
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {
  readonly method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly body?: unknown;
  /** Что готовы принять. По умолчанию JSON. */
  readonly accept?: string;
}

/**
 * Единственное место, где живёт `X-Agent-Key`. Инструменты ходят в Forge
 * только отсюда и ключа не видят.
 */
export class ForgeClient {
  readonly #config: Config;

  constructor(config: Config) {
    this.#config = config;
  }

  /** Адрес API без ключа — его не стыдно показать в сообщении об ошибке. */
  get apiUrl(): string {
    return this.#config.apiUrl;
  }

  async requestText(path: string, options: RequestOptions = {}): Promise<string> {
    const response = await this.#send(path, options);
    return await this.#readText(response);
  }

  async requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.#send(path, options);
    const text = await this.#readText(response);
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ForgeApiError(
        response.status,
        "unknown",
        `Forge ответил не JSON на ${path}. Похоже, по адресу ${this.#config.apiUrl} стоит не Forge.`,
      );
    }
  }

  async #send(path: string, options: RequestOptions): Promise<Response> {
    const url = `${this.#config.apiUrl}${path}`;
    const headers: Record<string, string> = {
      // Ключ достают из обёртки ровно здесь и больше нигде.
      "X-Agent-Key": this.#config.key.expose(),
      Accept: options.accept ?? "application/json",
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(this.#config.timeoutMs),
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.name : "неизвестная причина";
      const explanation =
        reason === "TimeoutError"
          ? `Forge не ответил за ${this.#config.timeoutMs} мс`
          : `Не удалось достучаться до Forge`;
      // Текст ошибки fetch сюда не тащим: он может содержать заголовки.
      throw new ForgeApiError(0, "network", `${explanation} (${this.#config.apiUrl}).`);
    }

    if (!response.ok) {
      throw await this.#toError(response, path);
    }
    return response;
  }

  async #toError(response: Response, path: string): Promise<ForgeApiError> {
    const text = await this.#readText(response).catch(() => "");
    let code: ForgeApiError["code"] = "unknown";
    let message = "";
    try {
      const parsed = JSON.parse(text) as { code?: string; message?: string };
      if (typeof parsed.code === "string") code = parsed.code as ForgeErrorCode;
      if (typeof parsed.message === "string") message = parsed.message;
    } catch {
      // Не JSON — значит, отвечал не Forge, а что-то между нами: прокси,
      // балансировщик, чужой сервис. Сообщение собираем сами.
    }
    if (!message) {
      message = `Forge ответил ${response.status} на ${path}`;
    }
    return new ForgeApiError(response.status, code, message);
  }

  async #readText(response: Response): Promise<string> {
    // Ответ Forge может содержать что угодно, включая эхо запроса, поэтому
    // затираем ключ и здесь — до того, как текст пойдёт дальше.
    return redact(await response.text());
  }
}
