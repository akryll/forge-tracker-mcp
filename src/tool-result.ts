import { describeFailure, type Context } from "./failure.js";

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  // SDK ждёт открытый тип результата — без этого его дженерик не сходится.
  [key: string]: unknown;
}

/** Обычный текстовый ответ инструмента. */
export function toolText(text: string, options: { isError?: boolean } = {}): ToolResult {
  return options.isError
    ? { content: [{ type: "text", text }], isError: true }
    : { content: [{ type: "text", text }] };
}

/**
 * Отказ в форме, понятной агенту: объяснением, а не кодом ответа. Что именно
 * значит отказ, зависит от того, что агент делал, — отсюда контекст.
 */
export function toolFailure(error: unknown, context: Context): ToolResult {
  return { content: [{ type: "text", text: describeFailure(error, context) }], isError: true };
}
