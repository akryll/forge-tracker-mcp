import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./harness.js";
import type { Routes } from "./fake-forge.js";

const ME = { id: 518, name: "Клод", has_avatar: false };

const REVIEW = { id: 11, name: "Разбор багов", description: "как искать причину" };
const RELEASE = { id: 12, name: "Проверка релиза", description: null };

const WITH_SKILLS = {
  id: 7159,
  title: "Починить насос",
  description: "Насос не держит давление.",
  status: "todo",
  priority: "high",
  assignee: ME,
  project: { id: 312, name: "Forge" },
  task_type: { id: 7, name: "Дефект", color: "rose", icon: "alert", skills: [REVIEW, RELEASE] },
  blocked_by_ids: [],
  blocks_open: 0,
};

const WITHOUT_TYPE = {
  ...WITH_SKILLS,
  id: 7160,
  title: "Задача без типа",
  task_type: null,
};

function queue(tasks: unknown[]): Routes["x"] {
  return () => ({
    status: 200,
    json: { agent: { id: 516, name: "Claude2" }, member: ME, tasks },
  });
}

test("карточка задачи показывает скиллы типа — имена и описания, без тел", async () => {
  const h = await harness({ "GET /agent/tasks": queue([WITH_SKILLS]) });
  try {
    const { text } = await h.call("forge_tasks_list", { task_id: 7159 });

    assert.match(text, /## Скиллы типа/);
    assert.match(text, /#11 Разбор багов — как искать причину/);
    // Скилл без описания показывается одним именем.
    assert.match(text, /#12 Проверка релиза/);
    assert.match(text, /forge_skill_get/);
    assert.doesNotMatch(text, /Сначала воспроизведи/, "тела в карточке быть не должно");
  } finally {
    await h.close();
  }
});

test("forge_skills_list перечисляет скиллы задачи", async () => {
  const h = await harness({ "GET /agent/tasks": queue([WITH_SKILLS]) });
  try {
    const { text, isError } = await h.call("forge_skills_list", { task_id: 7159 });

    assert.equal(isError, false);
    assert.match(text, /#11 Разбор багов — как искать причину/);
    assert.match(text, /#12 Проверка релиза/);
  } finally {
    await h.close();
  }
});

test("forge_skills_list объясняет пустоту словами, а не молчанием", async () => {
  const h = await harness({ "GET /agent/tasks": queue([WITHOUT_TYPE]) });
  try {
    const { text } = await h.call("forge_skills_list", { task_id: 7160 });

    assert.match(text, /скиллов нет/);
    assert.match(text, /прикрепляет человек/);
  } finally {
    await h.close();
  }
});

test("forge_skill_get отдаёт имя, описание и тело", async () => {
  const h = await harness({
    "GET /agent/tasks": queue([WITH_SKILLS]),
    "GET /agent/tasks/7159/skills/11": () => ({
      status: 200,
      json: { ...REVIEW, body: "# Разбор\n\nСначала воспроизведи." },
    }),
  });
  try {
    const { text, isError } = await h.call("forge_skill_get", { task_id: 7159, skill_id: 11 });

    assert.equal(isError, false);
    assert.match(text, /# Разбор багов/);
    assert.match(text, /как искать причину/);
    assert.match(text, /Сначала воспроизведи\./);
  } finally {
    await h.close();
  }
});

test("скилл не из типа задачи объясняется словами, а не кодом", async () => {
  const h = await harness({ "GET /agent/tasks": queue([WITH_SKILLS]) });
  try {
    // Маршрута на чтение скилла нет — подставной Forge ответит 404, как настоящий.
    const { text, isError } = await h.call("forge_skill_get", { task_id: 7159, skill_id: 999 });

    assert.equal(isError, true);
    assert.match(text, /7159/);
    assert.match(text, /скилл не прикреплён к типу этой задачи/i);
    assert.match(text, /forge_skills_list/);
  } finally {
    await h.close();
  }
});

test("скилл без описания не ломает ни список, ни карточку", async () => {
  const h = await harness({ "GET /agent/tasks": queue([WITH_SKILLS]) });
  try {
    const list = await h.call("forge_skills_list", { task_id: 7159 });
    assert.equal(list.isError, false);
    assert.match(list.text, /#12 Проверка релиза/);
    assert.doesNotMatch(list.text, /#12 Проверка релиза —/, "без описания тире не рисуется");
  } finally {
    await h.close();
  }
});
