import type { ForgeClient } from "./forge-client.js";
import type { AgentTasks, Named, Task } from "./forge-types.js";
import { roleOf, type Role } from "./format.js";

/** Что агенту доверено менять в отчёте по задаче. Больше — решения человека. */
export interface TaskReport {
  status?: "in_progress" | "review";
  description?: string;
  estimate_minutes?: number;
  spent_minutes?: number;
  clear_estimate?: boolean;
  question?: boolean;
  question_text?: string;
}

/**
 * Задача, которую агент предлагает сам. Исполнителя нет вовсе: назначает
 * человек. Проекта тоже нет — его диктует ключ.
 */
export interface TaskDraft {
  title: string;
  description?: string;
  category_id?: number;
  estimate_minutes?: number;
}

/**
 * Работа с задачами поверх клиента. Отдельный слой ради одного: сотрудник,
 * за которым закреплён ключ, нужен почти каждому инструменту — чтобы понять
 * мою роль в задаче, — а меняться посреди сессии он не может.
 */
export class TaskService {
  readonly #client: ForgeClient;
  #memberId: number | null | undefined;

  constructor(client: ForgeClient) {
    this.#client = client;
  }

  async queue(): Promise<AgentTasks> {
    const queue = await this.#client.requestJson<AgentTasks>("/agent/tasks");
    this.#memberId = queue.member?.id ?? null;
    return queue;
  }

  /** Сотрудник ключа. Спрашивается один раз за сессию: он не меняется. */
  async memberId(): Promise<number | null> {
    if (this.#memberId === undefined) await this.queue();
    return this.#memberId ?? null;
  }

  async roleIn(task: Task): Promise<Role> {
    return roleOf(task, await this.memberId());
  }

  async claim(taskId: number): Promise<Task> {
    return await this.#client.requestJson<Task>(`/agent/tasks/${taskId}/claim`, {
      method: "POST",
    });
  }

  async release(taskId: number): Promise<Task> {
    return await this.#client.requestJson<Task>(`/agent/tasks/${taskId}/release`, {
      method: "POST",
    });
  }

  async verify(taskId: number): Promise<Task> {
    return await this.#client.requestJson<Task>(`/agent/tasks/${taskId}/verify`, {
      method: "POST",
    });
  }

  async rework(taskId: number, comment: string): Promise<Task> {
    return await this.#client.requestJson<Task>(`/agent/tasks/${taskId}/rework`, {
      method: "POST",
      body: { comment },
    });
  }

  /** Уборка отвечает `204` без тела: возвращать тут нечего. */
  async archive(taskId: number): Promise<void> {
    await this.#client.requestJson<void>(`/agent/tasks/${taskId}/archive`, { method: "POST" });
  }

  async create(draft: TaskDraft): Promise<Task> {
    return await this.#client.requestJson<Task>("/agent/tasks", {
      method: "POST",
      body: draft,
    });
  }

  async categories(): Promise<Named[]> {
    return await this.#client.requestJson<Named[]>("/agent/categories");
  }

  async report(taskId: number, patch: TaskReport): Promise<Task> {
    return await this.#client.requestJson<Task>(`/agent/tasks/${taskId}`, {
      method: "PATCH",
      body: patch,
    });
  }
}
