/**
 * Permission Guard Extension
 *
 * For the bash tool, prompts the user only when the command looks dangerous.
 * Patterns are regular expressions read from the pi config files:
 *
 *   ~/.pi/agent/settings.json (global)
 *   .pi/settings.json (project, only when trusted)
 *
 * {
 *   "permissionGuard": {
 *     "bashPatterns": ["\\brm\\b", "\\bmkdir\\b", ">>?", "\\bssh\\b"]
 *   }
 * }
 *
 * Project settings override global settings (arrays replace, not merge). When
 * the key is missing or no pattern compiles, the built-in defaults are used.
 *
 * In non-interactive modes (-p, --mode json/rpc) there is no UI to confirm
 * with, so the call is blocked fail-safe.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";

export const DEFAULT_PATTERNS: string[] = [
	"\\brm\\b", // rm command (any occurrence)
	"\\bmkdir\\b",
	">>?", // output redirection (" > " or ">>")
	"\\bssh\\b",
];

interface PermissionGuardSettings {
	bashPatterns?: string[];
}

export function readSettings(path: string): Record<string, unknown> {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	} catch {
		return {};
	}
}

export function getGuardSettings(
	globalSettings: Record<string, unknown>,
	projectSettings: Record<string, unknown>,
): PermissionGuardSettings {
	const global = (globalSettings.permissionGuard ??
		{}) as PermissionGuardSettings;
	const project = (projectSettings.permissionGuard ??
		{}) as PermissionGuardSettings;
	return { ...global, ...project };
}

export function compilePatterns(sources: string[]): RegExp[] {
	const patterns: RegExp[] = [];
	for (const source of sources) {
		if (typeof source !== "string") continue;
		try {
			patterns.push(new RegExp(source));
		} catch {
			// Skip invalid regex; other patterns still apply.
		}
	}
	return patterns;
}

function loadPatterns(cwd: string, isProjectTrusted: () => boolean): RegExp[] {
	const globalSettings = readSettings(join(getAgentDir(), "settings.json"));
	const projectSettings = isProjectTrusted()
		? readSettings(join(cwd, CONFIG_DIR_NAME, "settings.json"))
		: {};

	const guard = getGuardSettings(globalSettings, projectSettings);
	const sources =
		guard.bashPatterns && guard.bashPatterns.length > 0
			? guard.bashPatterns
			: DEFAULT_PATTERNS;

	const patterns = compilePatterns(sources);
	return patterns.length > 0 ? patterns : compilePatterns(DEFAULT_PATTERNS);
}

export default function (pi: ExtensionAPI) {
	let patterns: RegExp[] | undefined;

	const getPatterns = (
		cwd: string,
		isProjectTrusted: () => boolean,
	): RegExp[] => {
		if (!patterns) patterns = loadPatterns(cwd, isProjectTrusted);
		return patterns;
	};

	pi.on("session_start", () => {
		// Reload per session so config edits and project switches take effect.
		patterns = undefined;
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;
		const command = (event.input.command as string) ?? "";

		const dangerous = getPatterns(ctx.cwd, () => ctx.isProjectTrusted()).some(
			(p) => p.test(command),
		);
		if (!dangerous) return undefined;
		const summary = `$ ${command}`;

		if (!ctx.hasUI) {
			return {
				block: true,
				reason: `Blocked ${event.toolName} (no UI to confirm): ${summary}`,
			};
		}

		const choice = await ctx.ui.select(
			`Allow ${event.toolName}?\n\n  ${summary}`,
			["Yes", "No"],
		);

		return choice === "Yes"
			? undefined
			: { block: true, reason: `Denied by user: ${summary}` };
	});
}
