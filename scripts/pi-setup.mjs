/**
 * Copies the pi-tool-guard extension into pi's user-level extension folder
 * (~/.pi/agent/extensions/), where it is auto-discovered for all projects.
 *
 * Run with: npm run pi-setup
 */

import { copyFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const source = new URL("../pi-tool-guard.ts", import.meta.url).pathname;
const targetDir = join(homedir(), ".pi", "agent", "extensions");
const target = join(targetDir, "pi-tool-guard.ts");

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);

console.log(`Installed ${source} -> ${target}`);
