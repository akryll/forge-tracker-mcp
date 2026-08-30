import { ForgeApiError } from "./forge-client.js";
import { redact } from "./secret.js";

/**
 * Что агент пытался сделать. Один и тот же код ответа означает разное:
 * `404` на взятие — «задача не ваша», `404` на возврат — «за вами не числится».
 */
export type Action =
  | "queue"
  | "claim"
  | "release"
  | "report"
  | "verify"
  | "create"
  | "comment"
  | "document"
  | "screenshot"
  | "guide";

export interface Context {
  readonly action: Action;
  readonly taskId?: number;
}

const QUEUE_HINT = "Свою очередь показывает forge_tasks_list.";

function task(context: Context): string {
  return context.taskId === undefined ? "Задача" : `Задача #${context.taskId}`;
}

/**
 * Памятка говорит прямо: «Если задача не берётся или не находится — это не
 * поломка, а граница прав». Отсюда и правило: агент должен получить не код
 * ответа, а объяснение, по которому понятно, что делать дальше.
 */
function notFound(context: Context, fromForge: string): string {
  switch (context.action) {
    case "release":
      return `${task(context)} за вами не числится — возвращать нечего.`;
    case "verify":
      return (
        `${task(context)} вам не назначена тестировщиком либо она в другом проекте. ` +
        `Вердикт закрепляет тот, кого назначили тестировщиком, а назначает человек. ${QUEUE_HINT}`
      );
    case "document":
      // Здесь `404` бывает и про задачу, и про документ: что именно не нашлось,
      // знает Forge, и его слово тут точнее нашей догадки.
      return `${fromForge}. Проверьте номер задачи и номер документа. ${QUEUE_HINT}`;
    default:
      return (
        `${task(context)} вам не назначена либо она в другом проекте — для агента такой ` +
        `задачи не существует. Это граница прав, а не поломка. ${QUEUE_HINT}`
      );
  }
}

function conflict(context: Context, fromForge: string): string {
  switch (context.action) {
    case "claim":
      return (
        `${task(context)} уже взята другим экземпляром агента — двум сразу её не отдадут. ` +
        `Возьмите другую из очереди.`
      );
    case "verify":
      return (
        `${task(context)} не на проверке: вердикт закрепляют на сданной работе. ` +
        `Посмотрите её статус в forge_tasks_list.`
      );
    default:
      return fromForge;
  }
}

function validation(fromForge: string): string {
  // Сообщения Forge о проверке уже написаны по-русски и готовы к показу.
  // Добавляем только то, чего в них нет: границу, из-за которой отказ.
  if (/проект/i.test(fromForge)) {
    return `${fromForge}. Ключ ограничен своим проектом: заводить и трогать задачи можно только в нём.`;
  }
  return fromForge;
}

/**
 * Отказ Forge на человеческом языке. Ключ сюда попасть не может: сообщение
 * уже прошло через затирающий фильтр в клиенте, но повторная проверка стоит
 * дёшево, а цена пропуска высока.
 */
export function describeFailure(error: unknown, context: Context): string {
  if (!(error instanceof ForgeApiError)) {
    return redact(error instanceof Error ? error.message : "Неизвестная ошибка");
  }

  const fromForge = error.message.replace(/\.$/, "");
  switch (error.status) {
    case 401:
      return (
        "Ключ агента не действует: отозван или введён неверно. Новый выдаёт человек " +
        "на странице /agents в Forge. Работать до этого не получится ничем."
      );
    case 403:
      return `${fromForge}. Это действие агенту не доверено — его делает человек.`;
    case 404:
      return notFound(context, fromForge);
    case 409:
      return conflict(context, fromForge);
    case 400:
      return validation(fromForge);
    case 429:
      return `${fromForge}. Слишком часто — подождите и повторите.`;
    case 500:
    case 502:
    case 503:
      return (
        `${fromForge}. Это сбой на стороне Forge, а не граница прав: повторите позже, ` +
        `а если повторяется — скажите человеку.`
      );
    default:
      return redact(error.message);
  }
}
