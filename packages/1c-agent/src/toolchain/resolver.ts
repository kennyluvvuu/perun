import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface ToolchainPaths {
	bslAnalyzer?: string;
	vrunner?: string;
	oscript?: string;
	vanessaAutomationEpf?: string;
	onecEnterprise?: string;
	ibcmd?: string;
	toolsDir: string;
}

function findPerunPackageDir(startDir: string): string {
	let dir = path.resolve(startDir);
	while (dir !== path.dirname(dir)) {
		const pkgJson = path.join(dir, "package.json");
		if (fs.existsSync(pkgJson)) {
			try {
				const content = fs.readFileSync(pkgJson, "utf8");
				if (content.includes("@earendil-works/pi-1c-agent")) {
					return dir;
				}
			} catch {}
		}
		dir = path.dirname(dir);
	}
	return path.resolve(startDir, "..", "..");
}

export class ToolchainResolver {
	private readonly toolsDir: string;

	constructor(customToolsDir?: string) {
		if (customToolsDir) {
			this.toolsDir = customToolsDir;
		} else if (process.env.PERUN_TOOLS_DIR) {
			this.toolsDir = process.env.PERUN_TOOLS_DIR;
		} else {
			const execDir = path.dirname(process.execPath);
			const localToolsDir = path.join(execDir, "tools");
			if (fs.existsSync(localToolsDir)) {
				this.toolsDir = localToolsDir;
			} else {
				const pkgDir = getPerunPackageDir();
				const pkgBinToolsDir = path.join(pkgDir, "bin", "tools");
				this.toolsDir = fs.existsSync(pkgBinToolsDir) ? pkgBinToolsDir : path.join(pkgDir, "tools");
			}
		}
	}

	public getToolsDir(): string {
		if (process.env.PERUN_TOOLS_DIR) {
			return process.env.PERUN_TOOLS_DIR;
		}
		return this.toolsDir;
	}

	private getCandidateToolsDirs(): string[] {
		const candidates: string[] = [];
		if (this.toolsDir) {
			candidates.push(this.toolsDir);
		}
		const pkgDir = getPerunPackageDir();
		candidates.push(path.join(pkgDir, "bin", "tools"));
		candidates.push(path.join(pkgDir, "tools"));

		const execDir = path.dirname(process.execPath);
		candidates.push(path.join(execDir, "tools"));
		candidates.push(path.join(execDir, "..", "tools"));
		candidates.push(path.join(execDir, "..", "bin", "tools"));

		return Array.from(new Set(candidates.filter((d) => Boolean(d) && fs.existsSync(d))));
	}

	public resolveBslAnalyzer(): string | undefined {
		if (process.env.BSL_ANALYZER_PATH) {
			return process.env.BSL_ANALYZER_PATH;
		}

		const ext = process.platform === "win32" ? ".exe" : "";
		for (const dir of this.getCandidateToolsDirs()) {
			const candidateFiles = [path.join(dir, `bsl-analyzer${ext}`), path.join(dir, "bin", `bsl-analyzer${ext}`)];
			for (const c of candidateFiles) {
				if (fs.existsSync(c)) {
					return c;
				}
			}
		}

		const systemLocations =
			process.platform === "win32"
				? ["C:\\tools\\bsl-analyzer\\bsl-analyzer.exe"]
				: [
						"/usr/local/bin/bsl-analyzer",
						"/usr/bin/bsl-analyzer",
						path.join(process.env.HOME || "", ".local/bin/bsl-analyzer"),
					];

		for (const loc of systemLocations) {
			if (fs.existsSync(loc)) {
				return loc;
			}
		}

		return this.which("bsl-analyzer");
	}

	public resolveVrunner(): string | undefined {
		if (process.env.VRUNNER_PATH) {
			return process.env.VRUNNER_PATH;
		}

		return this.which("vrunner");
	}

	public resolveVrunnerVersion(vrunnerPath?: string): string | undefined {
		if (process.env.VRUNNER_VERSION) {
			return process.env.VRUNNER_VERSION;
		}
		const bin = vrunnerPath || this.resolveVrunner();
		if (!bin) return undefined;
		try {
			const cmd = `"${bin}" --version`;
			const out = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).trim();
			const match = out.match(/(\d+\.\d+(?:\.\d+)?)/);
			return match ? match[1] : undefined;
		} catch {
			return undefined;
		}
	}

	public resolveOscript(): string | undefined {
		if (process.env.OSCRIPT_PATH) {
			return process.env.OSCRIPT_PATH;
		}

		return this.which("oscript");
	}

	public resolveVanessaAutomationEpf(): string | undefined {
		if (process.env.VANESSA_AUTOMATION_EPF) {
			return process.env.VANESSA_AUTOMATION_EPF;
		}

		for (const dir of this.getCandidateToolsDirs()) {
			const candidateFiles = [
				path.join(dir, "vanessa", "vanessa-automation.epf"),
				path.join(dir, "vanessa-automation", "vanessa-automation.epf"),
				path.join(dir, "vanessa-automation.epf"),
			];
			for (const c of candidateFiles) {
				if (fs.existsSync(c)) {
					return c;
				}
			}
		}

		return undefined;
	}

	public resolveOnecEnterprise(): string | undefined {
		if (process.env.ONEC_PATH && fs.existsSync(process.env.ONEC_PATH)) {
			return process.env.ONEC_PATH;
		}

		if (process.platform === "darwin") {
			const searchRoots = ["/Applications/1cv8t.localized", "/Applications/1cv8.localized", "/Applications"];
			for (const root of searchRoots) {
				if (!fs.existsSync(root)) continue;
				try {
					const entries = fs.readdirSync(root);
					entries.sort((a, b) => compareVersionStrings(b, a));
					for (const entry of entries) {
						const candidateDir = path.join(root, entry);
						if (entry.endsWith(".app")) {
							const directBin = path.join(candidateDir, "Contents", "MacOS", "1cv8t");
							if (fs.existsSync(directBin)) return directBin;
							const directAlt = path.join(candidateDir, "Contents", "MacOS", "1cv8");
							if (fs.existsSync(directAlt)) return directAlt;
						}
						const subApps = ["1cv8t.app", "1cv8.app", "1cv8ct.app", "1cv8c.app"];
						for (const app of subApps) {
							const binPath = path.join(candidateDir, app, "Contents", "MacOS", "1cv8t");
							if (fs.existsSync(binPath)) {
								return binPath;
							}
							const altBinPath = path.join(candidateDir, app, "Contents", "MacOS", "1cv8");
							if (fs.existsSync(altBinPath)) {
								return altBinPath;
							}
						}
					}
				} catch {}
			}
		} else if (process.platform === "win32") {
			const programFiles = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);
			for (const pf of programFiles) {
				const onecRoot = path.join(pf!, "1cv8");
				if (!fs.existsSync(onecRoot)) continue;
				try {
					const entries = fs.readdirSync(onecRoot).sort((a, b) => compareVersionStrings(b, a));
					for (const entry of entries) {
						const bin = path.join(onecRoot, entry, "bin", "1cv8.exe");
						if (fs.existsSync(bin)) return bin;
					}
				} catch {}
			}
		} else {
			// Linux
			const linuxRoots = ["/opt/1cv8/x86_64", "/opt/1cv8/i386", "/opt/1cv8/current"];
			for (const root of linuxRoots) {
				if (!fs.existsSync(root)) continue;
				try {
					const entries = fs.readdirSync(root).sort((a, b) => compareVersionStrings(b, a));
					for (const entry of entries) {
						const bin = path.join(root, entry, "1cv8");
						if (fs.existsSync(bin)) return bin;
					}
				} catch {}
			}
		}

		return this.which("1cv8");
	}

	public resolveIbcmd(): string | undefined {
		if (process.env.IBCMD_PATH && fs.existsSync(process.env.IBCMD_PATH)) {
			return process.env.IBCMD_PATH;
		}

		const onec = this.resolveOnecEnterprise();
		if (onec) {
			const dir = path.dirname(onec);
			const ext = process.platform === "win32" ? ".exe" : "";
			const candidateInSameDir = path.join(dir, `ibcmd${ext}`);
			if (fs.existsSync(candidateInSameDir)) {
				return candidateInSameDir;
			}
			const candidateParent = path.resolve(dir, "..", "..");
			const candidateInParent = path.join(candidateParent, `ibcmd${ext}`);
			if (fs.existsSync(candidateInParent)) {
				return candidateInParent;
			}
		}

		if (process.platform === "darwin") {
			const searchRoots = ["/Applications/1cv8t.localized", "/Applications/1cv8.localized", "/Applications"];
			for (const root of searchRoots) {
				if (!fs.existsSync(root)) continue;
				try {
					const entries = fs.readdirSync(root);
					entries.sort((a, b) => compareVersionStrings(b, a));
					for (const entry of entries) {
						const candidateDir = path.join(root, entry);
						const subApps = ["1cv8t.app", "1cv8.app", "1cv8ct.app", "1cv8c.app"];
						for (const app of subApps) {
							const binPath = path.join(candidateDir, app, "Contents", "MacOS", "ibcmd");
							if (fs.existsSync(binPath)) {
								return binPath;
							}
						}
						const directIbcmd = path.join(candidateDir, "ibcmd");
						if (fs.existsSync(directIbcmd)) {
							return directIbcmd;
						}
					}
				} catch {}
			}
		}

		return this.which("ibcmd");
	}

	public resolveAll(): ToolchainPaths {
		return {
			bslAnalyzer: this.resolveBslAnalyzer(),
			vrunner: this.resolveVrunner(),
			oscript: this.resolveOscript(),
			vanessaAutomationEpf: this.resolveVanessaAutomationEpf(),
			onecEnterprise: this.resolveOnecEnterprise(),
			ibcmd: this.resolveIbcmd(),
			toolsDir: this.toolsDir,
		};
	}

	private which(binary: string): string | undefined {
		try {
			const cmd = process.platform === "win32" ? `where ${binary}` : `which ${binary}`;
			const out = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
			const first = out.split(/\r?\n/)[0];
			if (first && fs.existsSync(first)) {
				return first;
			}
		} catch {}
		return undefined;
	}
}

export const defaultToolchainResolver = new ToolchainResolver();

export function getPerunPackageDir(): string {
	if (process.env.PERUN_PACKAGE_DIR) {
		return process.env.PERUN_PACKAGE_DIR;
	}
	const modulePath = new URL(import.meta.url).pathname;
	return findPerunPackageDir(path.dirname(modulePath));
}

export function getPerunBinDir(): string {
	return path.join(getPerunPackageDir(), "bin");
}

export function resolveToolsDir(): string {
	if (process.env.PERUN_TOOLS_DIR) {
		return process.env.PERUN_TOOLS_DIR;
	}
	return defaultToolchainResolver.getToolsDir();
}

export function resolveSkillsDir(): string {
	if (process.env.PERUN_SKILLS_DIR) {
		return process.env.PERUN_SKILLS_DIR;
	}
	const execDir = path.dirname(process.execPath);
	const localSkills = path.join(execDir, "skills");
	if (fs.existsSync(localSkills)) return localSkills;

	const pkgDir = getPerunPackageDir();
	const pkgSkills = path.join(pkgDir, "skills");
	if (fs.existsSync(pkgSkills)) return pkgSkills;

	const binSkills = path.join(pkgDir, "bin", "skills");
	if (fs.existsSync(binSkills)) return binSkills;

	return pkgSkills;
}

export function resolveBslAnalyzerPath(customPath?: string): string | undefined {
	if (customPath) return customPath;
	if (process.env.BSL_ANALYZER_PATH) return process.env.BSL_ANALYZER_PATH;
	const resolver = new ToolchainResolver();
	return resolver.resolveBslAnalyzer();
}

export function resolveOscriptPath(customPath?: string): string | undefined {
	if (customPath) return customPath;
	if (process.env.OSCRIPT_PATH) return process.env.OSCRIPT_PATH;
	const resolver = new ToolchainResolver();
	return resolver.resolveOscript();
}

export function resolveVrunnerPath(customPath?: string): string | undefined {
	if (customPath) return customPath;
	if (process.env.VRUNNER_PATH) return process.env.VRUNNER_PATH;
	const resolver = new ToolchainResolver();
	return resolver.resolveVrunner();
}

export function resolveVrunnerVersion(customPath?: string): string | undefined {
	const resolver = new ToolchainResolver();
	return resolver.resolveVrunnerVersion(customPath);
}

export function resolveVanessaAutomationPath(customPath?: string, projectRoot?: string): string | undefined {
	if (customPath) return customPath;
	if (process.env.VANESSA_AUTOMATION_PATH) return process.env.VANESSA_AUTOMATION_PATH;
	if (process.env.VANESSA_AUTOMATION_EPF) return process.env.VANESSA_AUTOMATION_EPF;
	if (projectRoot) {
		const candidate = path.join(projectRoot, "tools", "vanessa", "vanessa-automation.epf");
		if (fs.existsSync(candidate)) return candidate;
	}
	const resolver = new ToolchainResolver();
	return resolver.resolveVanessaAutomationEpf();
}

export function resolveIbcmdPath(customPath?: string): string | undefined {
	if (customPath) return customPath;
	if (process.env.IBCMD_PATH) return process.env.IBCMD_PATH;
	const resolver = new ToolchainResolver();
	return resolver.resolveIbcmd();
}

export function extractOnecVersion(onecPath: string): string | undefined {
	const match = onecPath.match(/(8\.\d+\.\d+(?:\.\d+)?)/);
	return match ? match[1] : undefined;
}

export function compareVersionStrings(a: string, b: string): number {
	const aParts = a.match(/\d+/g)?.map(Number) ?? [];
	const bParts = b.match(/\d+/g)?.map(Number) ?? [];
	const len = Math.max(aParts.length, bParts.length);
	for (let i = 0; i < len; i++) {
		const partA = aParts[i] ?? 0;
		const partB = bParts[i] ?? 0;
		if (partA !== partB) {
			return partA - partB;
		}
	}
	return a.localeCompare(b);
}

export function getAllToolchainPaths(): ToolchainPaths & { skillsDir: string } {
	const resolver = new ToolchainResolver();
	return {
		bslAnalyzer: resolver.resolveBslAnalyzer(),
		vrunner: resolver.resolveVrunner(),
		oscript: resolver.resolveOscript(),
		vanessaAutomationEpf: resolver.resolveVanessaAutomationEpf(),
		onecEnterprise: resolver.resolveOnecEnterprise(),
		ibcmd: resolver.resolveIbcmd(),
		toolsDir: resolver.getToolsDir(),
		skillsDir: resolveSkillsDir(),
	};
}
