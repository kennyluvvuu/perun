// Поиск проектов 1C:EDT (каталог с src/Configuration/Configuration.mdo) и чтение индекса конфигурации.

import * as fs from "node:fs";
import * as path from "node:path";
import type { ConfigurationIndex, EdtProject } from "./types.ts";
import { childElements, childText, childTexts, parseXml, rootElement } from "./xml-reader.ts";

const CONFIGURATION_FILE = path.join("src", "Configuration", "Configuration.mdo");
const SKIP_DIRS = new Set([".git", "node_modules", "build", "bin", "dist", ".idea", ".vscode", "DT-INF", ".settings"]);

function readRuntimeVersion(root: string): string | undefined {
	try {
		const manifest = fs.readFileSync(path.join(root, "DT-INF", "PROJECT.PMF"), "utf8");
		return manifest.match(/^Runtime-Version:\s*(\S+)/m)?.[1];
	} catch {
		return undefined;
	}
}

function projectAt(root: string): EdtProject | undefined {
	const configurationFile = path.join(root, CONFIGURATION_FILE);
	if (!fs.existsSync(configurationFile)) {
		return undefined;
	}
	return {
		root,
		srcDir: path.join(root, "src"),
		configurationFile,
		runtimeVersion: readRuntimeVersion(root),
	};
}

export function findEdtProjects(startDir: string, maxDepth = 3): EdtProject[] {
	// Находит EDT-проекты в каталоге и его подкаталогах до заданной глубины.
	const found: EdtProject[] = [];
	const walk = (dir: string, depth: number): void => {
		const project = projectAt(dir);
		if (project) {
			found.push(project);
			return;
		}
		if (depth >= maxDepth) {
			return;
		}
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
				walk(path.join(dir, entry.name), depth + 1);
			}
		}
	};
	walk(path.resolve(startDir), 0);
	return found;
}

export function findProjectForFile(filePath: string): EdtProject | undefined {
	let dir = path.dirname(path.resolve(filePath));
	while (dir !== path.dirname(dir)) {
		const project = projectAt(dir);
		if (project) {
			return project;
		}
		dir = path.dirname(dir);
	}
	return undefined;
}

export function isExtensionProject(project: EdtProject): boolean {
	try {
		return fs.readFileSync(project.configurationFile, "utf8").includes("<configurationExtensionPurpose>");
	} catch {
		return false;
	}
}

export function readConfigurationIndex(project: EdtProject): ConfigurationIndex | undefined {
	let text: string;
	try {
		text = fs.readFileSync(project.configurationFile, "utf8");
	} catch {
		return undefined;
	}
	const root = rootElement(parseXml(text));
	if (!root) {
		return undefined;
	}
	const element = root.element;
	const defaultLanguage = (childText(element, "defaultLanguage") ?? "").replace(/^Language\./, "");
	const language = childElements(element, "languages").find((item) => childText(item, "name") === defaultLanguage);
	const registered = new Set<string>();
	for (const key of Object.keys(element)) {
		for (const value of childTexts(element, key)) {
			if (/^[A-Za-z]+\.[^\s.]+$/.test(value)) {
				registered.add(value);
			}
		}
	}
	return {
		name: childText(element, "name") ?? "",
		languageCode: (language ? childText(language, "languageCode") : undefined) ?? "ru",
		compatibilityMode: childText(element, "compatibilityMode"),
		registered,
	};
}

export function relativeToProject(project: EdtProject, filePath: string): string {
	return path.relative(project.root, path.resolve(filePath)).split(path.sep).join("/");
}
