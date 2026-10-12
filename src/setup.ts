#!/usr/bin/env node
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  asProfileError,
  loadProfileStore,
  nodeVersionSupported,
  profileStorePath,
  publicProfile,
  removeProfile,
  saveProfileStore,
  suggestProfileSlug,
  testProfile,
  upsertProfile,
  validateProfileSlug,
  type Profile,
  type ProfileStore,
} from "./profiles.js";
import {
  clientChoices,
  defaultServerName,
  installClient,
  serverCommand,
  type ClientId,
} from "./setup/clients.js";
import {
  confirm,
  ensureInteractive,
  menu,
  notice,
  page,
  promptSecret,
  promptText,
  restoreTerminal,
} from "./setup/tui.js";

const runnerPath = fileURLToPath(new URL("./profile-runner.js", import.meta.url));

function profileItems(store: ProfileStore): Array<{ value: string; label: string; hint: string }> {
  return Object.entries(store.profiles)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name, "ru"))
    .map(([slug, profile]) => ({ value: slug, label: profile.name, hint: `${slug} · ${profile.apiUrl}` }));
}

async function collectProfile(
  store: ProfileStore,
  existingSlug?: string,
): Promise<{ store: ProfileStore; slug: string }> {
  const existing = existingSlug ? store.profiles[existingSlug] : undefined;
  const name = await promptText(existing ? "Редактирование профиля" : "Новый профиль", "Понятное название:", {
    initial: existing?.name,
    validate: (value) => (value ? undefined : "Введите название."),
  });
  const suggested = existingSlug ?? suggestProfileSlug(name);
  const slug = await promptText("Идентификатор профиля", "Используется в командах и конфигах:", {
    initial: suggested,
    validate: (value) => {
      try {
        validateProfileSlug(value);
        if (!existingSlug && store.profiles[value]) return "Такой профиль уже существует.";
        if (existingSlug && value !== existingSlug && store.profiles[value]) return "Такой профиль уже существует.";
        return undefined;
      } catch (error) {
        return asProfileError(error).message;
      }
    },
  });
  const apiUrl = await promptText("Адрес Forge", "Корень агентского API:", {
    initial: existing?.apiUrl ?? "http://localhost:8090/api/v1",
    validate: (value) => {
      try {
        new URL(value);
        return /^https?:/.test(value) ? undefined : "Нужен адрес http:// или https://";
      } catch {
        return "Введите полный URL.";
      }
    },
  });
  const enteredKey = await promptSecret(
    "Ключ агента",
    "Вставьте ключ со страницы /agents (ввод скрыт):",
    Boolean(existing),
  );
  const agentKey = enteredKey || existing?.agentKey || "";
  if (!agentKey.startsWith("fga_")) {
    await notice("Ключ не сохранён", "Ключ Forge должен начинаться с fga_.");
    return await collectProfile(store, existingSlug);
  }
  const timeoutRaw = await promptText("Таймаут", "Сколько миллисекунд ждать ответа Forge:", {
    initial: String(existing?.timeoutMs ?? 15_000),
    validate: (value) => {
      const number = Number(value);
      return Number.isInteger(number) && number > 0 ? undefined : "Введите положительное целое число.";
    },
  });

  let updated = upsertProfile(store, slug, {
    name,
    apiUrl,
    agentKey,
    timeoutMs: Number(timeoutRaw),
  });
  if (existingSlug && slug !== existingSlug) updated = removeProfile(updated, existingSlug);

  page("Проверка соединения", ["Обращаюсь к Forge без передачи ключа куда-либо ещё…"]);
  try {
    const profile = updated.profiles[slug];
    if (!profile) throw new Error("Профиль не собран.");
    await testProfile(profile);
    saveProfileStore(updated);
    await notice("Профиль сохранён", `✓ Forge отвечает\n✓ Ключ хранится в ${profileStorePath()} с правами 0600`);
  } catch (error) {
    const message = asProfileError(error).message;
    const saveAnyway = await confirm("Forge пока не ответил", `${message}\n\nСохранить профиль всё равно?`, false);
    if (!saveAnyway) return { store, slug: existingSlug ?? slug };
    saveProfileStore(updated);
    await notice("Профиль сохранён", "Подключение можно проверить позже из меню профиля.");
  }
  return { store: updated, slug };
}

async function connectProfile(slug: string, profile: Profile): Promise<void> {
  const clients = clientChoices();
  const client = await menu<ClientId | "back">(
    `Куда подключить «${profile.name}»?`,
    [
      ...clients.map((item) => ({
        value: item.id,
        label: `${item.label}${item.detected ? "  ✓" : ""}`,
        hint: item.detected ? item.hint : `${item.hint} · не найден, конфиг всё равно можно создать`,
      })),
      { value: "back", label: "Назад" },
    ],
  );
  if (client === "back") return;
  const name = await promptText("Имя MCP-сервера", "Под этим именем сервер появится у нейросети:", {
    initial: defaultServerName(slug),
    validate: (value) =>
      /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value)
        ? undefined
        : "Допустимы латинские буквы, цифры, точка, _ и - (до 64 символов).",
  });
  page("Подключение", ["Обновляю конфигурацию клиента…"]);
  try {
    const result = installClient(client, name, serverCommand(runnerPath, slug));
    const lines = [result.summary];
    if (result.path) lines.push(`Файл: ${result.path}`);
    if (result.backupPath) lines.push(`Резервная копия: ${result.backupPath}`);
    if (result.preview) lines.push("", result.preview);
    lines.push("", "Ключ в конфиг клиента не записывался.");
    await notice("Готово", lines.join("\n"));
  } catch (error) {
    await notice("Не удалось подключить", `${asProfileError(error).message}\n\nСуществующий сервер с тем же именем сначала удалите в клиенте.`);
  }
}

async function manageProfile(initialStore: ProfileStore, slug: string): Promise<ProfileStore> {
  let store = initialStore;
  while (store.profiles[slug]) {
    const profile = store.profiles[slug];
    if (!profile) break;
    const action = await menu<"connect" | "test" | "edit" | "delete" | "back">(
      profile.name,
      [
        { value: "connect", label: "Подключить к нейросети", hint: "ключ останется в защищённом профиле" },
        { value: "test", label: "Проверить соединение", hint: profile.apiUrl },
        { value: "edit", label: "Изменить профиль", hint: "адрес, ключ, таймаут" },
        { value: "delete", label: "Удалить профиль", hint: "конфиги клиентов останутся" },
        { value: "back", label: "Назад" },
      ],
    );
    if (action === "back") return store;
    if (action === "connect") await connectProfile(slug, profile);
    if (action === "test") {
      page("Проверка соединения", [profile.apiUrl]);
      try {
        await testProfile(profile);
        await notice("Соединение работает", "✓ Адрес доступен\n✓ Ключ принят Forge");
      } catch (error) {
        await notice("Проверка не прошла", asProfileError(error).message);
      }
    }
    if (action === "edit") {
      const result = await collectProfile(store, slug);
      store = result.store;
      slug = result.slug;
    }
    if (action === "delete") {
      const approved = await confirm(
        "Удалить профиль?",
        `Будет удалён ключ профиля «${profile.name}». Записи в клиентах нужно удалить отдельно.`,
        false,
      );
      if (approved) {
        store = removeProfile(store, slug);
        saveProfileStore(store);
        await notice("Профиль удалён", `Удалён профиль «${profile.name}».`);
      }
    }
  }
  return store;
}

async function profilesMenu(initialStore: ProfileStore): Promise<ProfileStore> {
  let store = initialStore;
  while (true) {
    const selected = await menu<string>("Профили Forge", [
      { value: "__new", label: "Создать профиль", hint: "отдельный адрес и ключ" },
      ...profileItems(store),
      { value: "__back", label: "Назад" },
    ]);
    if (selected === "__back") return store;
    if (selected === "__new") {
      const result = await collectProfile(store);
      store = result.store;
    } else {
      store = await manageProfile(store, selected);
    }
  }
}

function npmVersion(): string {
  const result = spawnSync("npm", ["--version"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "не найден";
}

async function diagnostics(store: ProfileStore): Promise<void> {
  const path = profileStorePath();
  let permissions = "файл ещё не создан";
  try {
    permissions = (statSync(path).mode & 0o777).toString(8).padStart(3, "0");
  } catch {
    // Текст выше уже объясняет отсутствие файла.
  }
  const clients = clientChoices().filter((client) => client.detected && client.id !== "generic");
  const installedNpm = npmVersion();
  await notice(
    "Диагностика",
    [
      `${nodeVersionSupported() ? "✓" : "✗"} Node.js ${process.versions.node} (нужно ≥ 20.11)`,
      `${installedNpm === "не найден" ? "✗" : "✓"} npm ${installedNpm}`,
      `✓ Путь профилей: ${path}`,
      `  Права файла: ${permissions}${process.platform === "win32" ? " (ACL Windows)" : ""}`,
      `  Профилей: ${Object.keys(store.profiles).length}`,
      `  Обнаружены клиенты: ${clients.map((client) => client.label).join(", ") || "нет"}`,
      `✓ Раннер: ${runnerPath}`,
    ].join("\n"),
  );
}

async function interactive(): Promise<void> {
  ensureInteractive();
  if (!nodeVersionSupported()) {
    throw new Error(`Нужен Node.js 20.11 или новее, сейчас ${process.versions.node}.`);
  }
  let store = loadProfileStore();
  while (true) {
    const count = Object.keys(store.profiles).length;
    const action = await menu<"quick" | "profiles" | "connect" | "diagnostics" | "exit">(
      "Установка и настройка",
      [
        { value: "quick", label: "Быстрая настройка", hint: "профиль → проверка → клиент" },
        { value: "profiles", label: "Профили и ключи", hint: `${count} шт.` },
        { value: "connect", label: "Подключить профиль", hint: "Claude, Codex, Cursor и другие" },
        { value: "diagnostics", label: "Диагностика", hint: "Node.js, npm, клиенты и права" },
        { value: "exit", label: "Выйти" },
      ],
    );
    if (action === "exit") return;
    if (action === "profiles") store = await profilesMenu(store);
    if (action === "diagnostics") await diagnostics(store);
    if (action === "quick") {
      let slug: string;
      if (Object.keys(store.profiles).length === 0) {
        const result = await collectProfile(store);
        store = result.store;
        slug = result.slug;
      } else {
        const selected = await menu<string>("Выберите профиль", [
          ...profileItems(store),
          { value: "__new", label: "Создать новый" },
          { value: "__back", label: "Назад" },
        ]);
        if (selected === "__back") continue;
        if (selected === "__new") {
          const result = await collectProfile(store);
          store = result.store;
          slug = result.slug;
        } else {
          slug = selected;
        }
      }
      const profile = store.profiles[slug];
      if (profile) await connectProfile(slug, profile);
    }
    if (action === "connect") {
      if (count === 0) {
        await notice("Профилей пока нет", "Сначала создайте профиль с адресом Forge и ключом агента.");
      } else {
        const selected = await menu<string>("Выберите профиль", [
          ...profileItems(store),
          { value: "__back", label: "Назад" },
        ]);
        if (selected !== "__back") {
          const profile = store.profiles[selected];
          if (profile) await connectProfile(selected, profile);
        }
      }
    }
  }
}

function printHelp(): void {
  process.stdout.write(`forge-mcp-setup — интерактивная настройка Forge MCP

  forge-mcp-setup          открыть TUI с управлением стрелками
  forge-mcp-setup --list   показать профили без секретов
  forge-mcp-setup --help   эта справка

Путь хранилища можно переопределить переменной FORGE_MCP_CONFIG.
`);
}

async function main(): Promise<void> {
  const argument = process.argv[2];
  if (argument === "--help" || argument === "-h") return printHelp();
  if (argument === "--list") {
    const store = loadProfileStore();
    process.stdout.write(`${JSON.stringify(Object.entries(store.profiles).map(([slug, profile]) => publicProfile(slug, profile)), null, 2)}\n`);
    return;
  }
  if (argument) throw new Error(`Неизвестный аргумент: ${argument}. Используйте --help.`);
  await interactive();
}

main()
  .catch((error: unknown) => {
    restoreTerminal();
    if (error instanceof Error && error.message === "INTERRUPTED") return;
    process.stderr.write(`forge-mcp-setup: ${asProfileError(error).message}\n`);
    process.exitCode = 1;
  })
  .finally(restoreTerminal);
