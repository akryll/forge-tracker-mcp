import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.js";
import { ForgeClient } from "./forge-client.js";
import { ResultsService } from "./results-service.js";
import { TaskService } from "./tasks-service.js";
import { registerGuide } from "./tools/guide.js";
import { registerResultTools } from "./tools/results.js";
import { registerTaskTools, registerTesterTools } from "./tools/tasks.js";

export const SERVER_NAME = "forge";
export const SERVER_VERSION = "0.1.0";

const INSTRUCTIONS = [
  "Инструменты работы с задачами Forge от имени ИИ-сотрудника.",
  "",
  "Ключ агента живёт внутри сервера: подставлять его в запросы не нужно и нельзя.",
  "Задачи назначает человек — агент видит ровно то, что назначено ему.",
  "Начинать работу с forge_guide: там первоисточник про порядок и границы прав.",
].join("\n");

/**
 * Новый экземпляр сервера на каждое подключение: у транспорта HTTP сессий
 * бывает много, а состояние у них общим быть не должно.
 */
export function createServer(config: Config): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );
  const client = new ForgeClient(config);
  registerGuide(server, client);
  const taskService = new TaskService(client);
  registerTaskTools(server, taskService);
  registerTesterTools(server, taskService);
  registerResultTools(server, new ResultsService(client, config.maxScreenshotBytes));
  return server;
}
