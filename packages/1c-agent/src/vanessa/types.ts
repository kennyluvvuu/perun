export type VanessaAction =
	| "init-dev"
	| "infobase-init"
	| "load"
	| "cf-load"
	| "dump"
	| "cf-dump"
	| "cf-decompile"
	| "updatedb"
	| "infobase-update"
	| "test"
	| "test-vanessa";

export interface VanessaToolOptions {
	action: VanessaAction;
	src?: string;
	ibconnection?: string;
	features?: string;
	vanessaPath?: string;
	vrunnerPath?: string;
	v8version?: string;
	onecPath?: string;
	ibcmd?: boolean;
	dbUser?: string;
	dbPassword?: string;
	settings?: string;
	additionalArgs?: string[];
}

export interface VanessaToolResult {
	success: boolean;
	action: VanessaAction;
	command: string;
	args: string[];
	stdout: string;
	stderr: string;
	exitCode: number | null;
	error?: string;
}

export type VanessaCommandExecutor = (
	command: string,
	args: string[],
	cwd: string,
	signal?: AbortSignal,
	env?: NodeJS.ProcessEnv,
) => Promise<{ stdout: string; stderr: string; exitCode: number | null }>;
