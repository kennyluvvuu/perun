// Точечная вставка XML-блоков в файлы .mdo с сохранением форматирования EDT и канонического порядка элементов.

interface TopLevelEntry {
	readonly tag: string;
	readonly start: number;
	readonly end: number;
}

interface TopLevelLayout {
	readonly lines: string[];
	readonly entries: readonly TopLevelEntry[];
	readonly rootOpen: number;
	readonly rootClose: number;
}

const NAMESPACES: ReadonlyArray<readonly [string, string]> = [
	["xmlns:xsi", "http://www.w3.org/2001/XMLSchema-instance"],
	["xmlns:core", "http://g5.1c.ru/v8/dt/mcore"],
];

function preserveEol(text: string, transform: (normalized: string) => string): string {
	const crlf = text.includes("\r\n");
	const result = transform(crlf ? text.replace(/\r\n/g, "\n") : text);
	return crlf ? result.replace(/\n/g, "\r\n") : result;
}

function layoutOf(text: string): TopLevelLayout {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	const rootOpen = lines.findIndex((line) => /^<mdclass:[A-Za-z]+[\s>]/.test(line));
	let rootClose = -1;
	for (let i = lines.length - 1; i > rootOpen; i--) {
		if (/^<\/mdclass:[A-Za-z]+>\s*$/.test(lines[i])) {
			rootClose = i;
			break;
		}
	}
	if (rootOpen < 0 || rootClose < 0) {
		throw new Error("файл не в формате EDT: не найден корневой элемент mdclass");
	}
	const entries: TopLevelEntry[] = [];
	for (let i = rootOpen + 1; i < rootClose; i++) {
		const match = lines[i].match(/^ {2}<([A-Za-z]+)[\s>/]/);
		if (!match) {
			continue;
		}
		const tag = match[1];
		let end = i;
		if (!lines[i].trimEnd().endsWith("/>") && !lines[i].includes(`</${tag}>`)) {
			end = lines.indexOf(`  </${tag}>`, i + 1);
			if (end < 0) {
				throw new Error(`файл не в формате EDT: не найден закрывающий тег </${tag}> для строки ${i + 1}`);
			}
		}
		entries.push({ tag, start: i, end });
		i = end;
	}
	return { lines, entries, rootOpen, rootClose };
}

function insertionIndex(layout: TopLevelLayout, order: readonly string[], tag: string): number {
	const same = layout.entries.filter((entry) => entry.tag === tag);
	if (same.length > 0) {
		return same[same.length - 1].end + 1;
	}
	const position = order.indexOf(tag);
	if (position >= 0) {
		const later = layout.entries.find((entry) => order.indexOf(entry.tag) > position);
		if (later) {
			return later.start;
		}
		const earlier = layout.entries.filter((entry) => {
			const index = order.indexOf(entry.tag);
			return index >= 0 && index < position;
		});
		if (earlier.length > 0) {
			return earlier[earlier.length - 1].end + 1;
		}
	}
	return layout.rootClose;
}

export function insertTopLevel(text: string, order: readonly string[], tag: string, block: readonly string[]): string {
	// Вставляет блок верхнего уровня после однотипных элементов или на место по каноническому порядку.
	return preserveEol(text, (normalized) => {
		const layout = layoutOf(normalized);
		const index = insertionIndex(layout, order, tag);
		return [...layout.lines.slice(0, index), ...block, ...layout.lines.slice(index)].join("\n");
	});
}

export function insertIntoTabularSection(text: string, sectionName: string, block: readonly string[]): string {
	return preserveEol(text, (normalized) => {
		const layout = layoutOf(normalized);
		const section = layout.entries.find(
			(entry) =>
				entry.tag === "tabularSections" &&
				layout.lines
					.slice(entry.start, entry.end + 1)
					.some((line) => line.trim() === `<name>${sectionName}</name>`),
		);
		if (!section) {
			throw new Error(`табличная часть «${sectionName}» не найдена`);
		}
		return [...layout.lines.slice(0, section.end), ...block, ...layout.lines.slice(section.end)].join("\n");
	});
}

export function hasTopLevelValue(text: string, tag: string, value: string): boolean {
	return layoutOf(text).lines.some((line) => line.trim() === `<${tag}>${value}</${tag}>`);
}

export function topLevelNames(text: string, tag: string): string[] {
	const layout = layoutOf(text);
	const names: string[] = [];
	for (const entry of layout.entries.filter((item) => item.tag === tag)) {
		const nameLine = layout.lines.slice(entry.start, entry.end + 1).find((line) => /^ {4}<name>/.test(line));
		const match = nameLine?.match(/<name>([^<]*)<\/name>/);
		if (match) {
			names.push(match[1]);
		}
	}
	return names;
}

export function ensureRootNamespaces(text: string): string {
	return preserveEol(text, (normalized) => {
		const lines = normalized.split("\n");
		const index = lines.findIndex((line) => /^<mdclass:[A-Za-z]+[\s>]/.test(line));
		if (index < 0) {
			return normalized;
		}
		let root = lines[index];
		for (const [name, uri] of NAMESPACES) {
			if (!root.includes(`${name}=`)) {
				root = root.replace(/^(<mdclass:[A-Za-z]+)/, `$1 ${name}="${uri}"`);
			}
		}
		lines[index] = root;
		return lines.join("\n");
	});
}
