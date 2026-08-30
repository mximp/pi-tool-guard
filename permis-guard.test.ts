import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	compilePatterns,
	DEFAULT_PATTERNS,
	getGuardSettings,
	readSettings,
} from "./permis-guard.ts";

describe("readSettings", () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const dir of dirs.splice(0))
			rmSync(dir, { recursive: true, force: true });
	});

	it("returns parsed JSON for a valid file", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-tool-guard-"));
		dirs.push(dir);
		const path = join(dir, "settings.json");
		writeFileSync(
			path,
			JSON.stringify({ permissionGuard: { bashPatterns: ["x"] } }),
		);

		expect(readSettings(path)).toEqual({
			permissionGuard: { bashPatterns: ["x"] },
		});
	});

	it("returns empty object for a missing file", () => {
		expect(readSettings(join(tmpdir(), "does-not-exist.json"))).toEqual({});
	});

	it("returns empty object for invalid JSON", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-tool-guard-"));
		dirs.push(dir);
		const path = join(dir, "settings.json");
		writeFileSync(path, "{ not json");

		expect(readSettings(path)).toEqual({});
	});
});

describe("getGuardSettings", () => {
	it("merges project over global settings", () => {
		const global = { permissionGuard: { bashPatterns: ["a", "b"] } };
		const project = { permissionGuard: { bashPatterns: ["c"] } };

		expect(getGuardSettings(global, project)).toEqual({ bashPatterns: ["c"] });
	});

	it("uses global when project has no permissionGuard key", () => {
		const global = { permissionGuard: { bashPatterns: ["a"] } };

		expect(getGuardSettings(global, {})).toEqual({ bashPatterns: ["a"] });
	});

	it("returns empty settings when neither has the key", () => {
		expect(getGuardSettings({}, {})).toEqual({});
	});
});

describe("compilePatterns", () => {
	it("compiles valid regex sources", () => {
		const patterns = compilePatterns(["\\brm\\b", ">>?"]);

		expect(patterns).toHaveLength(2);
		expect(patterns[0]?.test("rm -rf /")).toBe(true);
		expect(patterns[1]?.test("echo hi > out")).toBe(true);
	});

	it("skips non-string entries", () => {
		expect(
			compilePatterns([42 as unknown as string, "\\bssh\\b"]),
		).toHaveLength(1);
	});

	it("skips invalid regex without losing other patterns", () => {
		const patterns = compilePatterns(["[unclosed", "\\bmkdir\\b"]);

		expect(patterns).toHaveLength(1);
		expect(patterns[0]?.test("mkdir build")).toBe(true);
	});

	it("returns empty array for empty input", () => {
		expect(compilePatterns([])).toEqual([]);
	});

	it("default patterns match dangerous commands", () => {
		const patterns = compilePatterns(DEFAULT_PATTERNS);

		expect(patterns.length).toBeGreaterThan(0);
		expect(patterns.some((p) => p.test("rm -rf /"))).toBe(true);
		expect(patterns.some((p) => p.test("echo hi >> log"))).toBe(true);
		expect(patterns.some((p) => p.test("ssh host"))).toBe(true);
		expect(patterns.some((p) => p.test("ls -la"))).toBe(false);
	});
});
