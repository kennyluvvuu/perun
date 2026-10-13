import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ImpactAnalyzer } from "../src/navigator/impact-analysis.ts";

describe("ImpactAnalyzer", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "1c-impact-test-"));

		// Document posting module
		const docModule = path.join(tempDir, "Document_SalesOrder.bsl");
		await fs.promises.writeFile(
			docModule,
			`Процедура ОбработкаПроведения(Отказ, Режим)
	Движение = Движения.ОстаткиТоваров.ДобавитьРасход();
	Движение.Номенклатура = Ссылка.Номенклатура;
	РассчитатьСкидки(Ссылка);
КонецПроцедуры
`,
			"utf8",
		);

		// Pricing module
		const priceModule = path.join(tempDir, "CommonModule_Pricing.bsl");
		await fs.promises.writeFile(
			priceModule,
			`Процедура РассчитатьСкидки(ДокументСсылка) Экспорт
	Движения = Движения.БонусныеБаллы;
КонецПроцедуры
`,
			"utf8",
		);

		// Metadata EDT XML
		const mdoFile = path.join(tempDir, "Configuration.mdo");
		await fs.promises.writeFile(
			mdoFile,
			`<md:Configuration xmlns:md="http://v8.1c.ru/8.3/MDClasses">
	<documents>Document.SalesOrder</documents>
	<accumulationRegisters>AccumulationRegister.ОстаткиТоваров</accumulationRegisters>
</md:Configuration>`,
			"utf8",
		);
	});

	afterEach(async () => {
		await fs.promises.rm(tempDir, { recursive: true, force: true });
	});

	it("detects posting logic impact and affected registers", async () => {
		const analyzer = new ImpactAnalyzer(tempDir);
		const report = await analyzer.analyzeImpact("РассчитатьСкидки");

		expect(report.target).toBe("РассчитатьСкидки");
		expect(report.affectsPosting).toBe(true);
		expect(report.directReferencesCount).toBeGreaterThanOrEqual(2);
		expect(report.summary).toContain("ОбработкаПроведения");
	});

	it("identifies register references across modules", async () => {
		const analyzer = new ImpactAnalyzer(tempDir);
		const report = await analyzer.analyzeImpact("ОстаткиТоваров");

		expect(report.affectedRegisters).toContain("ОстаткиТоваров");
		expect(report.references.some((r) => r.contextType === "register")).toBe(true);
	});

	it("returns informative summary when target has no references", async () => {
		const analyzer = new ImpactAnalyzer(tempDir);
		const report = await analyzer.analyzeImpact("НеизвестныйМетод");

		expect(report.directReferencesCount).toBe(0);
		expect(report.affectsPosting).toBe(false);
		expect(report.summary).toContain("не найдено");
	});
});
