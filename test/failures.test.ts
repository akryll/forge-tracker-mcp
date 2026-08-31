import test from "node:test";
import assert from "node:assert/strict";
import { harness, KEY } from "./harness.js";
import type { Routes } from "./fake-forge.js";

const ME = { id: 518, name: "Клод", has_avatar: false };

const TASK = {
  id: 6129,
  title: "Понятные отказы",
  status: "in_progress",
  priority: "medium",
  assignee: ME,
  blocked_by_ids: [],
  blocks_open: 0,
  position: 1,
  created_at: "2026-08-30T19:26:21+03:00",
  updated_at: "2026-08-30T19:26:21+03:00",
};

const emptyQueue: Routes = {
  "GET /agent/tasks": () => ({
    status: 200,
    json: { agent: { id: 516, name: "Claude2" }, member: ME, tasks: [] },
  }),
};

function fails(path: string, status: number, code: string, message: string): Routes {
  return { ...emptyQueue, [path]: () => ({ status, json: { code, message } }) };
}

test("401: ключ отозван или неверен, и это сказано прямо", async () => {
  const h = await harness(
    fails("POST /agent/tasks/6129/claim", 401, "unauthorized", "Ключ не действует"),
  );
  try {
    const { text, isError } = await h.call("forge_task_claim", { task_id: 6129 });
    assert.equal(isError, true);
    assert.match(text, /отозван или введён неверно/);
    assert.match(text, /\/agents/);
    assert.ok(!text.includes(KEY));
  } finally {
    await h.close();
  }
});

test("404 на чужую задачу — граница прав, а не поломка", async () => {
  const h = await harness(
    fails("PATCH /agent/tasks/999", 404, "not_found", "Задача вам не назначена"),
  );
  try {
    const { text } = await h.call("forge_task_report", { task_id: 999, status: "review" });
    assert.match(text, /Задача #999 вам не назначена либо она в другом проекте/);
    assert.match(text, /граница прав, а не поломка/);
    assert.match(text, /forge_tasks_list/);
  } finally {
    await h.close();
  }
});

test("404 на возврат говорит о другом: задача за вами не числится", async () => {
  const h = await harness(
    fails("POST /agent/tasks/6129/release", 404, "not_found", "Задача за вами не числится"),
  );
  try {
    const { text } = await h.call("forge_task_release", { task_id: 6129 });
    assert.match(text, /за вами не числится — возвращать нечего/);
  } finally {
    await h.close();
  }
});

test("404 на вердикт объясняет, кто его закрепляет", async () => {
  const h = await harness(
    fails("POST /agent/tasks/6129/verify", 404, "not_found", "Задача не найдена"),
  );
  try {
    const { text } = await h.call("forge_task_verify", { task_id: 6129 });
    assert.match(text, /не назначена тестировщиком/);
    assert.match(text, /назначает человек/);
  } finally {
    await h.close();
  }
});

test("409 на взятие: задачу уже взял другой экземпляр агента", async () => {
  const h = await harness(
    fails("POST /agent/tasks/6129/claim", 409, "conflict", "Задача уже в работе"),
  );
  try {
    const { text } = await h.call("forge_task_claim", { task_id: 6129 });
    assert.match(text, /уже взята другим экземпляром агента/);
    assert.match(text, /Возьмите другую из очереди/);
  } finally {
    await h.close();
  }
});

test("409 на вердикт: задача не на проверке", async () => {
  const h = await harness(
    fails("POST /agent/tasks/6129/verify", 409, "conflict", "Задача не на проверке"),
  );
  try {
    const { text } = await h.call("forge_task_verify", { task_id: 6129 });
    assert.match(text, /не на проверке/);
    assert.match(text, /исход проверки закрепляют на сданной работе/);
  } finally {
    await h.close();
  }
});

test("400 про проект объясняет, что ключ ограничен своим", async () => {
  const h = await harness(
    fails("POST /agent/tasks", 400, "validation", "Проект не совпадает с проектом ключа"),
  );
  try {
    const { text } = await h.call("forge_task_create", { title: "Что-нибудь" });
    assert.match(text, /Проект не совпадает с проектом ключа/);
    assert.match(text, /Ключ ограничен своим проектом/);
  } finally {
    await h.close();
  }
});

test("400 про «готово» проходит словами Forge — они уже объясняют", async () => {
  const h = await harness(
    fails(
      "PATCH /agent/tasks/6129",
      400,
      "validation",
      "Агент не может закрыть задачу: «готово» ставит человек при принятии",
    ),
  );
  try {
    const { text } = await h.call("forge_task_report", { task_id: 6129, status: "review" });
    assert.match(text, /«готово» ставит человек при принятии/);
  } finally {
    await h.close();
  }
});

test("500 разведён с границей прав: это сбой Forge", async () => {
  const h = await harness(
    fails("POST /tasks/6129/comments", 500, "internal", "Не удалось записать комментарий"),
  );
  try {
    const { text } = await h.call("forge_comment_add", { task_id: 6129, body: "Готово" });
    assert.match(text, /сбой на стороне Forge, а не граница прав/);
  } finally {
    await h.close();
  }
});

test("лишнее поле отвергается, а не молча выбрасывается", async () => {
  const h = await harness(emptyQueue);
  try {
    const { text, isError } = await h.call("forge_task_report", {
      task_id: 6129,
      status: "review",
      // Агент, решивший, что умеет переименовывать задачи, должен узнать
      // об этом из ответа, а не из того, что ничего не изменилось.
      title: "Новое название",
    });
    assert.equal(isError, true);
    assert.match(text, /Такого поля у инструмента нет/);
    assert.match(text, /title/);
    assert.equal(h.forge.requests.length, 0);
  } finally {
    await h.close();
  }
});

test("недоверенный статус отвергается объяснением, а не английским разбором схемы", async () => {
  const h = await harness(emptyQueue);
  try {
    const { text, isError } = await h.call("forge_task_report", {
      task_id: 6129,
      status: "done",
    });
    assert.equal(isError, true);
    assert.match(text, /«Готово» ставит человек при приёмке/);
    assert.match(text, /forge_task_verify/);
    assert.equal(h.forge.requests.length, 0);
  } finally {
    await h.close();
  }
});

test("заблокированная задача предупреждает о блокерах", async () => {
  const h = await harness({
    "GET /agent/tasks": () => ({
      status: 200,
      json: {
        agent: { id: 516, name: "Claude2" },
        member: ME,
        tasks: [
          {
            ...TASK,
            blocked_by_ids: [6127, 6128],
            blocked_by: [
              { id: 6127, title: "Результаты работы", status: "review" },
              { id: 6128, title: "Тестировщик", status: "review" },
            ],
            blocking: [],
          },
        ],
      },
    }),
  });
  try {
    const list = await h.call("forge_tasks_list");
    assert.match(list.text, /заблокирована: ждёт #6127, #6128/);
    assert.match(list.text, /сначала спросите человека/);

    // В карточке — разбор, а не та же короткая строка.
    const card = await h.call("forge_tasks_list", { task_id: 6129 });
    assert.match(card.text, /Заблокирована, ждёт:/);
    assert.match(card.text, /#6127/);
    assert.match(card.text, /#6128/);
  } finally {
    await h.close();
  }
});

test("ключа нет ни в одном сообщении об отказе", async () => {
  // Forge, который эхом возвращает заголовок: так ключ и утёк бы наружу.
  const h = await harness({
    ...emptyQueue,
    "POST /agent/tasks/6129/claim": () => ({
      status: 500,
      json: { code: "internal", message: `Сбой при обработке X-Agent-Key: ${KEY}` },
    }),
  });
  try {
    const { text } = await h.call("forge_task_claim", { task_id: 6129 });
    assert.ok(!text.includes(KEY), "ключ вышел наружу в сообщении об ошибке");
    assert.match(text, /«ключ скрыт»/);
  } finally {
    await h.close();
  }
});
