import type { SourceInfo } from "./source-info.ts";

export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	sourceInfo: SourceInfo;
}

export interface BuiltinSlashCommand {
	name: string;
	description: string;
	argumentHint?: string;
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
	{ name: "settings", description: "Открыть меню настроек" },
	{ name: "model", description: "Выбрать модель (открывает окно выбора)", argumentHint: "<провайдер/модель>" },
	{ name: "tree", description: "Навигация по дереву сессий (переключение веток)" },
	{ name: "thinking", description: "Уровень рассуждений (thinking)", argumentHint: "<уровень>" },
	{ name: "scoped-models", description: "Настройка списка моделей для быстрого переключения" },
	{ name: "export", description: "Экспорт сессии (HTML по умолчанию, или .jsonl)" },
	{ name: "import", description: "Импорт сессии из файла JSONL" },
	{ name: "share", description: "Опубликовать сессию в GitHub Gist" },
	{ name: "bug", description: "Сообщить об ошибке разработчикам ПерУН", argumentHint: "<описание>" },
	{ name: "copy", description: "Скопировать последний ответ ассистента в буфер обмена" },
	{ name: "name", description: "Задать имя текущей сессии" },
	{ name: "session", description: "Информация и статистика сессии" },
	{ name: "changelog", description: "История изменений" },
	{ name: "hotkeys", description: "Список горячих клавиш" },
	{ name: "fork", description: "Создать новую ветку от предыдущего сообщения" },
	{ name: "clone", description: "Дублировать текущую сессию" },
	{ name: "trust", description: "Управление доверием к проекту" },
	{ name: "login", description: "Настроить авторизацию провайдера", argumentHint: "<провайдер>" },
	{ name: "logout", description: "Удалить авторизацию провайдера" },
	{ name: "new", description: "Начать новую сессию" },
	{ name: "compact", description: "Сжать контекст сессии (компрессия истории)" },
	{ name: "resume", description: "Возобновить другую сессию" },
	{ name: "reload", description: "Перезагрузить горячие клавиши, расширения, навыки и темы" },
	{ name: "quit", description: "Выйти из ПерУН" },
];
