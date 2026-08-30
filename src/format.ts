import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  type AgentTasks,
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

/** Строка про блокеры: пока они открыты, задачу закрывать нельзя. */
export function blockersLine(task: Task): string | null {
  if (task.blocked_by_ids.length === 0) return null;
  const list = task.blocked_by_ids.map((id) => `#${id}`).join(", ");
  return (
    `заблокирована: ждёт ${list} — сдавать её и закрывать, пока блокеры открыты, ` +
    `не стоит: сначала спросите человека`
  );
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

  const blockers = blockersLine(task);
  if (blockers) parts.push(blockers);
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
