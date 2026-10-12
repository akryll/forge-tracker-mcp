import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";

const input = process.stdin;
const output = process.stdout;

const ansi = {
  clear: "\x1b[2J\x1b[H",
  hide: "\x1b[?25l",
  show: "\x1b[?25h",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

export interface MenuItem<T> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
  readonly disabled?: boolean;
}

export function ensureInteractive(): void {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("Для мастера нужен интерактивный терминал (TTY). Запустите forge-mcp-setup вручную.");
  }
}

export function page(title: string, lines: readonly string[] = []): void {
  output.write(
    `${ansi.clear}${ansi.bold}${ansi.cyan}◆ Forge MCP${ansi.reset}\n` +
      `${ansi.bold}${title}${ansi.reset}\n\n${lines.join("\n")}${lines.length ? "\n" : ""}`,
  );
}

function setRaw(enabled: boolean): void {
  if (input.isTTY) input.setRawMode(enabled);
  // readline.close() ставит stdin на паузу. Следующий raw-prompt иначе остаётся
  // без активных handles: Node тихо завершается, а ввод попадает обратно в shell.
  if (enabled) input.resume();
}

export async function menu<T>(
  title: string,
  items: readonly MenuItem<T>[],
  initial = 0,
): Promise<T> {
  if (items.length === 0) throw new Error("Меню не может быть пустым.");
  emitKeypressEvents(input);
  let selected = Math.min(Math.max(initial, 0), items.length - 1);
  while (items[selected]?.disabled) selected = (selected + 1) % items.length;

  return await new Promise<T>((resolve, reject) => {
    const render = (): void => {
      page(title);
      items.forEach((item, index) => {
        const active = index === selected;
        const prefix = active ? `${ansi.cyan}❯${ansi.reset}` : " ";
        const style = item.disabled ? ansi.dim : active ? ansi.bold : "";
        const hint = item.hint ? ` ${ansi.dim}${item.hint}${ansi.reset}` : "";
        output.write(`${prefix} ${style}${item.label}${ansi.reset}${hint}\n`);
      });
      output.write(`\n${ansi.dim}↑/↓ — выбрать · Enter — подтвердить · Esc — назад${ansi.reset}${ansi.hide}`);
    };
    const finish = (callback: () => void): void => {
      input.off("keypress", onKey);
      setRaw(false);
      output.write(ansi.show);
      callback();
    };
    const onKey = (_character: string, key: { name?: string; ctrl?: boolean }): void => {
      if (key.ctrl && key.name === "c") {
        finish(() => reject(new Error("INTERRUPTED")));
        return;
      }
      if (key.name === "up" || key.name === "k") {
        do selected = (selected - 1 + items.length) % items.length;
        while (items[selected]?.disabled);
        render();
      } else if (key.name === "down" || key.name === "j") {
        do selected = (selected + 1) % items.length;
        while (items[selected]?.disabled);
        render();
      } else if (key.name === "return") {
        const value = items[selected]?.value;
        if (value !== undefined && !items[selected]?.disabled) finish(() => resolve(value));
      } else if (key.name === "escape") {
        const last = items.at(-1);
        if (last && !last.disabled) finish(() => resolve(last.value));
      }
    };
    setRaw(true);
    input.on("keypress", onKey);
    render();
  });
}

export async function promptText(
  title: string,
  label: string,
  options: { readonly initial?: string; readonly validate?: (value: string) => string | undefined } = {},
): Promise<string> {
  while (true) {
    page(title, [label, options.initial ? `${ansi.dim}Enter = ${options.initial}${ansi.reset}` : ""]);
    const rl = createInterface({ input, output });
    let answer: string;
    try {
      answer = await rl.question("> ");
    } finally {
      rl.close();
    }
    const value = answer.trim() || options.initial || "";
    const error = options.validate?.(value);
    if (!error) return value;
    await notice("Проверьте значение", error);
  }
}

export async function promptSecret(title: string, label: string, keepExisting = false): Promise<string> {
  emitKeypressEvents(input);
  page(title, [label, keepExisting ? `${ansi.dim}Оставьте пустым, чтобы сохранить текущий ключ.${ansi.reset}` : ""]);
  output.write("> ");
  let value = "";
  return await new Promise<string>((resolve, reject) => {
    const finish = (callback: () => void): void => {
      input.off("keypress", onKey);
      setRaw(false);
      output.write(`\n${ansi.show}`);
      callback();
    };
    const redraw = (): void => {
      output.write(`\r\x1b[2K> ${"•".repeat(value.length)}`);
    };
    const onKey = (character: string, key: { name?: string; ctrl?: boolean; sequence?: string }): void => {
      if (key.ctrl && key.name === "c") {
        finish(() => reject(new Error("INTERRUPTED")));
      } else if (key.name === "return") {
        finish(() => resolve(value));
      } else if (key.name === "backspace") {
        value = value.slice(0, -1);
        redraw();
      } else if (!key.ctrl && key.name !== "escape" && character && !/^\x1b/.test(character)) {
        value += character;
        redraw();
      }
    };
    setRaw(true);
    input.on("keypress", onKey);
  });
}

export async function confirm(title: string, question: string, defaultYes = true): Promise<boolean> {
  return await menu(title, [
    { value: true, label: "Да" },
    { value: false, label: "Нет" },
  ], defaultYes ? 0 : 1);
}

export async function notice(title: string, message: string): Promise<void> {
  page(title, message.split("\n"));
  const rl = createInterface({ input, output });
  try {
    await rl.question(`\n${ansi.dim}Нажмите Enter, чтобы продолжить…${ansi.reset}`);
  } finally {
    rl.close();
  }
}

export function restoreTerminal(): void {
  if (input.isTTY) setRaw(false);
  if (output.isTTY) output.write(ansi.show);
}
