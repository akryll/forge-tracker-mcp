import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TaskService } from "../tasks-service.js";
import { FORBIDDEN_FIELD } from "../tool-schema.js";
import { toolFailure, toolText } from "../tool-result.js";

const taskId = z
  .number()
  .int()
  .positive()
  .describe("Номер задачи — тот, что виден в forge_tasks_list и в ссылке на задачу.");

const skillId = z
  .number()
  .int()
  .positive()
  .describe("Номер скилла — из карточки задачи или из forge_skills_list.");

/**
 * Скиллы типа задачи (#7159): списком и целиком.
 *
 * Два инструмента, а не один, потому что и случая два. Список нужен, чтобы
 * понять, чем вообще работают в этой команде; текст — чтобы прочитать порядок
 * работы перед делом. Вливать тела в карточку задачи было бы нельзя: она
 * превратилась бы в справочник, а задача в ней потерялась бы.
 */
export function registerSkillTools(server: McpServer, tasks: TaskService): void {
  server.registerTool(
    "forge_skills_list",
    {
      title: "Скиллы задачи",
      description: [
        "Скиллы типа задачи: короткие порядки работы, которые человек прикрепил к этому типу.",
        "Видно имя, номер и описание; полный текст читает forge_skill_get.",
      ].join(" "),
      inputSchema: z.object({ task_id: taskId }).catchall(FORBIDDEN_FIELD),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ task_id }) => {
      try {
        const skills = await tasks.skills(task_id);
        if (skills.length === 0) {
          return toolText(
            `У задачи #${task_id} скиллов нет: либо у её типа их не прикрепили, либо у задачи нет типа. ` +
              `Скиллы к типам прикрепляет человек в разделе «Скиллы» и в типе задачи.`,
          );
        }

        const lines = skills.map((skill) =>
          skill.description?.trim()
            ? `- #${skill.id} ${skill.name} — ${skill.description.trim()}`
            : `- #${skill.id} ${skill.name}`,
        );
        return toolText(
          [
            `Скиллы задачи #${task_id}:`,
            ...lines,
            "",
            "Полный текст — forge_skill_get с task_id и skill_id.",
          ].join("\n"),
        );
      } catch (error) {
        return toolFailure(error, { action: "skill", taskId: task_id });
      }
    },
  );

  server.registerTool(
    "forge_skill_get",
    {
      title: "Прочитать скилл",
      description: [
        "Полный текст скилла, прикреплённого к типу задачи.",
        "Чужой ключ не видит ни задачи, ни скилла; скилл не из типа этой задачи не отдаётся.",
        "Читать перед работой: в скилле то, как её ведут именно в этой команде.",
      ].join(" "),
      inputSchema: z.object({ task_id: taskId, skill_id: skillId }).catchall(FORBIDDEN_FIELD),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ task_id, skill_id }) => {
      try {
        const skill = await tasks.skill(task_id, skill_id);
        const head = skill.description?.trim()
          ? `# ${skill.name}\n\n${skill.description.trim()}`
          : `# ${skill.name}`;
        return toolText(`${head}\n\n${skill.body}`);
      } catch (error) {
        return toolFailure(error, { action: "skill", taskId: task_id });
      }
    },
  );
}
