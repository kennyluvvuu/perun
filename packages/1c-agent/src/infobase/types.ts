// Типы модуля информационной базы: цель подключения, найденные утилиты платформы, команды и результаты шагов.

export type InfobaseTarget =
	| { readonly type: "file"; readonly path: string; readonly user?: string; readonly password?: string }
	| {
			readonly type: "server";
			readonly server: string;
			readonly ref: string;
			readonly user?: string;
			readonly password?: string;
	  };

export interface ResolvedInfobase {
	readonly id: string;
	readonly source: string;
	readonly target: InfobaseTarget;
	readonly v8path?: string;
	readonly extraArgs: readonly string[];
}

export interface PlatformTools {
	readonly designer?: string;
	readonly ibcmd?: string;
	readonly thinClient?: string;
	readonly edtCli?: string;
}

export interface CommandSpec {
	readonly title: string;
	readonly command: string;
	readonly args: readonly string[];
	readonly logFile?: string;
	readonly timeoutMs?: number;
}

export interface ProcessOutcome {
	readonly exitCode: number | null;
	readonly stdout: string;
	readonly stderr: string;
	readonly error?: string;
}

export type ProcessRunner = (spec: CommandSpec, cwd: string, signal?: AbortSignal) => Promise<ProcessOutcome>;

export interface IbIssue {
	readonly severity: "error" | "warning";
	readonly location: string;
	readonly message: string;
}

export interface StepResult {
	readonly title: string;
	readonly commandLine: string;
	readonly ok: boolean;
	readonly exitCode: number | null;
	readonly issues: readonly IbIssue[];
	readonly tail: string;
}
