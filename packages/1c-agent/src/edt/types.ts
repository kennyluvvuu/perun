// Доменные типы формата 1C:EDT: объекты метаданных, их состав, спецификации изменений и диагностики.

export type DiagnosticSeverity = "error" | "warning";

export interface MdoDiagnostic {
	readonly file: string;
	readonly line: number;
	readonly severity: DiagnosticSeverity;
	readonly message: string;
}

export interface KindInfo {
	readonly kind: string;
	readonly folder: string;
	readonly ru: string;
	readonly collection?: string;
	readonly refType?: string;
	readonly ruRefType?: string;
}

export interface MdoField {
	readonly name: string;
	readonly uuid: string;
	readonly types: readonly string[];
	readonly typeText: string;
	readonly synonym?: string;
}

export interface MdoTabularSection {
	readonly name: string;
	readonly uuid: string;
	readonly attributes: readonly MdoField[];
}

export interface MdoSummary {
	readonly kind: string;
	readonly name: string;
	readonly uuid: string;
	readonly synonym?: string;
	readonly attributes: readonly MdoField[];
	readonly tabularSections: readonly MdoTabularSection[];
	readonly dimensions: readonly MdoField[];
	readonly resources: readonly MdoField[];
	readonly enumValues: readonly MdoField[];
	readonly forms: readonly string[];
	readonly commands: readonly string[];
	readonly templates: readonly string[];
	readonly registerRecords: readonly string[];
	readonly content: readonly string[];
	readonly properties: Readonly<Record<string, string>>;
	readonly producedTypeIds: readonly string[];
}

export interface EdtProject {
	readonly root: string;
	readonly srcDir: string;
	readonly configurationFile: string;
	readonly runtimeVersion?: string;
}

export interface ConfigurationIndex {
	readonly name: string;
	readonly languageCode: string;
	readonly compatibilityMode?: string;
	readonly registered: ReadonlySet<string>;
}

export interface MdoRef {
	readonly kind: KindInfo;
	readonly name: string;
}

export interface FieldSpec {
	readonly name: string;
	readonly type?: string;
	readonly synonym?: string;
	readonly required?: boolean;
	readonly indexed?: boolean;
}

export interface TabularSectionSpec {
	readonly name: string;
	readonly synonym?: string;
	readonly attributes?: readonly FieldSpec[];
}

export interface ObjectOptions {
	readonly registerType?: "Balance" | "Turnovers";
	readonly periodicity?: "Nonperiodical" | "Second" | "Day" | "Month" | "Quarter" | "Year" | "RecorderPosition";
	readonly writeMode?: "Independent" | "RecorderSubordinate";
	readonly context?: "server" | "serverCall" | "client" | "clientServer" | "global";
	readonly hierarchical?: boolean;
	readonly codeLength?: number;
	readonly descriptionLength?: number;
	readonly numberLength?: number;
	readonly type?: string;
}

export interface ChildrenSpec {
	readonly attributes?: readonly FieldSpec[];
	readonly tabularSections?: readonly TabularSectionSpec[];
	readonly dimensions?: readonly FieldSpec[];
	readonly resources?: readonly FieldSpec[];
	readonly values?: readonly FieldSpec[];
	readonly registerRecords?: readonly string[];
	readonly tabularSection?: string;
}

export interface CreateSpec extends ChildrenSpec {
	readonly ref: MdoRef;
	readonly synonym?: string;
	readonly subsystem?: string;
	readonly options?: ObjectOptions;
}

export interface ChangeReport {
	readonly created: readonly string[];
	readonly modified: readonly string[];
	readonly diagnostics: readonly MdoDiagnostic[];
}
