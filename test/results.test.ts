import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness } from "./harness.js";

/** Настоящий PNG в один пиксель — чтобы проверялась сигнатура, а не расширение. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function scratch(name: string, bytes: Buffer | string): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-mcp-"));
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

test("комментарий подписан ключом, а не текстом", async () => {
  const h = await harness({
    "POST /tasks/6127/comments": () => ({
      status: 201,
      json: { id: 1, author_name: "Claude2", created_at: "2026-08-30T21:00:00+03:00" },
    }),
  });
  try {
    const { text, isError } = await h.call("forge_comment_add", {
      task_id: 6127,
      body: "Готово, отчёт приложен.",
    });
    assert.equal(isError, false);
    assert.match(text, /за подписью «Claude2»/);
    assert.deepEqual(JSON.parse(h.forge.requests[0]?.body ?? "{}"), {
      body: "Готово, отчёт приложен.",
    });
  } finally {
    await h.close();
  }
});

test("переписка читается целиком, ответ человека отличим от записи агента", async () => {
  const h = await harness({
    "GET /tasks/6127/comments": () => ({
      status: 200,
      json: [
        {
          id: 1,
          author_name: "Claude2",
          by_agent: true,
          body: "Какой стек брать?",
          created_at: "2026-08-30T21:00:00+03:00",
        },
        {
          id: 2,
          author_name: "Антон",
          by_agent: false,
          body: "Бери предложенный.",
          created_at: "2026-08-30T21:05:00+03:00",
        },
      ],
    }),
  });
  try {
    const { text, isError } = await h.call("forge_comments_list", { task_id: 6127 });
    assert.equal(isError, false);
    // Порядок сохраняется: переписку читают сверху вниз.
    assert.ok(text.indexOf("Какой стек брать?") < text.indexOf("Бери предложенный."));
    assert.match(text, /Claude2 \(агент\)/);
    assert.match(text, /— Антон, /);
    assert.doesNotMatch(text, /Антон \(агент\)/);
  } finally {
    await h.close();
  }
});

test("пустая переписка проговаривается словами", async () => {
  const h = await harness({ "GET /tasks/6127/comments": () => ({ status: 200, json: [] }) });
  try {
    const { text } = await h.call("forge_comments_list", { task_id: 6127 });
    assert.match(text, /ещё ничего не написано/);
  } finally {
    await h.close();
  }
});

test("переписка чужой задачи не отдаётся", async () => {
  const h = await harness({
    "GET /tasks/1/comments": () => ({
      status: 404,
      json: { code: "not_found", message: "Задача не найдена" },
    }),
  });
  try {
    const { text, isError } = await h.call("forge_comments_list", { task_id: 1 });
    assert.equal(isError, true);
    // Граница здесь по проекту ключа, а не по назначению: говорить про
    // «не назначена» было бы неправдой — переписка коллеги по проекту видна.
    assert.match(text, /не найдена в вашем проекте/);
    assert.doesNotMatch(text, /не назначена/);
  } finally {
    await h.close();
  }
});

test("одноимённый документ заменяется, а не кладётся вторым", async () => {
  let put = 0;
  const h = await harness({
    "PUT /tasks/6127/documents": () => {
      put += 1;
      return {
        status: 200,
        json: {
          id: 7,
          filename: "Результат.md",
          author_name: "Claude2",
          by_agent: true,
          size: 12,
          created_at: "2026-08-30T21:00:00+03:00",
          content: "Готово",
        },
      };
    },
    "GET /tasks/6127/documents": () => ({
      status: 200,
      json: [
        {
          id: 7,
          filename: "Результат.md",
          author_name: "Claude2",
          by_agent: true,
          size: 12,
          created_at: "2026-08-30T21:00:00+03:00",
        },
      ],
    }),
  });
  try {
    await h.call("forge_document_put", {
      task_id: 6127,
      filename: "Результат.md",
      content: "Первый",
    });
    await h.call("forge_document_put", {
      task_id: 6127,
      filename: "Результат.md",
      content: "Второй",
    });
    assert.equal(put, 2);
    // Метод именно PUT: повторная выкладка — замена, а не второй файл.
    assert.deepEqual(
      h.forge.requests.map((request) => request.method),
      ["PUT", "PUT"],
    );

    const { text } = await h.call("forge_documents_list", { task_id: 6127 });
    assert.match(text, /#7 Результат\.md/);
    assert.equal(text.match(/Результат\.md/g)?.length, 1);
  } finally {
    await h.close();
  }
});

test("документ не из markdown до Forge не доходит", async () => {
  const h = await harness({});
  try {
    // Схема отбивает такое сама: обработчик даже не зовётся.
    const { text, isError } = await h.call("forge_document_put", {
      task_id: 6127,
      filename: "отчёт.txt",
      content: "текст",
    });
    assert.equal(isError, true);
    assert.match(text, /markdown/);
    assert.equal(h.forge.requests.length, 0);
  } finally {
    await h.close();
  }
});

test("скриншот кодируется сам, тип берётся из содержимого", async () => {
  const h = await harness({
    "POST /tasks/6127/screenshots": () => ({
      status: 201,
      json: { id: 3, filename: "фильтры.png", content_type: "image/png", size: PNG.length },
    }),
  });
  try {
    // Расширение врёт — сигнатура нет: инструмент должен верить содержимому.
    const { text, isError } = await h.call("forge_screenshot_add", {
      task_id: 6127,
      path: scratch("снимок.bin", PNG),
      filename: "фильтры.png",
    });
    assert.equal(isError, false);
    assert.match(text, /Скриншот «фильтры\.png» приложен/);

    const sent = JSON.parse(h.forge.requests[0]?.body ?? "{}") as Record<string, string>;
    assert.equal(sent.content_type, "image/png");
    assert.equal(sent.filename, "фильтры.png");
    assert.deepEqual(Buffer.from(sent.data ?? "", "base64"), PNG);
  } finally {
    await h.close();
  }
});

test("слишком большой скриншот отвергается объяснением, а не обрывом", async () => {
  const h = await harness({}, { FORGE_MAX_SCREENSHOT_BYTES: "1024" });
  try {
    const { text, isError } = await h.call("forge_screenshot_add", {
      task_id: 6127,
      path: scratch("большой.png", Buffer.alloc(4096, 1)),
    });
    assert.equal(isError, true);
    assert.match(text, /не влезает в лимит/);
    // До Forge запрос не дошёл: незачем гонять по сети то, что заведомо отвергнут.
    assert.equal(h.forge.requests.length, 0);
  } finally {
    await h.close();
  }
});

test("не картинка отвергается до отправки", async () => {
  const h = await harness({});
  try {
    const { text, isError } = await h.call("forge_screenshot_add", {
      task_id: 6127,
      path: scratch("отчёт.doc", "просто текст"),
    });
    assert.equal(isError, true);
    assert.match(text, /png, jpeg, webp и gif/);
    assert.equal(h.forge.requests.length, 0);
  } finally {
    await h.close();
  }
});

test("пропавший файл объясняется путём", async () => {
  const h = await harness({});
  try {
    const { text, isError } = await h.call("forge_screenshot_add", {
      task_id: 6127,
      path: "/нет/такой/картинки.png",
    });
    assert.equal(isError, true);
    assert.match(text, /Файл не найден/);
  } finally {
    await h.close();
  }
});
