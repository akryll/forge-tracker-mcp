import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  type AgentTasks,
  type Blocker,
  type Task,
} from "./forge-types.js";

/** Кем я назначен на задачу. Роли разные, и циклы работы у них разные. */
export type Role = "assignee" | "tester" | "none";

export const ROLE_LABEL: Record<Role, string> = {
  assignee: "исполнитель",
  tester: "тестировщик",
  none: "не назначена вам",
};

/**
 * Роль берётся из назначения, а не из отдельного поля: исполнитель и
 * тестировщик — это `assignee` и `tester` задачи, и совпадать они не могут.
 */
export function roleOf(task: Task, memberId: number | null | undefined): Role {
  if (memberId == null) return "none";
  if (task.assignee?.id === memberId) return "assignee";
  if (task.tester?.id === memberId) return "tester";
  return "none";
}

function minutes(value: number | null | undefined): string {
  if (value == null) return "—";
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (hours === 0) return `${rest} мин`;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

function line(label: string, value: string | null | undefined): string | null {
  return value ? `${label}: ${value}` : null;
}

function facts(task: Task, role: Role): string[] {
  const kept: (string | null)[] = [
    line("роль", ROLE_LABEL[role]),
    line("статус", STATUS_LABEL[task.status]),
    line("приоритет", PRIORITY_LABEL[task.priority]),
    line("проект", task.project?.name),
    line("эпик", task.epic?.name),
    line("тип", task.task_type?.name),
    line("категория", task.category?.name),
    line("срок", task.due_date),
    task.estimate_minutes == null ? null : line("оценка", minutes(task.estimate_minutes)),
    task.spent_minutes == null ? null : line("потрачено", minutes(task.spent_minutes)),
    // Себя в исполнителях и тестировщиках не повторяем — роль уже названа
    // первой строкой. А вот вторую сторону назвать полезно: тестировщику
    // важно, чью работу он проверяет.
    role === "assignee" ? null : task.assignee ? line("исполнитель", task.assignee.name) : null,
    role === "tester" ? null : task.tester ? line("тестировщик", task.tester.name) : null,
    // Чужие взятые задачи в очередь не попадают, так что взявший — всегда я.
    task.claimed_by ? "взята вами" : null,
  ];
  return kept.filter((item): item is string => item !== null);
}

/** Одна связанная задача строкой. Без названия — она в другом проекте. */
function blockerLine(blocker: Blocker): string {
  if (!blocker.title) {
    return `#${blocker.id} — в другом проекте, подробностей не видно`;
  }
  const status = blocker.status ? STATUS_LABEL[blocker.status] : "статус неизвестен";
  return `#${blocker.id} ${blocker.title} — ${status}`;
}

/**
 * Короткая строка про блокеры для списка: номера и предупреждение. Разбор
 * по названиям сюда не влезет — очередь из семи задач с блокерами у каждой
 * перестанет читаться.
 */
export function blockersLine(task: Task): string | null {
  if (task.blocked_by_ids.length === 0) return null;
  const list = task.blocked_by_ids.map((id) => `#${id}`).join(", ");
  return (
    `заблокирована: ждёт ${list} — сдавать её и закрывать, пока блокеры открыты, ` +
    `не стоит: сначала спросите человека`
  );
}

/**
 * Разбор связей для карточки: чего ждёт задача и кто ждёт её. Здесь место
 * подробностям — по этим строкам и решают, ждать или идти к человеку.
 */
export function blockersBlock(task: Task): string | null {
  const parts: string[] = [];

  const blockers = task.blocked_by ?? [];
  if (blockers.length > 0) {
    parts.push(
      ["Заблокирована, ждёт:", ...blockers.map((b) => `  ${blockerLine(b)}`)].join("\n"),
    );
    // Открытый блокер — не запрет, а повод спросить: решение за человеком.
    parts.push(
      "Сдавать и закрывать её, пока блокеры открыты, не стоит: сначала спросите человека.",
    );
  }

  const blocking = task.blocking ?? [];
  if (blocking.length > 0) {
    // Обратная сторона: откладывая эту задачу, агент держит чужую.
    parts.push(
      ["Её саму ждут:", ...blocking.map((b) => `  ${blockerLine(b)}`)].join("\n"),
    );
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/** Короткая строка для списка: чтобы очередь читалась целиком, а не по кускам. */
export function formatTaskLine(task: Task, role: Role): string {
  const parts = [
    `#${task.id} ${task.title}`,
    `  ${facts(task, role).join(" · ")}`,
  ];
  const blockers = blockersLine(task);
  if (blockers) parts.push(`  ${blockers}`);
  if (task.question) parts.push(`  вопрос человеку ждёт ответа`);
  return parts.join("\n");
}

/** Полная карточка: с постановкой и промтом — то, по чему работают. */
export function formatTaskCard(task: Task, role: Role): string {
  const parts = [`#${task.id} ${task.title}`, facts(task, role).join(" · ")];

  const blockers = blockersBlock(task);
  if (blockers) parts.push(blockers);
  const skills = skillsBlock(task);
  if (skills) parts.push(skills);
  if (task.question && task.question_text) {
    parts.push(`Вопрос человеку (ждёт ответа):\n${task.question_text}`);
  }
  parts.push(`## Постановка\n\n${task.description?.trim() || "Описания нет."}`);
  if (task.agent_prompt?.trim()) {
    parts.push(`## Промт агента\n\n${task.agent_prompt.trim()}`);
  }
  return parts.join("\n\n");
}

/**
 * Скиллы типа задачи. Тел здесь нет намеренно: карточка должна читаться.
 * Полный текст берётся инструментом forge_skill_get.
 */
function skillsBlock(task: Task): string | null {
  const skills = task.task_type?.skills ?? [];
  if (skills.length === 0) return null;

  const lines = skills.map((skill) =>
    skill.description?.trim()
      ? `- #${skill.id} ${skill.name} — ${skill.description.trim()}`
      : `- #${skill.id} ${skill.name}`,
  );
  return [
    "## Скиллы типа",
    "",
    ...lines,
    "",
    "Прочитайте их перед работой: forge_skill_get с task_id и skill_id.",
  ].join("\n");
}

/**
 * Очередь целиком. Пустую очередь проговариваем словами: молчаливый пустой
 * список агент читает как поломку и идёт проверять ключ.
 */
export function formatQueue(queue: AgentTasks): string {
  const memberId = queue.member?.id;
  if (!queue.member) {
    return (
      "Ключ не закреплён ни за одним ИИ-сотрудником, поэтому задач у него нет. " +
      "Это решает человек на странице /agents в Forge."
    );
  }
  if (queue.tasks.length === 0) {
    return `Назначенных задач нет. Задачи назначает человек — ждите или спросите его.`;
  }

  const header = `Задачи, назначенные на ${queue.member.name} — ${queue.tasks.length}:`;
  const lines = queue.tasks.map((task) => formatTaskLine(task, roleOf(task, memberId)));
  return [
    header,
    ...lines,
    "",
    "Постановка и промт задачи — forge_tasks_list с task_id.",
  ].join("\n");
}
