import { stat, readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { ForgeClient } from "./forge-client.js";

export interface Comment {
  readonly id: number;
  readonly author_name: string;
  readonly created_at: string;
}

export interface DocumentMeta {
  readonly id: number;
  readonly filename: string;
  readonly author_name: string;
  readonly by_agent: boolean;
  readonly size: number;
  readonly created_at: string;
}

export interface DocumentContent extends DocumentMeta {
  readonly content: string;
}

export interface Screenshot {
  readonly id: number;
  readonly filename: string;
  readonly content_type: string;
  readonly size: number;
}

/** Типы, которые принимает Forge. Чужой формат отвергаем до отправки. */
const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * Тип по содержимому, а не по имени: расширение врёт чаще, чем сигнатура,
 * а Forge отвергает картинку по типу, и разбираться в отказе будет агент.
 */
function sniff(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 3).toString("latin1") === "GIF") return "image/gif";
  if (
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Скриншот не влез в лимит либо оказался не картинкой. */
export class ScreenshotError extends Error {}

export class ResultsService {
  readonly #client: ForgeClient;
  readonly #maxScreenshotBytes: number;

  constructor(client: ForgeClient, maxScreenshotBytes: number) {
    this.#client = client;
    this.#maxScreenshotBytes = maxScreenshotBytes;
  }

  async addComment(taskId: number, body: string): Promise<Comment> {
    return await this.#client.requestJson<Comment>(`/tasks/${taskId}/comments`, {
      method: "POST",
      body: { body },
    });
  }

  async putDocument(taskId: number, filename: string, content: string): Promise<DocumentContent> {
    return await this.#client.requestJson<DocumentContent>(`/tasks/${taskId}/documents`, {
      method: "PUT",
      body: { filename, content },
    });
  }

  async listDocuments(taskId: number): Promise<DocumentMeta[]> {
    return await this.#client.requestJson<DocumentMeta[]>(`/tasks/${taskId}/documents`);
  }

  async getDocument(taskId: number, documentId: number): Promise<DocumentContent> {
    return await this.#client.requestJson<DocumentContent>(
      `/tasks/${taskId}/documents/${documentId}`,
    );
  }

  /**
   * Кодирование base64 берём на себя: возиться с ним агенту незачем, а
   * попытка передать двоичный файл через модель — верный способ его испортить.
   */
  async addScreenshot(taskId: number, path: string, filename?: string): Promise<Screenshot> {
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      throw new ScreenshotError(`Файл не найден: ${path}`);
    }
    // Размер проверяем до чтения: тащить в память 200 МБ, чтобы узнать, что
    // они не влезут, — плохая идея.
    if (size > this.#maxScreenshotBytes) {
      const mb = (value: number) => (value / (1024 * 1024)).toFixed(1);
      throw new ScreenshotError(
        `Скриншот ${mb(size)} МБ не влезает в лимит ${mb(this.#maxScreenshotBytes)} МБ. ` +
          `Уменьшите картинку или снимите не весь экран, а нужную его часть.`,
      );
    }

    const bytes = await readFile(path);
    const contentType = sniff(bytes) ?? CONTENT_TYPES[extname(path).toLowerCase()];
    if (!contentType) {
      throw new ScreenshotError(
        `Это не похоже на картинку. Forge принимает png, jpeg, webp и gif.`,
      );
    }

    return await this.#client.requestJson<Screenshot>(`/tasks/${taskId}/screenshots`, {
      method: "POST",
      body: {
        // Имя без путей — того же требует и Forge.
        filename: basename(filename ?? path),
        content_type: contentType,
        data: bytes.toString("base64"),
      },
    });
  }
}
