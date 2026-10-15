// RPC-методы docs.* для плагина EDT поверх команды extension_request ядра.
import type { DocsService } from "./docs-service.ts";
import { DOC_KINDS, type DocCase, type DocKind } from "./types.ts";

export const DOCS_METHOD_PREFIX = "docs.";

type Params = Record<string, unknown>;

function requireString(params: Params, key: string): string {
	const value = params[key];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Параметр '${key}' обязателен`);
	}
	return value;
}

function optionalString(params: Params, key: string): string | undefined {
	const value = params[key];
	return typeof value === "string" ? value : undefined;
}

function limitOf(params: Params, fallback: number, max: number): number {
	const value = params.limit;
	return typeof value === "number" && Number.isFinite(value)
		? Math.min(Math.max(Math.trunc(value), 1), max)
		: fallback;
}

function kindOf(params: Params, key: string, required: boolean): DocKind | undefined {
	const value = params[key];
	if (value === undefined && !required) {
		return undefined;
	}
	if (typeof value === "string" && (DOC_KINDS as readonly string[]).includes(value)) {
		return value as DocKind;
	}
	throw new Error(`Параметр '${key}' должен быть одним из: ${DOC_KINDS.join(", ")}`);
}

function casesOf(params: Params): DocCase[] {
	const value = params.cases;
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.filter((item): item is DocCase => typeof item?.title === "string" && typeof item?.text === "string")
		.filter((item) => item.title.trim().length > 0 || item.text.trim().length > 0)
		.map((item) => ({ title: item.title.trim(), text: item.text.trim() }));
}

async function dispatch(service: DocsService, method: string, params: Params): Promise<Params> {
	switch (method) {
		case "docs.status":
			service.refresh();
			return { status: service.status() };
		case "docs.sync": {
			const report = await service.sync();
			return { report, status: service.status() };
		}
		case "docs.tree": {
			service.refresh();
			const section = kindOf(params, "section", true) as DocKind;
			const node = optionalString(params, "node") ?? "";
			return { section, node, items: service.tree(section, node), syncing: service.status().syncing };
		}
		case "docs.page":
			service.refresh();
			return { page: service.page(requireString(params, "id")) };
		case "docs.search": {
			const query = requireString(params, "query");
			const hits = service.search(query, kindOf(params, "kind", false), limitOf(params, 30, 100));
			return { query, hits };
		}
		case "docs.outdated":
			return { items: service.outdated(limitOf(params, 50, 500)) };
		case "docs.save": {
			const id = requireString(params, "id");
			const fields = {
				summary: requireString(params, "summary"),
				details: optionalString(params, "details") ?? "",
				cases: casesOf(params),
			};
			return { page: (await service.saveNote(id, fields, "user")) ?? null };
		}
		case "docs.remove": {
			const id = requireString(params, "id");
			service.removeNote(id);
			return { page: service.page(id) };
		}
		default:
			throw new Error(`Неизвестный метод документации: ${method}`);
	}
}

export function handleDocsRequest(service: DocsService, method: string, params: Params): Promise<Params> | undefined {
	// Обрабатывает только методы с префиксом docs., остальные оставляет другим расширениям.
	return method.startsWith(DOCS_METHOD_PREFIX) ? dispatch(service, method, params) : undefined;
}
