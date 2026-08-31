import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.js";
import type { Routes } from "./fake-forge.js";

const ME = { id: 518, name: "Клод", has_avatar: false };
const HUMAN = { id: 42, name: "Антон", has_avatar: false };

const MINE = {
  id: 6125,
  title: "Каркас MCP-сервера",
  description: "Поднять сервер и отдать памятку.",
  status: "todo",
  priority: "high",
  assignee: ME,
  project: { id: 312, name: "Forge" },
  epic: { id: 197, name: "MCP и Skill" },
  agent_prompt: "Сначала прочитай постановку целиком.",
  blocked_by_ids: [],
  blocks_open: 2,
  position: 1,
  created_at: "2026-08-30T19:26:21+03:00",
  updated_at: "2026-08-30T19:26:21+03:00",
};

const TO_TEST = {
  ...MINE,
  id: 6099,
  title: "Фильтры на странице задач",
  description: "Проверить вёрстку фильтров.",
  status: "review",
  assignee: HUMAN,
  tester: ME,
  agent_prompt: null,
  blocked_by_ids: [6100],
};

function queue(tasks: unknown[]): Routes["x"] {
  return () => ({
    status: 200,
    json: { agent: { id: 516, name: "Claude2" }, member: ME, tasks },
  });
}

test("очередь показывает мою роль в каждой задаче", async () => {
  const h = await harness({ "GET /agent/tasks": queue([MINE, TO_TEST]) });
  try {
    const { text, isError } = await h.call("forge_tasks_list");
    assert.equal(isError, false);
    assert.match(text, /#6125 Каркас MCP-сервера/);
    assert.match(text, /роль: исполнитель/);
    assert.match(text, /#6099 Фильтры/);
    assert.match(text, /роль: тестировщик/);
    // Блокеры видно сразу: закрывать такую задачу без человека не стоит.
    assert.match(text, /заблокирована: ждёт #6100/);
  } finally {
    await h.close();
  }
});

test("пустая очередь объясняется словами, а не пустотой", async () => {
  const h = await harness({ "GET /agent/tasks": queue([]) });
  try {
    const { text } = await h.call("forge_tasks_list");
    assert.match(text, /Назначенных задач нет/);
  } finally {
    await h.close();
  }
});

test("карточка показывает, чего задача ждёт и кто ждёт её", async () => {
  const BLOCKED = {
    ...MINE,
    blocked_by_ids: [6127, 6128],
    blocked_by: [
      { id: 6127, title: "Результаты работы", status: "review" },
      // Блокер уехал в другой проект: остался один номер.
      { id: 6128, title: null, status: null },
    ],
    blocking: [{ id: 6129, title: "Понятные отказы", status: "in_progress" }],
  };
  const h = await harness({ "GET /agent/tasks": queue([BLOCKED]) });
  try {
    const { text } = await h.call("forge_tasks_list", { task_id: 6125 });
    assert.match(text, /Заблокирована, ждёт:/);
    assert.match(text, /#6127 Результаты работы — на проверке/);
    assert.match(text, /#6128 — в другом проекте, подробностей не видно/);
    assert.match(text, /сначала спросите человека/);
    assert.match(text, /Её саму ждут:/);
    assert.match(text, /#6129 Понятные отказы — в работе/);
  } finally {
    await h.close();
  }
});

test("очередь остаётся читаемой: в списке номера, разбор — в карточке", async () => {
  const many = [6127, 6128, 6129, 6130, 6131];
  const BLOCKED = {
    ...MINE,
    blocked_by_ids: many,
    blocked_by: many.map((id) => ({ id, title: `Задача ${id}`, status: "todo" })),
    blocking: [],
  };
  const h = await harness({ "GET /agent/tasks": queue([BLOCKED]) });
  try {
    const { text } = await h.call("forge_tasks_list");
    assert.match(text, /заблокирована: ждёт #6127, #6128, #6129, #6130, #6131/);
    // Названия пяти блокеров в очереди раздули бы её вчетверо.
    assert.doesNotMatch(text, /Заблокирована, ждёт:/);
    assert.ok(text.split("\n").length < 12, `очередь распухла:\n${text}`);
  } finally {
    await h.close();
  }
});

test("карточка задачи отдаёт постановку и промт агента", async () => {
  const h = await harness({ "GET /agent/tasks": queue([MINE]) });
  try {
    const { text } = await h.call("forge_tasks_list", { task_id: 6125 });
    assert.match(text, /## Постановка/);
    assert.match(text, /Поднять сервер и отдать памятку/);
    assert.match(text, /## Промт агента/);
    assert.match(text, /Сначала прочитай постановку целиком/);
  } finally {
    await h.close();
  }
});

test("неназначенная задача агенту не видна", async () => {
  const h = await harness({ "GET /agent/tasks": queue([MINE]) });
  try {
    const { text, isError } = await h.call("forge_tasks_list", { task_id: 1 });
    assert.equal(isError, true);
    assert.match(text, /не назначена/);
    assert.doesNotMatch(text, /Каркас MCP-сервера/);
  } finally {
    await h.close();
  }
});

test("взятие задачи переводит её в работу", async () => {
  const h = await harness({
    "GET /agent/tasks": queue([MINE]),
    "POST /agent/tasks/6125/claim": () => ({
      status: 200,
      json: { ...MINE, status: "in_progress", claimed_by: { id: 516, name: "Claude2" } },
    }),
  });
  try {
    const { text, isError } = await h.call("forge_task_claim", { task_id: 6125 });
    assert.equal(isError, false);
    assert.match(text, /Задача #6125 взята, статус — в работе/);
    assert.match(text, /роль: исполнитель/);
  } finally {
    await h.close();
  }
});

test("на задаче, где я тестировщик, взятие не проходит и объясняет почему", async () => {
  const h = await harness({ "GET /agent/tasks": queue([MINE, TO_TEST]) });
  try {
    const { text, isError } = await h.call("forge_task_claim", { task_id: 6099 });
    assert.equal(isError, true);
    assert.match(text, /вы тестировщик, а не исполнитель/);
    assert.match(text, /forge_task_verify/);
    // До Forge запрос не пошёл: он ответил бы «не найдено», и это ничего бы
    // агенту не объяснило.
    assert.equal(
      h.forge.requests.filter((request) => request.url.includes("claim")).length,
      0,
    );
  } finally {
    await h.close();
  }
});

test("вердикт тестировщика переводит задачу в «проверено»", async () => {
  const h = await harness({
    "GET /agent/tasks": queue([TO_TEST]),
    "POST /agent/tasks/6099/verify": () => ({
      status: 200,
      json: { ...TO_TEST, status: "verified" },
    }),
  });
  try {
    const { text, isError } = await h.call("forge_task_verify", { task_id: 6099 });
    assert.equal(isError, false);
    assert.match(text, /#6099 принята — статус проверено/);
  } finally {
    await h.close();
  }
});

test("возврат с проверки переводит задачу в работу и записывает причину", async () => {
  const h = await harness({
    "GET /agent/tasks": queue([TO_TEST]),
    "POST /agent/tasks/6099/rework": () => ({
      status: 200,
      json: { ...TO_TEST, status: "in_progress" },
    }),
  });
  try {
    const { text, isError } = await h.call("forge_task_rework", {
      task_id: 6099,
      comment: "Фильтры съезжают на 390px — скриншот в задаче.",
    });
    assert.equal(isError, false);
    assert.match(text, /#6099 возвращена с проверки — статус в работе/);
    assert.match(text, /причина записана комментарием/);
    assert.deepEqual(JSON.parse(h.forge.requests.at(-1)?.body ?? "{}"), {
      comment: "Фильтры съезжают на 390px — скриншот в задаче.",
    });
  } finally {
    await h.close();
  }
});

test("возврат без причины до Forge не доходит", async () => {
  const h = await harness({ "GET /agent/tasks": queue([TO_TEST]) });
  try {
    const { text, isError } = await h.call("forge_task_rework", { task_id: 6099, comment: "" });
    assert.equal(isError, true);
    // Причина — не пожелание в описании, а обязательное поле схемы.
    assert.match(text, /comment/);
    assert.equal(h.forge.requests.length, 0);
  } finally {
    await h.close();
  }
});

test("возврат задачи не на проверке объясняется", async () => {
  const h = await harness({
    "GET /agent/tasks": queue([TO_TEST]),
    "POST /agent/tasks/6099/rework": () => ({
      status: 409,
      json: { code: "conflict", message: "Задача не на проверке" },
    }),
  });
  try {
    const { text, isError } = await h.call("forge_task_rework", {
      task_id: 6099,
      comment: "Не сошлось",
    });
    assert.equal(isError, true);
    assert.match(text, /не на проверке/);
    assert.match(text, /исход проверки закрепляют на сданной работе/);
  } finally {
    await h.close();
  }
});

test("исполнителю возврат с проверки не открыт", async () => {
  const h = await harness({
    "GET /agent/tasks": queue([MINE]),
    "POST /agent/tasks/6125/rework": () => ({
      status: 404,
      json: { code: "not_found", message: "Задача не найдена" },
    }),
  });
  try {
    const { text, isError } = await h.call("forge_task_rework", {
      task_id: 6125,
      comment: "Не сошлось",
    });
    assert.equal(isError, true);
    assert.match(text, /не назначена тестировщиком/);
  } finally {
    await h.close();
  }
});

test("нигде не сказано, что возврат агенту недоступен", async () => {
  const h = await harness({});
  try {
    const { tools } = await h.client.listTools();
    const verify = tools.find((tool) => tool.name === "forge_task_verify");
    assert.doesNotMatch(verify?.description ?? "", /статус не трогайте/);
    assert.match(verify?.description ?? "", /forge_task_rework/);
    assert.ok(tools.some((tool) => tool.name === "forge_task_rework"));
  } finally {
    await h.close();
  }
});

test("задача не на проверке вердикта не принимает", async () => {
  const h = await harness({
    "GET /agent/tasks": queue([TO_TEST]),
    "POST /agent/tasks/6099/verify": () => ({
      status: 409,
      json: { code: "conflict", message: "Задача не на проверке" },
    }),
  });
  try {
    const { text, isError } = await h.call("forge_task_verify", { task_id: 6099 });
    assert.equal(isError, true);
    assert.match(text, /не на проверке/);
  } finally {
    await h.close();
  }
});

test("заведённая задача уходит без исполнителя и без проекта в теле", async () => {
  const h = await harness({
    "POST /agent/tasks": () => ({
      status: 201,
      json: { ...MINE, id: 6200, title: "Починить фильтр", status: "todo", assignee: null },
    }),
  });
  try {
    const { text } = await h.call("forge_task_create", {
      title: "Починить фильтр",
      description: "Съезжает на узком экране.",
      category_id: 4,
    });
    assert.match(text, /#6200 «Починить фильтр» заведена в общий список без исполнителя/);
    assert.deepEqual(JSON.parse(h.forge.requests[0]?.body ?? "{}"), {
      title: "Починить фильтр",
      description: "Съезжает на узком экране.",
      category_id: 4,
    });
  } finally {
    await h.close();
  }
});

test("ключ без проекта задач не заводит, и это объясняется словами Forge", async () => {
  const h = await harness({
    "POST /agent/tasks": () => ({
      status: 400,
      json: { code: "validation", message: "Ключ без проекта не заводит задачи" },
    }),
  });
  try {
    const { text, isError } = await h.call("forge_task_create", { title: "Что-нибудь" });
    assert.equal(isError, true);
    assert.match(text, /Ключ без проекта не заводит задачи/);
  } finally {
    await h.close();
  }
});

test("агент убирает за собой заведённую задачу", async () => {
  const h = await harness({
    "POST /agent/tasks/6200/archive": () => ({ status: 204, json: null }),
  });
  try {
    const { text, isError } = await h.call("forge_task_archive", { task_id: 6200 });
    assert.equal(isError, false);
    assert.match(text, /#6200 убрана в архив/);
    assert.match(text, /Вернуть её оттуда может человек/);
    assert.equal(h.forge.requests[0]?.method, "POST");
  } finally {
    await h.close();
  }
});

test("чужую заведённую задачу убрать нельзя", async () => {
  const h = await harness({
    "POST /agent/tasks/1/archive": () => ({
      status: 404,
      json: { code: "not_found", message: "Задача не найдена" },
    }),
  });
  try {
    const { text, isError } = await h.call("forge_task_archive", { task_id: 1 });
    assert.equal(isError, true);
    assert.match(text, /завёл не этот агент/);
    // Не «не назначена»: назначение тут ни при чём, важно авторство.
    assert.doesNotMatch(text, /не назначена/);
  } finally {
    await h.close();
  }
});

test("своя, но уже убранная задача — «делать нечего», а не граница прав", async () => {
  const h = await harness({
    "POST /agent/tasks/6200/archive": () => ({
      status: 409,
      json: { code: "conflict", message: "Задача уже в архиве" },
    }),
  });
  try {
    const { text, isError } = await h.call("forge_task_archive", { task_id: 6200 });
    assert.equal(isError, true);
    assert.match(text, /уже в архиве — убирать нечего/);
    // Не «завёл не этот агент»: агент её видел, врать ему незачем.
    assert.doesNotMatch(text, /завёл не этот агент/);
  } finally {
    await h.close();
  }
});

test("взятую задачу убирать поздно, и это сказано отдельно", async () => {
  const h = await harness({
    "POST /agent/tasks/6200/archive": () => ({
      status: 409,
      json: { code: "conflict", message: "За задачу уже взялись — убирать поздно" },
    }),
  });
  try {
    const { text, isError } = await h.call("forge_task_archive", { task_id: 6200 });
    assert.equal(isError, true);
    assert.match(text, /уже не свободна/);
    assert.match(text, /скажите человеку/);
  } finally {
    await h.close();
  }
});

test("категории отдаются списком, чтобы не угадывать номер", async () => {
  const h = await harness({
    "GET /agent/categories": () => ({
      status: 200,
      json: [
        { id: 4, name: "Фронтенд" },
        { id: 5, name: "Бэкенд" },
      ],
    }),
  });
  try {
    const { text } = await h.call("forge_categories_list");
    assert.match(text, /#4 Фронтенд/);
    assert.match(text, /#5 Бэкенд/);
  } finally {
    await h.close();
  }
});

test("исполнителя, проекта и срока у заведения задачи нет", async () => {
  const h = await harness({});
  try {
    const { tools } = await h.client.listTools();
    const create = tools.find((tool) => tool.name === "forge_task_create");
    const fields = Object.keys(
      (create?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
    );
    assert.deepEqual(fields.sort(), ["category_id", "description", "estimate_minutes", "title"]);
  } finally {
    await h.close();
  }
});

test("чужую задачу взять нельзя, и это объясняется", async () => {
  const h = await harness({ "GET /agent/tasks": queue([MINE]) });
  try {
    const { text, isError } = await h.call("forge_task_claim", { task_id: 999 });
    assert.equal(isError, true);
    assert.match(text, /Задача #999 вам не назначена либо она в другом проекте/);
    assert.match(text, /граница прав, а не поломка/);
  } finally {
    await h.close();
  }
});

test("возврат задачи не откатывает статус", async () => {
  const h = await harness({
    "GET /agent/tasks": queue([MINE]),
    "POST /agent/tasks/6125/release": () => ({
      status: 200,
      json: { ...MINE, status: "in_progress", claimed_by: null },
    }),
  });
  try {
    const { text } = await h.call("forge_task_release", { task_id: 6125 });
    assert.match(text, /возвращена/);
    assert.match(text, /статус остался прежним — в работе/);
  } finally {
    await h.close();
  }
});

test("отчёт уходит в Forge ровно тем, что передали", async () => {
  const h = await harness({
    "GET /agent/tasks": queue([MINE]),
    "PATCH /agent/tasks/6125": () => ({ status: 200, json: { ...MINE, status: "review" } }),
  });
  try {
    const { text } = await h.call("forge_task_report", {
      task_id: 6125,
      status: "review",
      spent_minutes: 180,
    });
    assert.match(text, /статус — на проверке/);
    const sent = h.forge.requests.at(-1);
    assert.equal(sent?.method, "PATCH");
    assert.deepEqual(JSON.parse(sent?.body ?? "{}"), { status: "review", spent_minutes: 180 });
  } finally {
    await h.close();
  }
});

test("пустой отчёт до Forge не доходит", async () => {
  const h = await harness({ "GET /agent/tasks": queue([MINE]) });
  try {
    const { text, isError } = await h.call("forge_task_report", { task_id: 6125 });
    assert.equal(isError, true);
    assert.match(text, /Нечего менять/);
    assert.equal(h.forge.requests.length, 0);
  } finally {
    await h.close();
  }
});

test("вопрос человеку ставится и снимается тем же инструментом", async () => {
  const h = await harness({
    "GET /agent/tasks": queue([MINE]),
    "PATCH /agent/tasks/6125": (body) => ({
      status: 200,
      json: { ...MINE, ...(JSON.parse(body) as object) },
    }),
  });
  try {
    const asked = await h.call("forge_task_ask", {
      task_id: 6125,
      question_text: "Какой стек брать?",
    });
    assert.match(asked.text, /Вопрос по задаче #6125 записан/);
    assert.deepEqual(JSON.parse(h.forge.requests.at(-1)?.body ?? "{}"), {
      question: true,
      question_text: "Какой стек брать?",
    });

    const cleared = await h.call("forge_task_ask", { task_id: 6125 });
    assert.match(cleared.text, /снята/);
    assert.deepEqual(JSON.parse(h.forge.requests.at(-1)?.body ?? "{}"), { question: false });
  } finally {
    await h.close();
  }
});

test("названия, срока, приоритета и исполнителя у инструментов просто нет", async () => {
  const h = await harness({ "GET /agent/tasks": queue([MINE]) });
  try {
    const { tools } = await h.client.listTools();
    const report = tools.find((tool) => tool.name === "forge_task_report");
    const fields = Object.keys(
      (report?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
    );
    for (const forbidden of ["title", "due_date", "priority", "assignee_id", "category_id", "tester_id"]) {
      assert.ok(!fields.includes(forbidden), `${forbidden} агенту менять нельзя`);
    }
    const statuses = (
      (report?.inputSchema as { properties?: Record<string, { enum?: string[] }> }).properties
        ?.status ?? {}
    ).enum;
    assert.deepEqual(statuses, ["in_progress", "review"]);
  } finally {
    await h.close();
  }
});
