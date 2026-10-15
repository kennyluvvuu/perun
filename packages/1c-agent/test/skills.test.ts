import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { ModeManager } from "../src/modes/index.ts";
import {
	buildSkillArgs,
	extractOutputPath,
	registerSkillTools,
	resolveSkillScript,
	runSkill,
	type SkillCommandExecutor,
	translateFormCompileArgs,
	validateFormArtifact,
} from "../src/skills/index.ts";
import { resolveSkillsDir } from "../src/toolchain/index.ts";

describe("Epic 2: 1C Skills & Form Compilation", () => {
	const skillsDir = resolveSkillsDir();
	const formCompileScript = path.join(skillsDir, "form-compile", "scripts", "form-compile.py");

	describe("[TASK-2.1] form-compile.py Purpose alias & ChildItems invariant", () => {
		it("normalizes Purpose 'Object' to 'Item' for Catalog metadata (-FromObject mode)", () => {
			const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fc-cat-"));
			try {
				const catXmlPath = path.join(tmpDir, "Catalogs", "Items", "Items.xml");
				fs.mkdirSync(path.dirname(catXmlPath), { recursive: true });
				const catXml = `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.17">
  <Catalog uuid="11111111-2222-3333-4444-555555555555">
    <Properties>
      <Name>Items</Name>
      <Synonym>
        <v8:item xmlns:v8="http://v8.1c.ru/8.1/data/core">
          <v8:lang>ru</v8:lang>
          <v8:content>Номенклатура</v8:content>
        </v8:item>
      </Synonym>
    </Properties>
    <ChildObjects/>
  </Catalog>
</MetaDataObject>`;
				fs.writeFileSync(catXmlPath, catXml, "utf8");

				const outFormPath = path.join(tmpDir, "Catalogs", "Items", "Forms", "ItemForm", "Ext", "Form.xml");

				const res = child_process.spawnSync(
					process.env.PYTHON_PATH || "python3",
					[
						formCompileScript,
						"-FromObject",
						"-ObjectPath",
						catXmlPath,
						"-Purpose",
						"Object",
						"-OutputPath",
						outFormPath,
					],
					{ encoding: "utf8" },
				);

				expect(res.status).toBe(0);
				expect(fs.existsSync(outFormPath)).toBe(true);

				const content = fs.readFileSync(outFormPath, "utf8");
				expect(content).toContain("<ChildItems>");
				expect(content).not.toContain("<ChildItems/>");
				expect(content).toContain("</ChildItems>");
			} finally {
				fs.rmSync(tmpDir, { recursive: true, force: true });
			}
		});

		it("normalizes Purpose case-insensitively ('object') to 'Item' for Document metadata", () => {
			const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fc-doc-"));
			try {
				const docXmlPath = path.join(tmpDir, "Documents", "Invoice", "Invoice.xml");
				fs.mkdirSync(path.dirname(docXmlPath), { recursive: true });
				const docXml = `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.17">
  <Document uuid="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee">
    <Properties>
      <Name>Invoice</Name>
      <Synonym>
        <v8:item xmlns:v8="http://v8.1c.ru/8.1/data/core">
          <v8:lang>ru</v8:lang>
          <v8:content>Расходная накладная</v8:content>
        </v8:item>
      </Synonym>
    </Properties>
    <ChildObjects/>
  </Document>
</MetaDataObject>`;
				fs.writeFileSync(docXmlPath, docXml, "utf8");

				const outFormPath = path.join(tmpDir, "Documents", "Invoice", "Forms", "DocForm", "Ext", "Form.xml");

				const res = child_process.spawnSync(
					process.env.PYTHON_PATH || "python3",
					[
						formCompileScript,
						"-FromObject",
						"-ObjectPath",
						docXmlPath,
						"-Purpose",
						"object",
						"-OutputPath",
						outFormPath,
					],
					{ encoding: "utf8" },
				);

				expect(res.status).toBe(0);
				expect(fs.existsSync(outFormPath)).toBe(true);

				const content = fs.readFileSync(outFormPath, "utf8");
				expect(content).toContain("<ChildItems>");
				expect(content).not.toContain("<ChildItems/>");
			} finally {
				fs.rmSync(tmpDir, { recursive: true, force: true });
			}
		});

		it("fails with exit code 1 if Purpose 'Object' is passed for non-Catalog/Document", () => {
			const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fc-reg-"));
			try {
				const regXmlPath = path.join(tmpDir, "InformationRegisters", "Prices", "Prices.xml");
				fs.mkdirSync(path.dirname(regXmlPath), { recursive: true });
				const regXml = `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.17">
  <InformationRegister uuid="12345678-0000-0000-0000-000000000000">
    <Properties>
      <Name>Prices</Name>
    </Properties>
    <ChildObjects/>
  </InformationRegister>
</MetaDataObject>`;
				fs.writeFileSync(regXmlPath, regXml, "utf8");

				const outFormPath = path.join(tmpDir, "Form.xml");

				const res = child_process.spawnSync(
					process.env.PYTHON_PATH || "python3",
					[
						formCompileScript,
						"-FromObject",
						"-ObjectPath",
						regXmlPath,
						"-Purpose",
						"Object",
						"-OutputPath",
						outFormPath,
					],
					{ encoding: "utf8" },
				);

				expect(res.status).toBe(1);
				expect(res.stderr).toContain("Purpose 'Object' not valid for InformationRegister");
			} finally {
				fs.rmSync(tmpDir, { recursive: true, force: true });
			}
		});

		it("enforces non-empty ChildItems invariant: exits with code 1 and deletes invalid file on disk", () => {
			const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fc-empty-"));
			try {
				const jsonPath = path.join(tmpDir, "empty-form.json");
				fs.writeFileSync(jsonPath, JSON.stringify({ name: "EmptyForm" }), "utf8");

				const outFormPath = path.join(tmpDir, "Form.xml");
				// Create a pre-existing dummy file (like form-add might leave behind)
				fs.writeFileSync(outFormPath, "<Form><ChildItems/></Form>", "utf8");
				expect(fs.existsSync(outFormPath)).toBe(true);

				const res = child_process.spawnSync(
					process.env.PYTHON_PATH || "python3",
					[formCompileScript, "-JsonPath", jsonPath, "-OutputPath", outFormPath],
					{ encoding: "utf8" },
				);

				expect(res.status).toBe(1);
				expect(res.stderr).toContain("Validation failed: Form.xml must contain non-empty <ChildItems>");
				// Invariant: empty file MUST NOT remain on disk!
				expect(fs.existsSync(outFormPath)).toBe(false);
			} finally {
				fs.rmSync(tmpDir, { recursive: true, force: true });
			}
		});
	});

	describe("[TASK-2.2] 1c_skill_execute tool & artifact invariant checking", () => {
		describe("Script resolution & argument formatting", () => {
			it("resolves skill scripts by skill directory name", () => {
				const resolved = resolveSkillScript(skillsDir, "form-compile");
				expect(resolved).toBeDefined();
				expect(resolved).toContain("form-compile.py");
				expect(fs.existsSync(resolved!)).toBe(true);
			});

			it("resolves skill scripts with custom internal script names (e.g. init.py)", () => {
				const resolved = resolveSkillScript(skillsDir, "epf-init");
				expect(resolved).toBeDefined();
				expect(fs.existsSync(resolved!)).toBe(true);
			});

			it("returns undefined for nonexistent skills", () => {
				const resolved = resolveSkillScript(skillsDir, "nonexistent-skill-xyz");
				expect(resolved).toBeUndefined();
			});

			it("builds CLI arguments correctly from Record<string, unknown>", () => {
				const args = buildSkillArgs({
					OutputPath: "out/Ext/Form.xml",
					FromObject: true,
					EmptyFlag: false,
					NullVal: null,
					UndefinedVal: undefined,
					Purpose: "Item",
					NumericArg: 42,
					Multi: ["a", "b"],
				});

				expect(args).toEqual([
					"-OutputPath",
					"out/Ext/Form.xml",
					"-FromObject",
					"-Purpose",
					"Item",
					"-NumericArg",
					"42",
					"-Multi",
					"a",
					"-Multi",
					"b",
				]);
			});

			it("passes array arguments as string list unchanged", () => {
				const args = buildSkillArgs(["-FromObject", "-Purpose", "Item"]);
				expect(args).toEqual(["-FromObject", "-Purpose", "Item"]);
			});

			it("extracts output path from both Record and Array arguments", () => {
				expect(extractOutputPath({ OutputPath: "/path/to/Form.xml" })).toBe("/path/to/Form.xml");
				expect(extractOutputPath({ outputPath: "/path/to/Form.xml" })).toBe("/path/to/Form.xml");
				expect(extractOutputPath(["-FromObject", "-OutputPath", "/path/to/Form.xml"])).toBe("/path/to/Form.xml");
				expect(extractOutputPath(["-FromObject", "-outputpath=/path/to/Form.xml"])).toBe("/path/to/Form.xml");
			});
		});

		describe("Domain parameter translation for form-compile (Defect D2)", () => {
			it("translates domain parameters for Catalog with Purpose 'Object' into canonical flags", async () => {
				const domainArgs = {
					Src: "src",
					Type: "Catalog",
					Name: "Номенклатура",
					Purpose: "Object",
				};

				const translated = translateFormCompileArgs(domainArgs);
				expect(translated).toEqual({
					FromObject: true,
					ObjectPath: "src/Catalogs/Номенклатура.xml",
					OutputPath: "src/Catalogs/Номенклатура/Forms/ФормаЭлемента/Ext/Form.xml",
					Purpose: "Object",
				});
				expect(translated).not.toHaveProperty("Src");
				expect(translated).not.toHaveProperty("Type");
				expect(translated).not.toHaveProperty("Name");

				const mockExecutor: SkillCommandExecutor = vi.fn(async (_cmd, _args, _cwd) => ({
					stdout: "Form compiled successfully",
					stderr: "",
					exitCode: 0,
				}));

				const result = await runSkill(
					{
						skill: "form-compile",
						args: domainArgs,
					},
					{
						skillsDir,
						executor: mockExecutor,
					},
				);

				expect(result.success).toBe(true);
				expect(result.args).toEqual([
					"-FromObject",
					"-ObjectPath",
					"src/Catalogs/Номенклатура.xml",
					"-OutputPath",
					"src/Catalogs/Номенклатура/Forms/ФормаЭлемента/Ext/Form.xml",
					"-Purpose",
					"Object",
				]);
				expect(mockExecutor).toHaveBeenCalledWith(
					expect.stringMatching(/python3/),
					[
						expect.stringContaining("form-compile.py"),
						"-FromObject",
						"-ObjectPath",
						"src/Catalogs/Номенклатура.xml",
						"-OutputPath",
						"src/Catalogs/Номенклатура/Forms/ФормаЭлемента/Ext/Form.xml",
						"-Purpose",
						"Object",
					],
					expect.any(String),
					undefined,
				);
			});

			it("applies default values when Src and Purpose are omitted", () => {
				const translated = translateFormCompileArgs({
					Type: "Catalog",
					Name: "Товары",
				});

				expect(translated).toEqual({
					FromObject: true,
					ObjectPath: "src/Catalogs/Товары.xml",
					OutputPath: "src/Catalogs/Товары/Forms/ФормаЭлемента/Ext/Form.xml",
					Purpose: "Item",
				});
			});

			it("computes default form name for Catalog Folder and List purposes", () => {
				const folder = translateFormCompileArgs({
					Type: "Catalog",
					Name: "Номенклатура",
					Purpose: "Folder",
				});
				expect(folder.OutputPath).toBe("src/Catalogs/Номенклатура/Forms/ФормаГруппы/Ext/Form.xml");
				expect(folder.Purpose).toBe("Folder");

				const list = translateFormCompileArgs({
					Type: "Catalog",
					Name: "Номенклатура",
					Purpose: "List",
				});
				expect(list.OutputPath).toBe("src/Catalogs/Номенклатура/Forms/ФормаСписка/Ext/Form.xml");
				expect(list.Purpose).toBe("List");
			});

			it("translates domain parameters for Document (defaults to ФормаДокумента and Item)", () => {
				const translated = translateFormCompileArgs({
					Src: "app/src",
					Type: "Document",
					Name: "РасходнаяНакладная",
				});

				expect(translated).toEqual({
					FromObject: true,
					ObjectPath: "app/src/Documents/РасходнаяНакладная.xml",
					OutputPath: "app/src/Documents/РасходнаяНакладная/Forms/ФормаДокумента/Ext/Form.xml",
					Purpose: "Item",
				});
			});

			it("translates domain parameters for InformationRegister and Record (defaults to ФормаЗаписи)", () => {
				const reg = translateFormCompileArgs({
					Type: "InformationRegister",
					Name: "ЦеныНоменклатуры",
				});
				expect(reg).toEqual({
					FromObject: true,
					ObjectPath: "src/InformationRegisters/ЦеныНоменклатуры.xml",
					OutputPath: "src/InformationRegisters/ЦеныНоменклатуры/Forms/ФормаЗаписи/Ext/Form.xml",
				});

				const rec = translateFormCompileArgs({
					Type: "Record",
					Name: "КурсыВалют",
				});
				expect(rec).toEqual({
					FromObject: true,
					ObjectPath: "src/Records/КурсыВалют.xml",
					OutputPath: "src/Records/КурсыВалют/Forms/ФормаЗаписи/Ext/Form.xml",
				});
			});

			it("preserves transparent passthrough of canonical parameters (-FromObject, -ObjectPath, -OutputPath)", async () => {
				const canonicalArgs = {
					FromObject: true,
					ObjectPath: "custom/path.xml",
					OutputPath: "custom/Form.xml",
					Purpose: "Item",
				};

				const translated = translateFormCompileArgs(canonicalArgs);
				expect(translated).toEqual(canonicalArgs);

				const arrayArgs = ["-FromObject", "-ObjectPath", "custom/path.xml", "-OutputPath", "custom/Form.xml"];
				const mockExecutor: SkillCommandExecutor = vi.fn(async () => ({
					stdout: "",
					stderr: "",
					exitCode: 0,
				}));

				const result = await runSkill(
					{
						skill: "form-compile",
						args: arrayArgs,
					},
					{
						skillsDir,
						executor: mockExecutor,
					},
				);

				expect(result.args).toEqual(arrayArgs);
			});

			it("removes domain parameter keys (Src, Type, Name) and retains custom CLI options (e.g. Preset)", () => {
				const translated = translateFormCompileArgs({
					Src: "src",
					Type: "Catalog",
					Name: "Товары",
					Preset: "erp-standard",
				});

				expect(translated).toEqual({
					Preset: "erp-standard",
					FromObject: true,
					ObjectPath: "src/Catalogs/Товары.xml",
					OutputPath: "src/Catalogs/Товары/Forms/ФормаЭлемента/Ext/Form.xml",
					Purpose: "Item",
				});
				expect(translated).not.toHaveProperty("Src");
				expect(translated).not.toHaveProperty("Type");
				expect(translated).not.toHaveProperty("Name");
			});

			it("resolves nested object path if present on disk", () => {
				const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fc-nested-"));
				try {
					const nestedDir = path.join(tmpDir, "src", "Catalogs", "Items", "Items.xml");
					fs.mkdirSync(path.dirname(nestedDir), { recursive: true });
					fs.writeFileSync(nestedDir, "<xml/>", "utf8");

					const translated = translateFormCompileArgs(
						{
							Type: "Catalog",
							Name: "Items",
						},
						tmpDir,
					);

					expect(translated.ObjectPath).toBe("src/Catalogs/Items/Items.xml");
				} finally {
					fs.rmSync(tmpDir, { recursive: true, force: true });
				}
			});
		});

		describe("Artifact invariant validator (validateFormArtifact)", () => {
			it("validates form with populated ChildItems", () => {
				const validXml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform">
					<ChildItems>
						<InputField name="Name" id="1" />
					</ChildItems>
				</Form>`;
				expect(validateFormArtifact(validXml).valid).toBe(true);
			});

			it("rejects form with self-closing ChildItems", () => {
				const invalidXml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><ChildItems/></Form>`;
				const res = validateFormArtifact(invalidXml);
				expect(res.valid).toBe(false);
				expect(res.reason).toContain("пуст (self-closing)");
			});

			it("rejects form with empty ChildItems tag", () => {
				const invalidXml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><ChildItems>   \n  </ChildItems></Form>`;
				const res = validateFormArtifact(invalidXml);
				expect(res.valid).toBe(false);
				expect(res.reason).toContain("пуст (нет дочерних элементов)");
			});

			it("rejects form with missing ChildItems tag", () => {
				const invalidXml = `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"></Form>`;
				const res = validateFormArtifact(invalidXml);
				expect(res.valid).toBe(false);
				expect(res.reason).toContain("отсутствует в Form.xml");
			});
		});

		describe("runSkill and tool execution", () => {
			it("executes skill via mock executor and captures stdout, stderr, and exitCode", async () => {
				const mockExecutor: SkillCommandExecutor = vi.fn(async (_cmd, args, _cwd) => {
					return {
						stdout: `[OK] Compiled: ${args.join(" ")}`,
						stderr: "",
						exitCode: 0,
					};
				});

				const result = await runSkill(
					{
						skill: "form-compile",
						args: {
							FromObject: true,
							Purpose: "Item",
						},
					},
					{
						skillsDir,
						executor: mockExecutor,
					},
				);

				expect(result.success).toBe(true);
				expect(result.exitCode).toBe(0);
				expect(result.stdout).toContain("[OK] Compiled:");
				expect(mockExecutor).toHaveBeenCalledWith(
					expect.stringMatching(/python3/),
					expect.arrayContaining([expect.stringContaining("form-compile.py"), "-FromObject", "-Purpose", "Item"]),
					expect.any(String),
					undefined,
				);
			});

			it("returns error result with isError: true when script exitCode !== 0", async () => {
				const mockExecutor: SkillCommandExecutor = vi.fn(async () => {
					return {
						stdout: "",
						stderr: "Error: syntax error in metadata definition",
						exitCode: 1,
					};
				});

				const result = await runSkill(
					{
						skill: "form-compile",
						args: ["-InvalidArg"],
					},
					{
						skillsDir,
						executor: mockExecutor,
					},
				);

				expect(result.success).toBe(false);
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain("Error: syntax error in metadata definition");
			});

			it("detects and deletes invalid Form.xml artifact violating ChildItems invariant", async () => {
				const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-test-"));
				const outXml = path.join(tmpDir, "Form.xml");
				try {
					// Simulate script creating an invalid Form.xml with <ChildItems/> but exiting 0
					const mockExecutor: SkillCommandExecutor = vi.fn(async () => {
						fs.writeFileSync(outXml, "<Form><ChildItems/></Form>", "utf8");
						return {
							stdout: "Generated form",
							stderr: "",
							exitCode: 0,
						};
					});

					const result = await runSkill(
						{
							skill: "form-compile",
							args: {
								OutputPath: outXml,
							},
						},
						{
							skillsDir,
							executor: mockExecutor,
						},
					);

					expect(result.success).toBe(false);
					expect(result.artifactValidation?.valid).toBe(false);
					expect(result.artifactValidation?.reason).toContain("self-closing");
					// File must be deleted!
					expect(fs.existsSync(outXml)).toBe(false);
				} finally {
					fs.rmSync(tmpDir, { recursive: true, force: true });
				}
			});

			it("returns error when skill script is not found", async () => {
				const result = await runSkill(
					{
						skill: "unknown-skill",
					},
					{
						skillsDir,
					},
				);

				expect(result.success).toBe(false);
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain("не найден");
			});
		});

		describe("registerSkillTools extension integration & mode permissions", () => {
			it("registers 1c_skill_execute tool with ExtensionAPI and handles tool call", async () => {
				let registeredTool: Parameters<ExtensionAPI["registerTool"]>[0] | undefined;
				const mockPi = {
					registerTool: vi.fn((tool) => {
						registeredTool = tool;
					}),
				} as unknown as ExtensionAPI;

				const mockExecutor: SkillCommandExecutor = vi.fn(async () => ({
					stdout: "Skill completed successfully",
					stderr: "",
					exitCode: 0,
				}));

				registerSkillTools(mockPi, "/test/dir", mockExecutor, skillsDir);

				expect(registeredTool).toBeDefined();
				expect(registeredTool?.name).toBe("1c_skill_execute");

				const ctx = { cwd: "/test/dir" } as ExtensionToolContext;
				const toolResult = await registeredTool!.execute(
					"call_1",
					{
						skill: "form-compile",
						args: { FromObject: true },
					},
					undefined,
					undefined,
					ctx,
				);

				expect(toolResult.isError).toBe(false);
				const content0 = toolResult.content[0];
				if (content0.type !== "text") throw new Error("expected text content");
				expect(content0.text).toContain("[1C Skill: form-compile]");
				expect(content0.text).toContain("Статус: УСПЕШНО");
				expect(content0.text).toContain("Skill completed successfully");
			});

			it("returns isError: true with full stderr details on command failure", async () => {
				let registeredTool: Parameters<ExtensionAPI["registerTool"]>[0] | undefined;
				const mockPi = {
					registerTool: vi.fn((tool) => {
						registeredTool = tool;
					}),
				} as unknown as ExtensionAPI;

				const mockExecutor: SkillCommandExecutor = vi.fn(async () => ({
					stdout: "",
					stderr: "Critical script error: invalid configuration",
					exitCode: 2,
				}));

				registerSkillTools(mockPi, "/test/dir", mockExecutor, skillsDir);

				const ctx = { cwd: "/test/dir" } as ExtensionToolContext;
				const toolResult = await registeredTool!.execute(
					"call_2",
					{
						skill: "form-compile",
						args: ["-fail"],
					},
					undefined,
					undefined,
					ctx,
				);

				expect(toolResult.isError).toBe(true);
				const content0 = toolResult.content[0];
				if (content0.type !== "text") throw new Error("expected text content");
				expect(content0.text).toContain("Статус: ОШИБКА");
				expect(content0.text).toContain("Код возврата: 2");
				expect(content0.text).toContain("Critical script error: invalid configuration");
			});

			it("ModeManager treats 1c_skill_execute as a mutating tool", () => {
				const mockPi = {
					getActiveTools: vi.fn(() => ["read", "write", "1c_skill_execute"]),
					setActiveTools: vi.fn(),
				} as unknown as ExtensionAPI;

				const manager = new ModeManager(mockPi, "find");
				// in read-only 'find' mode, mutating tools are blocked
				expect(manager.isToolAllowed("1c_skill_execute")).toBe(false);
				const check = manager.checkToolCall("1c_skill_execute");
				expect(check.block).toBe(true);
				expect(check.reason).toContain("заблокирован в режиме [НАЙТИ]");

				// in 'write' mode, 1c_skill_execute is allowed
				manager.setMode("write");
				expect(manager.isToolAllowed("1c_skill_execute")).toBe(true);
				expect(manager.checkToolCall("1c_skill_execute").block).toBe(false);
			});
		});
	});
});
