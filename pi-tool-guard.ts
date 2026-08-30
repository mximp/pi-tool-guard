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

const DEFAULT_COMPILED: RegExp[] = DEFAULT_PATTERNS.map(
	(source) => new RegExp(source),
);

export function readSettings(path: string): Record<string, unknown> {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	} catch {
		return {};
	}
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

	// Project settings override global settings (replace, not merge).
	const guard = (projectSettings.permissionGuard ??
		globalSettings.permissionGuard) as { bashPatterns?: string[] } | undefined;
	const compiled = compilePatterns(guard?.bashPatterns ?? DEFAULT_PATTERNS);
	return compiled.length > 0 ? compiled : DEFAULT_COMPILED;
}

export default function (pi: ExtensionAPI) {
	let patterns: RegExp[] | undefined;

	const getPatterns = (
		cwd: string,
		isProjectTrusted: () => boolean,
	): RegExp[] => (patterns ??= loadPatterns(cwd, isProjectTrusted));

	pi.on("session_start", () => {
		// Reload per session so config edits and project switches take effect.
		patterns = undefined;
	});

	pi.on("tool_call", async (event, ctx) => {
		let bash_match = false;
		let command = "";
		if (event.toolName === "bash") {
			command = (event.input.command as string) ?? "";
			bash_match = getPatterns(ctx.cwd, () => ctx.isProjectTrusted()).some(
				(p) => p.test(command),
			);
		}

		if (!["write", "edit"].includes(event.toolName) && !bash_match)
			return undefined;

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
