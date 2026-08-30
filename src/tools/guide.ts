import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ForgeClient } from "../forge-client.js";
import { toolFailure } from "../tool-result.js";

const GUIDE_URI = "forge://guide";

const DESCRIPTION = [
  "Памятка агента Forge: как устроены задачи, что агенту доверено и где проходят границы прав.",
  "Читать в начале работы. Отдаёт первоисточник с сервера, а не копию в промте, — поэтому",
  "памятка не разъезжается с тем, как Forge работает на самом деле.",
].join(" ");

/**
 * Памятка выставлена и инструментом, и ресурсом. Ресурс — правильная форма
 * для справочного текста, но агенты, которые видят только инструменты,
 * иначе до неё не дотянутся.
 */
export function registerGuide(server: McpServer, client: ForgeClient): void {
  server.registerResource(
    "forge_guide",
    GUIDE_URI,
    {
      title: "Памятка агента Forge",
      description: DESCRIPTION,
      mimeType: "text/markdown",
    },
    async (uri) => {
      const text = await client.requestText("/agent/guide", { accept: "text/markdown" });
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    },
  );

  server.registerTool(
    "forge_guide",
    {
      title: "Памятка агента Forge",
      description: DESCRIPTION,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const text = await client.requestText("/agent/guide", { accept: "text/markdown" });
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return toolFailure(error, { action: "guide" });
      }
    },
  );
}
