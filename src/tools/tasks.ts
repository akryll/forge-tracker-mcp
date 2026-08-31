import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { STATUS_LABEL } from "../forge-types.js";
import { formatQueue, formatTaskCard, roleOf } from "../format.js";
import type { TaskService } from "../tasks-service.js";
import { FORBIDDEN_FIELD } from "../tool-schema.js";
import { toolFailure, toolText } from "../tool-result.js";

const taskId = z
  .number()
  .int()
  .positive()
  .describe("Номер задачи — тот, что виден в forge_tasks_list и в ссылке на задачу.");

const MINUTES = "Минуты, от 0 до 1440 — рабочий день целиком.";

export function registerTaskTools(server: McpServer, tasks: TaskService): void {
  server.registerTool(
    "forge_tasks_list",
    {
      title: "Мои задачи",
      description: [
        "Задачи, назначенные на моего ИИ-сотрудника, с моей ролью в каждой: исполнитель или тестировщик.",
        "Общего пула нет — агент видит ровно то, что назначил человек.",
        "Без аргументов — вся очередь коротко; с task_id — полная карточка одной задачи",
        "с постановкой и промтом агента, по которым и работают.",
      ].join(" "),
      inputSchema: z.object({
        task_id: taskId
          .optional()
          .describe("Показать одну задачу целиком: постановка, промт агента, блокеры."),
      }).catchall(FORBIDDEN_FIELD),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ task_id }) => {
      try {
        const queue = await tasks.queue();
        if (task_id === undefined) return toolText(formatQueue(queue));

        const task = queue.tasks.find((item) => item.id === task_id);
        if (!task) {
          return toolText(
            `Задача #${task_id} вам не назначена либо она в другом проекте — работать с ней нельзя. ` +
              `Вызовите forge_tasks_list без аргументов, чтобы увидеть свою очередь.`,
            { isError: true },
          );
        }
        return toolText(formatTaskCard(task, roleOf(task, queue.member?.id)));
      } catch (error) {
        return toolFailure(error, { action: "queue" });
      }
    },
  );

  server.registerTool(
    "forge_task_claim",
    {
      title: "Взять задачу в работу",
      description: [
        "Закрепляет задачу за агентом и переводит её в работу.",
        "Берут только то, что назначено вам исполнителем: на задаче, где вы тестировщик, взятие не пройдёт —",
        "тестировщик проверяет, а не исполняет.",
        "Задачу, уже взятую другим экземпляром агента, взять нельзя.",
      ].join(" "),
      inputSchema: z.object({ task_id: taskId }).catchall(FORBIDDEN_FIELD),
      annotations: { idempotentHint: false, openWorldHint: true },
    },
    async ({ task_id }) => {
      try {
        // Отдельно ловим свой же случай тестировщика: Forge на него отвечает
        // «не найдено» — по-своему верно, но агенту это ничего не объясняет.
        // Задачу, которой в очереди нет вовсе, отдаём Forge: он различает
        // «не ваша» и «уже взята другим экземпляром», а мы отсюда — нет.
        const queue = await tasks.queue();
        const mine = queue.tasks.find((item) => item.id === task_id);
        if (mine && roleOf(mine, queue.member?.id) === "tester") {
          return toolText(
            `На задаче #${task_id} вы тестировщик, а не исполнитель: брать её в работу не ваше дело. ` +
              `Проверьте сделанное и закрепите вердикт через forge_task_verify.`,
            { isError: true },
          );
        }

        const task = await tasks.claim(task_id);
        return toolText(
          `Задача #${task.id} взята, статус — ${STATUS_LABEL[task.status]}.\n\n` +
            formatTaskCard(task, await tasks.roleIn(task)),
        );
      } catch (error) {
        return toolFailure(error, { action: "claim", taskId: task_id });
      }
    },
  );

  server.registerTool(
    "forge_task_release",
    {
      title: "Вернуть задачу",
      description: [
        "Снимает закрепление: задача перестаёт числиться за агентом.",
        "Статус при этом не откатывается — работа могла начаться, и делать вид, что её не было, неправильно.",
        "Возвращать стоит то, за что не беретесь: упёрлись в развилку — лучше спросить человека через forge_task_ask.",
      ].join(" "),
      inputSchema: z.object({ task_id: taskId }).catchall(FORBIDDEN_FIELD),
      annotations: { openWorldHint: true },
    },
    async ({ task_id }) => {
      try {
        const task = await tasks.release(task_id);
        return toolText(
          `Задача #${task.id} возвращена, статус остался прежним — ${STATUS_LABEL[task.status]}.`,
        );
      } catch (error) {
        return toolFailure(error, { action: "release", taskId: task_id });
      }
    },
  );

  server.registerTool(
    "forge_task_report",
    {
      title: "Отчитаться по задаче",
      description: [
        "Отчёт по взятой задаче: статус, уточнённое описание, оценка и потраченное время.",
        "Название, срок, приоритет, категорию, исполнителя и роли агент не меняет — это решения человека,",
        "и таких полей у инструмента нет.",
        "Статус — только «в работе» и «на проверке»: «готово» ставит человек при приёмке,",
        "а «проверено» закрепляет тестировщик через forge_task_verify.",
        "Отчёт без результата человеку бесполезен: перед переводом на проверку приложите",
        "комментарий и документ с тем, что сделано.",
      ].join(" "),
      inputSchema: z.object({
        task_id: taskId,
        status: z
          .enum(["in_progress", "review"], {
            errorMap: () => ({
              message:
                "Агенту доверены только «in_progress» и «review». «Готово» ставит человек " +
                "при приёмке, «проверено» — тестировщик через forge_task_verify.",
            }),
          })
          .optional()
          .describe("«in_progress» — взялся за работу, «review» — сдаю на проверку."),
        description: z
          .string()
          .max(10_000)
          .optional()
          .describe("Новая постановка. Заменяет прежнюю целиком — не дописывает."),
        estimate_minutes: z
          .number()
          .int()
          .min(0)
          .max(1440)
          .optional()
          .describe(`Уточнённая оценка трудоёмкости. ${MINUTES}`),
        spent_minutes: z
          .number()
          .int()
          .min(0)
          .max(1440)
          .optional()
          .describe(`Фактически потраченное время. ${MINUTES}`),
        clear_estimate: z
          .boolean()
          .optional()
          .describe("Снять оценку совсем. Отдельный флаг, потому что «нет поля» и «поле пусто» неразличимы."),
      }).catchall(FORBIDDEN_FIELD),
      annotations: { openWorldHint: true },
    },
    async ({ task_id, ...patch }) => {
      try {
        const filled = Object.fromEntries(
          Object.entries(patch).filter(([, value]) => value !== undefined),
        );
        if (Object.keys(filled).length === 0) {
          return toolText(
            "Нечего менять: укажите хотя бы одно поле — статус, описание, оценку или потраченное время.",
            { isError: true },
          );
        }
        const task = await tasks.report(task_id, filled);
        return toolText(`Задача #${task.id} обновлена, статус — ${STATUS_LABEL[task.status]}.`);
      } catch (error) {
        return toolFailure(error, { action: "report", taskId: task_id });
      }
    },
  );

  server.registerTool(
    "forge_task_ask",
    {
      title: "Спросить человека",
      description: [
        "Ставит на задачу вопрос человеку и помечает её как ждущую ответа.",
        "Для развилок, которые агенту решать не по чину: что важнее, каким считать правильное поведение,",
        "куда девать спорный случай. Гадать вместо вопроса — хуже.",
        "Ответ человека комментарием снимает пометку сам; снять её вручную — тот же инструмент без question_text.",
      ].join(" "),
      inputSchema: z.object({
        task_id: taskId,
        question_text: z
          .string()
          .min(1)
          .max(2000)
          .optional()
          .describe(
            "Текст вопроса. Без него пометка снимается — значит, вопрос отпал сам.",
          ),
      }).catchall(FORBIDDEN_FIELD),
      annotations: { openWorldHint: true },
    },
    async ({ task_id, question_text }) => {
      try {
        const task = question_text
          ? await tasks.report(task_id, { question: true, question_text })
          : await tasks.report(task_id, { question: false });
        return toolText(
          question_text
            ? `Вопрос по задаче #${task.id} записан и ждёт ответа человека.`
            : `Пометка вопроса с задачи #${task.id} снята.`,
        );
      } catch (error) {
        return toolFailure(error, { action: "report", taskId: task_id });
      }
    },
  );
}

/**
 * Вторая роль и заведение задач. Отдельно от цикла исполнителя, потому что
 * это другая работа: тестировщик проверяет чужое и `claim` ему не открыт.
 */
export function registerTesterTools(server: McpServer, tasks: TaskService): void {
  server.registerTool(
    "forge_task_verify",
    {
      title: "Закрепить проверку",
      description: [
        "Первый из двух исходов проверки: работа принята, «на проверке» → «проверено».",
        "Работает только на задачах, где тестировщик — вы.",
        "Ставить стоит после того, как разбор записан комментарием и документом:",
        "статус без разбора человеку ничего не говорит.",
        "Не приняли работу — forge_task_rework, а не молчание и не этот инструмент.",
      ].join(" "),
      inputSchema: z.object({ task_id: taskId }).catchall(FORBIDDEN_FIELD),
      annotations: { openWorldHint: true },
    },
    async ({ task_id }) => {
      try {
        const task = await tasks.verify(task_id);
        return toolText(
          `Задача #${task.id} принята — статус ${STATUS_LABEL[task.status]}.`,
        );
      } catch (error) {
        return toolFailure(error, { action: "verify", taskId: task_id });
      }
    },
  );

  server.registerTool(
    "forge_task_rework",
    {
      title: "Вернуть задачу с проверки",
      description: [
        "Второй из двух исходов проверки: работа не принята, «на проверке» → «в работе».",
        "Единственный обратный переход, доверенный агенту, и работает он только на задачах,",
        "где тестировщик — вы.",
        "Причина обязательна и ложится комментарием в задачу: возврат без объяснения",
        "исполнителю бесполезен — он не узнает, что именно чинить.",
        "Молчание вместо возврата хуже обоих: задача повиснет на проверке, и никто этого не заметит.",
      ].join(" "),
      inputSchema: z
        .object({
          task_id: taskId,
          comment: z
            .string()
            .min(1)
            .max(10_000)
            .describe(
              "Что не сошлось и как это увидеть: шаги, ожидаемое и полученное. " +
                "По этому тексту исполнитель будет чинить, другого он не получит.",
            ),
        })
        .catchall(FORBIDDEN_FIELD),
      annotations: { openWorldHint: true },
    },
    async ({ task_id, comment }) => {
      try {
        const task = await tasks.rework(task_id, comment);
        return toolText(
          `Задача #${task.id} возвращена с проверки — статус ${STATUS_LABEL[task.status]}, ` +
            `причина записана комментарием.`,
        );
      } catch (error) {
        return toolFailure(error, { action: "rework", taskId: task_id });
      }
    },
  );

  server.registerTool(
    "forge_task_create",
    {
      title: "Завести задачу",
      description: [
        "Задача, которую агент предлагает сам: нашёл по ходу работы то, что чинить не здесь.",
        "Уходит в общий список без исполнителя и в статусе «к выполнению» — назначает человек.",
        "Завели задачу для проверки — уберите её потом сами через forge_task_archive:",
        "пока её никому не назначили, это ваше дело, а не человека.",
        "Проект берётся из ключа, указывать его не нужно.",
        "Срок и приоритет не задаются: их расставляет человек, когда берёт задачу в работу.",
      ].join(" "),
      inputSchema: z.object({
        title: z.string().min(1).max(160).describe("Название — одной строкой, по существу."),
        description: z
          .string()
          .max(10_000)
          .optional()
          .describe("Постановка: что не так, где это видно и почему это стоит чинить."),
        category_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Категория из forge_categories_list — угадывать номер не нужно."),
        estimate_minutes: z
          .number()
          .int()
          .min(0)
          .max(1440)
          .optional()
          .describe("Оценка трудоёмкости в минутах, от 0 до 1440."),
      }).catchall(FORBIDDEN_FIELD),
      annotations: { openWorldHint: true },
    },
    async (draft) => {
      try {
        const filled = Object.fromEntries(
          Object.entries(draft).filter(([, value]) => value !== undefined),
        ) as { title: string };
        const task = await tasks.create(filled);
        return toolText(
          `Задача #${task.id} «${task.title}» заведена в общий список без исполнителя. ` +
            `Назначит её человек.`,
        );
      } catch (error) {
        return toolFailure(error, { action: "create" });
      }
    },
  );

  server.registerTool(
    "forge_task_archive",
    {
      title: "Убрать за собой заведённую задачу",
      description: [
        "Убирает в архив задачу, которую завёл этот же агент.",
        "Для проверочных задач: завёл по ходу работы — убери, а не оставляй человеку с припиской «это мусор».",
        "Право узкое, и это видно по отказам: убрать можно только своё, только пока задаче",
        "не назначили исполнителя и никто её не взял.",
        "Чужую или уже взятую задачу убрать нельзя — если она лишняя, скажите человеку.",
        "Вернуть убранное может только человек.",
      ].join(" "),
      inputSchema: z.object({ task_id: taskId }).catchall(FORBIDDEN_FIELD),
      annotations: { openWorldHint: true },
    },
    async ({ task_id }) => {
      try {
        await tasks.archive(task_id);
        return toolText(
          `Задача #${task_id} убрана в архив. Вернуть её оттуда может человек.`,
        );
      } catch (error) {
        return toolFailure(error, { action: "archive", taskId: task_id });
      }
    },
  );

  server.registerTool(
    "forge_categories_list",
    {
      title: "Категории задач",
      description:
        "Справочник категорий: нужен, чтобы при заведении задачи не угадывать category_id.",
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const categories = await tasks.categories();
        if (categories.length === 0) return toolText("Категорий пока нет.");
        return toolText(
          ["Категории:", ...categories.map((item) => `#${item.id} ${item.name}`)].join("\n"),
        );
      } catch (error) {
        return toolFailure(error, { action: "queue" });
      }
    },
  );
}
