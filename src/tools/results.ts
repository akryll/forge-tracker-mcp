import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ScreenshotError, type ResultsService } from "../results-service.js";
import { FORBIDDEN_FIELD } from "../tool-schema.js";
import { toolFailure, toolText } from "../tool-result.js";

const taskId = z
  .number()
  .int()
  .positive()
  .describe("Номер задачи — тот, что виден в forge_tasks_list.");

function size(bytes: number): string {
  return bytes < 1024 ? `${bytes} Б` : `${(bytes / 1024).toFixed(1)} КБ`;
}

/** Дата без секунд: агенту важен порядок записей, а не миллисекунды. */
function date(iso: string): string {
  const value = new Date(iso);
  return Number.isNaN(value.getTime())
    ? iso
    : value.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

export function registerResultTools(server: McpServer, results: ResultsService): void {
  server.registerTool(
    "forge_comment_add",
    {
      title: "Написать в задачу",
      description: [
        "Комментарий в задачу — то, чем агент разговаривает с человеком: что сделано, что не вышло, что решено.",
        "Подпись берётся из ключа, а не из текста: назваться чужим именем нельзя, и представляться в тексте не нужно.",
        "Ответ человека комментарием снимает пометку вопроса с задачи.",
      ].join(" "),
      inputSchema: z.object({
        task_id: taskId,
        body: z.string().min(1).max(10_000).describe("Текст комментария, markdown."),
      }).catchall(FORBIDDEN_FIELD),
      annotations: { openWorldHint: true },
    },
    async ({ task_id, body }) => {
      try {
        const comment = await results.addComment(task_id, body);
        return toolText(`Комментарий записан в задачу #${task_id} за подписью «${comment.author_name}».`);
      } catch (error) {
        return toolFailure(error, { action: "comment", taskId: task_id });
      }
    },
  );

  server.registerTool(
    "forge_comments_list",
    {
      title: "Переписка задачи",
      description: [
        "Переписка задачи от старых записей к новым: чем человек и другие агенты отвечали по этой работе.",
        "Здесь же ищут ответ на свой вопрос: forge_task_ask ставит вопрос, а отвечает человек комментарием —",
        "больше нигде этот ответ не виден.",
        "Читать стоит и перед началом работы: в переписке лежат замечания, из-за которых задачу вернули.",
      ].join(" "),
      inputSchema: z.object({ task_id: taskId }).catchall(FORBIDDEN_FIELD),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ task_id }) => {
      try {
        const comments = await results.listComments(task_id);
        if (comments.length === 0) {
          return toolText(`В задаче #${task_id} ещё ничего не написано.`);
        }
        const lines = comments.map((comment) => {
          const who = comment.by_agent ? `${comment.author_name} (агент)` : comment.author_name;
          return `— ${who}, ${date(comment.created_at)}:\n${comment.body.trim()}`;
        });
        return toolText([`Переписка задачи #${task_id}:`, ...lines].join("\n\n"));
      } catch (error) {
        return toolFailure(error, { action: "comment", taskId: task_id });
      }
    },
  );

  server.registerTool(
    "forge_document_put",
    {
      title: "Приложить документ к задаче",
      description: [
        "Markdown-документ с результатом работы: отчёт, разбор, план.",
        "Отчёт без результата человеку бесполезен — в пустой задаче ему нечего открыть.",
        "Документ с тем же именем заменяется, а не кладётся вторым:",
        "перезапустив работу, выкладывайте тот же файл заново — «отчёт-2.md» плодить не нужно.",
        "Хранится только markdown: результат читают люди, исполняемому содержимому здесь делать нечего.",
      ].join(" "),
      inputSchema: z.object({
        task_id: taskId,
        filename: z
          .string()
          .min(1)
          .max(120)
          .regex(/\.(md|markdown)$/, "Только markdown: имя должно оканчиваться на .md")
          .regex(/^[^/\\]+$/, "Имя файла без путей")
          .describe("Имя файла, например «Результат тестирования.md». Без путей."),
        content: z.string().max(200_000).describe("Текст документа, markdown."),
      }).catchall(FORBIDDEN_FIELD),
      annotations: { idempotentHint: true, openWorldHint: true },
    },
    async ({ task_id, filename, content }) => {
      try {
        const document = await results.putDocument(task_id, filename, content);
        return toolText(
          `Документ «${document.filename}» приложен к задаче #${task_id} (${size(document.size)}).`,
        );
      } catch (error) {
        return toolFailure(error, { action: "document", taskId: task_id });
      }
    },
  );

  server.registerTool(
    "forge_documents_list",
    {
      title: "Документы задачи",
      description: [
        "Что уже приложено к задаче. Без document_id — список, с ним — текст одного документа.",
        "Полезно перед выкладкой: посмотреть, под каким именем отчёт уже лежит, и заменить его,",
        "а не завести второй такой же.",
      ].join(" "),
      inputSchema: z.object({
        task_id: taskId,
        document_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Прочитать один документ целиком."),
      }).catchall(FORBIDDEN_FIELD),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ task_id, document_id }) => {
      try {
        if (document_id !== undefined) {
          const document = await results.getDocument(task_id, document_id);
          return toolText(`# ${document.filename}\n\n${document.content}`);
        }
        const documents = await results.listDocuments(task_id);
        if (documents.length === 0) {
          return toolText(`К задаче #${task_id} ничего не приложено.`);
        }
        const lines = documents.map(
          (document) =>
            `#${document.id} ${document.filename} — ${document.author_name}` +
            `${document.by_agent ? " (агент)" : ""}, ${size(document.size)}`,
        );
        return toolText([`Документы задачи #${task_id}:`, ...lines].join("\n"));
      } catch (error) {
        return toolFailure(error, { action: "document", taskId: task_id });
      }
    },
  );

  server.registerTool(
    "forge_screenshot_add",
    {
      title: "Приложить скриншот к задаче",
      description: [
        "Картинка с экрана — тем, что проверялось, показывают, а не пересказывают.",
        "Инструмент берёт файл с диска по пути и кодирует его сам: возиться с base64 не нужно.",
        "Принимаются png, jpeg, webp и gif; слишком большой файл отвергается с объяснением,",
        "а не обрывает запрос.",
      ].join(" "),
      inputSchema: z.object({
        task_id: taskId,
        path: z.string().min(1).describe("Путь к файлу картинки на диске."),
        filename: z
          .string()
          .min(1)
          .max(120)
          .optional()
          .describe("Имя, под которым файл ляжет в задачу. По умолчанию — имя файла с диска."),
      }).catchall(FORBIDDEN_FIELD),
      annotations: { openWorldHint: true },
    },
    async ({ task_id, path, filename }) => {
      try {
        const shot = await results.addScreenshot(task_id, path, filename);
        return toolText(
          `Скриншот «${shot.filename}» приложен к задаче #${task_id} (${shot.content_type}, ${size(shot.size)}).`,
        );
      } catch (error) {
        if (error instanceof ScreenshotError) return toolText(error.message, { isError: true });
        return toolFailure(error, { action: "screenshot", taskId: task_id });
      }
    },
  );
}
