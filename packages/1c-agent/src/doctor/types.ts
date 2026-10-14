export type DoctorStatus = "ok" | "missing" | "warning" | "info";

export interface DoctorItem {
	readonly name: string;
	readonly title: string;
	readonly required: boolean;
	readonly status: DoctorStatus;
	readonly path?: string;
	readonly version?: string;
	readonly details?: string;
	readonly recommendation?: string;
}

export interface DoctorReport {
	readonly allOk: boolean;
	readonly requiredOk: boolean;
	readonly items: readonly DoctorItem[];
	readonly summary: string;
}

export interface DoctorRunResult {
	readonly exitCode: number;
	readonly output: string;
	readonly report: DoctorReport;
}
