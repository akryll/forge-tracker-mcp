import { inspect } from "node:util";

/** Что показывают вместо ключа везде, где строка может уйти наружу. */
export const REDACTED = "«ключ скрыт»";

/**
 * Ключ агента в обёртке, которую нельзя случайно распечатать. Достать
 * значение можно только через `expose()` — это единственное место, где ключ
 * покидает обёртку, и оно вызывается ровно в одном месте: при сборке
 * заголовка запроса к Forge.
 *
 * Приведение к строке, `JSON.stringify` и `console.log` отдают заглушку, а не
 * ключ, — иначе он утёк бы в лог из первого же `console.log(config)`.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  expose(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  get [Symbol.toStringTag](): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}

/**
 * Ключи Forge — `fga_` и 43 символа base64url. Ищем только длинные строки:
 * подсказка ключа (`hint` в API) — это первые несколько символов открытым
 * текстом, её Forge показывает человеку намеренно, и затирать её не нужно.
 */
const KEY_PATTERN = /fga_[A-Za-z0-9_-]{20,}/g;

let configuredKey: string | null = null;

/**
 * Запомнить ключ, чтобы затирать его дословно, — на случай, если он попадёт
 * в текст в изменённом виде и не подойдёт под шаблон.
 */
export function rememberSecret(secret: Secret): void {
  configuredKey = secret.expose();
}

/** Только для тестов: забыть запомненный ключ. */
export function forgetSecret(): void {
  configuredKey = null;
}

/**
 * Затирает ключ в любом тексте, который уходит агенту или в лог. Последний
 * рубеж: даже если ключ попадёт в сообщение об ошибке от Forge или в стек
 * вызовов, наружу он не выйдет.
 */
export function redact(text: string): string {
  let result = text.replace(KEY_PATTERN, REDACTED);
  if (configuredKey && configuredKey.length > 0) {
    result = result.split(configuredKey).join(REDACTED);
  }
  return result;
}
