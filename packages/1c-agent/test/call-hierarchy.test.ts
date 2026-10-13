import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CallHierarchyNavigator } from "../src/navigator/call-hierarchy.ts";

describe("CallHierarchyNavigator", () => {
	let tempDir: string;
	let moduleA: string;
	let moduleB: string;

	beforeEach(async () => {
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "1c-call-test-"));
		moduleA = path.join(tempDir, "ModuleA.bsl");
		moduleB = path.join(tempDir, "ModuleB.bsl");

		await fs.promises.writeFile(
			moduleA,
			`Процедура РассчитатьСкидки() Экспорт
	ПрименитьПромокод();
	ПересчитатьИтог();
КонецПроцедуры

Процедура ПрименитьПромокод()
	Логировать("Промокод применен");
КонецПроцедуры

Процедура ПересчитатьИтог()
КонецПроцедуры
`,
			"utf8",
		);

		await fs.promises.writeFile(
			moduleB,
			`Процедура ОбработкаПроведения()
	РассчитатьСкидки();
КонецПроцедуры

Процедура ЗаполнитьПоУмолчанию()
	РассчитатьСкидки();
КонецПроцедуры
`,
			"utf8",
		);
	});

	afterEach(async () => {
		await fs.promises.rm(tempDir, { recursive: true, force: true });
	});

	it("resolves outgoing calls from target procedure", async () => {
		const navigator = new CallHierarchyNavigator();
		const result = await navigator.getCallHierarchy(moduleA, "РассчитатьСкидки", tempDir);

		expect(result.symbol).toBe("РассчитатьСкидки");
		expect(result.outgoingCalls).toHaveLength(2);

		const callees = result.outgoingCalls.map((c) => c.callee);
		expect(callees).toContain("ПрименитьПромокод");
		expect(callees).toContain("ПересчитатьИтог");
	});

	it("resolves incoming calls across project modules", async () => {
		const navigator = new CallHierarchyNavigator();
		const result = await navigator.getCallHierarchy(moduleA, "РассчитатьСкидки", tempDir);

		expect(result.incomingCalls).toHaveLength(2);

		const callers = result.incomingCalls.map((c) => c.caller);
		expect(callers).toContain("ОбработкаПроведения");
		expect(callers).toContain("ЗаполнитьПоУмолчанию");
	});

	it("handles non-existent symbols gracefully", async () => {
		const navigator = new CallHierarchyNavigator();
		const result = await navigator.getCallHierarchy(moduleA, "НесуществующийМетод", tempDir);

		expect(result.incomingCalls).toHaveLength(0);
		expect(result.outgoingCalls).toHaveLength(0);
	});
});
