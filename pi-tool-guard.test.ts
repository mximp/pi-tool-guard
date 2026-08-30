import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	compilePatterns,
	DEFAULT_PATTERNS,
	readSettings,
} from "./pi-tool-guard.ts";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

function writeTempSettings(content: string): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-tool-guard-"));
	tempDirs.push(dir);
	const path = join(dir, "settings.json");
	writeFileSync(path, content);
	return path;
}

describe("readSettings", () => {
	it("returns parsed JSON for a valid file", () => {
		const path = writeTempSettings(
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
		const path = writeTempSettings("{ not json");

		expect(readSettings(path)).toEqual({});
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

		expect(patterns).toHaveLength(DEFAULT_PATTERNS.length);
		expect(patterns.some((p) => p.test("ssh host"))).toBe(true);
		expect(patterns.some((p) => p.test("ls -la"))).toBe(false);
	});
});
