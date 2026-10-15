import type { BslAstSymbol, BslParameter } from "../types.ts";

function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isBslDocComplete(existingDoc?: string, parameters?: readonly BslParameter[]): boolean {
	if (!existingDoc || !existingDoc.trim()) {
		return false;
	}

	const rawLines = existingDoc.split(/\r?\n/);
	const contentLines = rawLines
		.map((line) => line.replace(/^\s*\/\/\s?/, "").trim())
		.filter((line) => line.length > 0);

	if (contentLines.length === 0) {
		return false;
	}

	const sectionHeaderRegex = /^(параметры|parameters|возвращаемое значение|return value|пример|example):?$/i;
	const hasDescription = contentLines.some((line) => !sectionHeaderRegex.test(line));
	if (!hasDescription) {
		return false;
	}

	if (parameters && parameters.length > 0) {
		const hasParamSection = rawLines.some((line) => {
			const cleaned = line.replace(/^\s*\/\/\s?/, "").trim();
			return /^(параметры|parameters):?$/i.test(cleaned);
		});

		if (!hasParamSection) {
			return false;
		}

		for (const param of parameters) {
			const paramRegex = new RegExp(`(?<![А-Яа-яA-Za-z0-9_])${escapeRegex(param.name)}(?![А-Яа-яA-Za-z0-9_])`, "i");
			if (!paramRegex.test(existingDoc)) {
				return false;
			}
		}
	}

	return true;
}

export function inferParameterType(paramName: string): { type: string; description: string } {
	const lower = paramName.toLowerCase();

	if (lower === "отказ" || lower === "cancel") {
		return { type: "Булево", description: "Признак отказа" };
	}
	if (lower === "стандартнаяобработка" || lower === "standardprocessing") {
		return { type: "Булево", description: "Признак выполнения стандартной обработки" };
	}
	if (lower === "этоновый" || lower === "isnew" || lower === "этогруппа" || lower === "isfolder") {
		return { type: "Булево", description: `Признак ${paramName}` };
	}
	if (
		lower.startsWith("флаг") ||
		lower.startsWith("признак") ||
		lower.startsWith("разрешить") ||
		lower.startsWith("запретить") ||
		lower.startsWith("использовать") ||
		lower.startsWith("проверять") ||
		lower.startsWith("is") ||
		lower.startsWith("has") ||
		lower.startsWith("enable") ||
		lower.startsWith("use")
	) {
		return { type: "Булево", description: `Признак ${paramName}` };
	}

	if (lower.includes("документссылка")) {
		return { type: "ДокументСсылка", description: "Ссылка на документ" };
	}
	if (lower.includes("справочникссылка")) {
		return { type: "СправочникСсылка", description: "Ссылка на элемент справочника" };
	}
	if (lower.includes("планвидовхарактеристикссылка")) {
		return { type: "ПланВидовХарактеристикСсылка", description: "Ссылка на план видов характеристик" };
	}
	if (lower.includes("перечислениессылка")) {
		return { type: "ПеречислениеСсылка", description: "Значение перечисления" };
	}
	if (lower.endsWith("ссылка") || lower.endsWith("ref")) {
		return { type: paramName.endsWith("Ссылка") ? paramName : "ЛюбаяСсылка", description: "Ссылка на объект" };
	}

	if (lower.endsWith("объект") || lower.endsWith("object")) {
		return { type: paramName, description: `Объект ${paramName}` };
	}

	if (lower.includes("структура") || lower.includes("structure")) {
		return { type: "Структура", description: "Структура с параметрами" };
	}
	if (
		lower.includes("параметр") ||
		lower.includes("param") ||
		lower.includes("настройки") ||
		lower.includes("settings") ||
		lower.includes("контекст") ||
		lower.includes("context") ||
		lower === "данныезаполнения"
	) {
		return { type: "Структура", description: `Параметры ${paramName}` };
	}

	if (lower.includes("соответствие") || lower.includes("map")) {
		return { type: "Соответствие", description: "Соответствие значений" };
	}
	if (lower.includes("списокзначений") || lower.includes("valuelist")) {
		return { type: "СписокЗначений", description: "Список значений" };
	}
	if (lower.includes("массив") || lower.includes("array") || lower.includes("список") || lower.includes("list")) {
		return { type: "Массив", description: `Массив ${paramName}` };
	}
	if (
		lower.includes("таблицазначений") ||
		lower.includes("таблица") ||
		lower.includes("тз") ||
		lower.includes("table")
	) {
		return { type: "ТаблицаЗначений", description: "Таблица значений" };
	}
	if (lower.includes("деревозначений") || lower.includes("дерево") || lower.includes("tree")) {
		return { type: "ДеревоЗначений", description: "Дерево значений" };
	}

	if (
		lower.includes("строка") ||
		lower.includes("текст") ||
		lower.includes("имя") ||
		lower.includes("наименование") ||
		lower.includes("код") ||
		lower.includes("string") ||
		lower.includes("text") ||
		lower.includes("name") ||
		lower.includes("title") ||
		lower.includes("description") ||
		lower.includes("представление") ||
		lower.includes("путь") ||
		lower.includes("path")
	) {
		return { type: "Строка", description: `Строка ${paramName}` };
	}

	if (
		lower.includes("число") ||
		lower.includes("количество") ||
		lower.includes("сумма") ||
		lower.includes("цена") ||
		lower.includes("номер") ||
		lower.includes("процент") ||
		lower.includes("ставка") ||
		lower.includes("счетчик") ||
		lower.includes("индекс") ||
		lower.includes("number") ||
		lower.includes("count") ||
		lower.includes("amount") ||
		lower.includes("price") ||
		lower.includes("qty") ||
		lower.includes("index") ||
		lower.includes("total") ||
		lower.includes("колво")
	) {
		return { type: "Число", description: `Числовое значение ${paramName}` };
	}

	if (
		lower.includes("дата") ||
		lower.includes("период") ||
		lower.includes("моментвремени") ||
		lower.includes("граница") ||
		lower.includes("date") ||
		lower.includes("period")
	) {
		return { type: "Дата", description: "Дата или период" };
	}

	if (lower.includes("двоичныеданные") || lower.includes("binarydata")) {
		return { type: "ДвоичныеДанные", description: "Двоичные данные" };
	}
	if (lower.includes("уникальныйидентификатор") || lower.includes("uuid") || lower.includes("guid")) {
		return { type: "УникальныйИдентификатор", description: "Уникальный идентификатор" };
	}

	if (lower.includes("запрос") || lower.includes("query")) {
		return { type: "Запрос", description: "Объект Запрос" };
	}
	if (lower.includes("выборка")) {
		return { type: "ВыборкаИзРезультатаЗапроса", description: "Выборка из результата запроса" };
	}
	if (lower.includes("результатзапроса")) {
		return { type: "РезультатЗапроса", description: "Результат выполнения запроса" };
	}

	if (lower.includes("управляемаяформа") || lower.includes("форма") || lower.includes("form")) {
		return { type: "УправляемаяФорма", description: "Форма" };
	}
	if (lower.includes("элементформы") || lower.includes("элемент") || lower.includes("item")) {
		return { type: "ЭлементФормы", description: "Элемент формы" };
	}
	if (lower.includes("источник") || lower.includes("source")) {
		return { type: "Произвольный", description: "Источник события" };
	}

	return { type: "Произвольный", description: `Параметр ${paramName}` };
}

function inferReturnType(functionName: string): { type: string; description: string } {
	const lower = functionName.toLowerCase();

	if (
		lower.startsWith("это") ||
		lower.startsWith("есть") ||
		lower.startsWith("проверить") ||
		lower.startsWith("содержит") ||
		lower.startsWith("is") ||
		lower.startsWith("has") ||
		lower.startsWith("contains") ||
		lower.startsWith("check")
	) {
		return { type: "Булево", description: "Истина, если проверка пройдена" };
	}

	if (
		lower.startsWith("получитьимя") ||
		lower.startsWith("получитьтекст") ||
		lower.startsWith("получитьстроку") ||
		lower.startsWith("получитькод") ||
		lower.startsWith("gettext") ||
		lower.startsWith("getname")
	) {
		return { type: "Строка", description: "Строковое значение" };
	}

	if (
		lower.startsWith("получитьколичество") ||
		lower.startsWith("получитьсумму") ||
		lower.startsWith("получитьчисло") ||
		lower.startsWith("getcount") ||
		lower.startsWith("getamount")
	) {
		return { type: "Число", description: "Числовое значение" };
	}

	if (
		lower.startsWith("получитьмассив") ||
		lower.startsWith("получитьсписок") ||
		lower.startsWith("getlist") ||
		lower.startsWith("getarray")
	) {
		return { type: "Массив", description: "Массив значений" };
	}

	if (
		lower.startsWith("получитьструктуру") ||
		lower.startsWith("получитьпараметры") ||
		lower.startsWith("получитьнастройки")
	) {
		return { type: "Структура", description: "Структура с параметрами" };
	}

	if (lower.startsWith("получитьтаблицу") || lower.startsWith("получитьтз")) {
		return { type: "ТаблицаЗначений", description: "Таблица значений" };
	}

	if (lower.startsWith("получитьформу")) {
		return { type: "УправляемаяФорма", description: "Управляемая форма" };
	}

	if (lower.endsWith("ссылка")) {
		return { type: "ЛюбаяСсылка", description: "Ссылка на объект" };
	}

	return { type: "Произвольный", description: "Результат выполнения функции" };
}

function extractExistingDescription(existingDoc?: string): string | undefined {
	if (!existingDoc) return undefined;

	const lines = existingDoc.split(/\r?\n/);
	const descriptionLines: string[] = [];
	const sectionHeaderRegex = /^(параметры|parameters|возвращаемое значение|return value|пример|example):?$/i;

	for (const line of lines) {
		const cleaned = line.replace(/^\s*\/\/\s?/, "").trim();
		if (!cleaned) {
			if (descriptionLines.length > 0) {
				break;
			}
			continue;
		}
		if (sectionHeaderRegex.test(cleaned)) {
			break;
		}
		descriptionLines.push(cleaned);
	}

	return descriptionLines.length > 0 ? descriptionLines.join("\n// ") : undefined;
}

function extractExistingParamsDoc(existingDoc?: string): Map<string, { type: string; description: string }> {
	const map = new Map<string, { type: string; description: string }>();
	if (!existingDoc) return map;

	const lines = existingDoc.split(/\r?\n/);
	const paramLineRegex = /^\s*\/\/\s*([А-Яа-яA-Za-z0-9_]+)\s*-\s*([^-]+?)\s*-\s*(.+)$/;

	for (const line of lines) {
		const match = paramLineRegex.exec(line);
		if (match) {
			map.set(match[1].toLowerCase(), {
				type: match[2].trim(),
				description: match[3].trim(),
			});
		}
	}

	return map;
}

function inferRoutineDescription(symbol: BslAstSymbol): string {
	const existing = extractExistingDescription(symbol.bslDoc);
	if (existing) {
		return existing;
	}

	const name = symbol.name;
	const lower = name.toLowerCase();

	if (lower === "передзаписью") {
		return "Обработчик события ПередЗаписью.";
	}
	if (lower === "присозданиинасервере") {
		return "Обработчик события ПриСозданииНаСервере.";
	}
	if (lower === "приоткрытии") {
		return "Обработчик события ПриОткрытии.";
	}
	if (lower === "призаписи") {
		return "Обработчик события ПриЗаписи.";
	}
	if (lower === "призакрытии") {
		return "Обработчик события ПриЗакрытии.";
	}
	if (lower.startsWith("при")) {
		return `Обработчик события ${name}.`;
	}
	if (lower.startsWith("обработка")) {
		return `Обработчик события ${name}.`;
	}

	if (lower.startsWith("получить")) {
		return `Возвращает ${name.slice(8)}.`;
	}
	if (lower.startsWith("установить")) {
		return `Устанавливает ${name.slice(10)}.`;
	}
	if (lower.startsWith("проверить")) {
		return `Проверяет ${name.slice(9)}.`;
	}
	if (lower.startsWith("заполнить")) {
		return `Заполняет ${name.slice(9)}.`;
	}
	if (lower.startsWith("создать")) {
		return `Создает ${name.slice(7)}.`;
	}
	if (lower.startsWith("рассчитать")) {
		return `Рассчитывает ${name.slice(10)}.`;
	}
	if (lower.startsWith("сформировать")) {
		return `Формирует ${name.slice(12)}.`;
	}
	if (lower.startsWith("обновить")) {
		return `Обновляет ${name.slice(8)}.`;
	}
	if (lower.startsWith("удалить")) {
		return `Удаляет ${name.slice(7)}.`;
	}

	if (symbol.type === "function") {
		return `Возвращает результат вызова ${name}.`;
	}
	return `Выполняет ${name}.`;
}

export function generateBslDoc(symbol: BslAstSymbol): string {
	const docLines: string[] = [];

	const description = inferRoutineDescription(symbol);
	docLines.push(`// ${description}`);

	const existingParamsDoc = extractExistingParamsDoc(symbol.bslDoc);

	if (symbol.parameters && symbol.parameters.length > 0) {
		docLines.push("//");
		docLines.push("// Параметры:");

		for (const param of symbol.parameters) {
			const existing = existingParamsDoc.get(param.name.toLowerCase());
			if (existing) {
				docLines.push(`//   ${param.name} - ${existing.type} - ${existing.description}`);
			} else {
				const inferred = inferParameterType(param.name);
				docLines.push(`//   ${param.name} - ${inferred.type} - ${inferred.description}`);
			}
		}
	}

	if (symbol.type === "function") {
		docLines.push("//");
		docLines.push("// Возвращаемое значение:");
		const ret = inferReturnType(symbol.name);
		docLines.push(`//   ${ret.type} - ${ret.description}`);
	}

	return docLines.join("\n");
}

export function injectBslDocIntoModule(sourceCode: string, symbol: BslAstSymbol, bslDoc: string): string {
	const hasCrlf = sourceCode.includes("\r\n");
	const newline = hasCrlf ? "\r\n" : "\n";
	const lines = sourceCode.split(/\r?\n/);

	let procLineIdx = symbol.startLine - 1;
	const procMatchRegex = new RegExp(
		`^\\s*(?:процедура|функция|procedure|function)\\s+${escapeRegex(symbol.name)}\\s*\\(`,
		"i",
	);

	if (procLineIdx < 0 || procLineIdx >= lines.length || !procMatchRegex.test(lines[procLineIdx])) {
		const foundIdx = lines.findIndex((l) => procMatchRegex.test(l));
		if (foundIdx !== -1) {
			procLineIdx = foundIdx;
		}
	}

	if (procLineIdx < 0 || procLineIdx >= lines.length) {
		return sourceCode;
	}

	let directiveLineIdx = -1;
	let idx = procLineIdx - 1;
	while (idx >= 0 && lines[idx].trim().startsWith("//")) {
		idx--;
	}
	if (idx >= 0 && lines[idx].trim().startsWith("&")) {
		directiveLineIdx = idx;
	}

	let oldDocStartIdx: number;
	const linesToRemove = new Set<number>();

	if (directiveLineIdx !== -1) {
		let dIdx = directiveLineIdx - 1;
		while (dIdx >= 0 && lines[dIdx].trim().startsWith("//")) {
			linesToRemove.add(dIdx);
			dIdx--;
		}
		oldDocStartIdx = dIdx + 1;

		for (let mid = directiveLineIdx + 1; mid < procLineIdx; mid++) {
			if (lines[mid].trim().startsWith("//")) {
				linesToRemove.add(mid);
			}
		}
	} else {
		let pIdx = procLineIdx - 1;
		while (pIdx >= 0 && lines[pIdx].trim().startsWith("//")) {
			linesToRemove.add(pIdx);
			pIdx--;
		}
		oldDocStartIdx = pIdx + 1;
	}

	const refLine = directiveLineIdx !== -1 ? lines[directiveLineIdx] : lines[procLineIdx];
	const indentMatch = refLine.match(/^(\s*)/);
	const indent = indentMatch ? indentMatch[1] : "";

	const formattedDocLines = bslDoc.split(/\r?\n/).map((line) => {
		if (line.startsWith(indent)) {
			return line;
		}
		return `${indent}${line}`;
	});

	const newLines: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		if (i === oldDocStartIdx) {
			for (const docLine of formattedDocLines) {
				newLines.push(docLine);
			}
		}

		if (linesToRemove.has(i)) {
			continue;
		}

		newLines.push(lines[i]);
	}

	return newLines.join(newline);
}
