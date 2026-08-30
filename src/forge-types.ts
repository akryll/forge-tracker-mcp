/**
 * Ответы Forge в том виде, в каком их описывает спецификация. Здесь только
 * то, что нужно инструментам: полный тираж схем нам ни к чему, а лишние поля
 * TypeScript и так пропустит.
 */

export type TaskStatus = "backlog" | "todo" | "in_progress" | "review" | "verified" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface Named {
  readonly id: number;
  readonly name: string;
}

export interface MemberRef extends Named {
  readonly agent?: Named | null;
}

export interface Task {
  readonly id: number;
  readonly title: string;
  readonly description?: string | null;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly due_date?: string | null;
  readonly estimate_minutes?: number | null;
  readonly spent_minutes?: number | null;
  readonly question?: boolean;
  readonly question_text?: string | null;
  readonly category?: Named | null;
  readonly assignee?: MemberRef | null;
  readonly tester?: MemberRef | null;
  readonly project?: Named | null;
  readonly epic?: Named | null;
  readonly task_type?: Named | null;
  readonly agent_prompt?: string | null;
  readonly blocked_by_ids: number[];
  readonly blocks_open: number;
  readonly claimed_by?: Named | null;
  readonly claimed_at?: string | null;
}

export interface AgentTasks {
  readonly agent: Named;
  /** `null` — ключ не выдан ни одному ИИ-сотруднику, задач у него быть не может. */
  readonly member?: MemberRef | null;
  readonly tasks: Task[];
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "в бэклоге",
  todo: "к выполнению",
  in_progress: "в работе",
  review: "на проверке",
  verified: "проверено",
  done: "готово",
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "низкий",
  medium: "средний",
  high: "высокий",
  urgent: "срочный",
};
