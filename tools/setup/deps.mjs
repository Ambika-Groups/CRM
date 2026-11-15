// The real-world side of the wizard: network, processes, files, questions. Everything the phases touch comes through
// here, which is what lets the tests replace it with mocks. Nothing in this file prints a secret.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

/** Quote one argument for cmd.exe (npx is a .cmd on Windows and cannot be started without a shell). */
export const winQuote = (a) => (/[\s"&|<>^%]/.test(a) || a === "" ? `"${String(a).replace(/"/g, '\\"')}"` : String(a));

/** Run a program; capture its output, or (inherit) let the person see and use it directly (logins, deploys). */
export function run(cmd, args = [], { cwd = root, inherit = false, env = {} } = {}) {
  return new Promise((resolve) => {
    const win = process.platform === "win32";
    const child = spawn(win ? [cmd, ...args.map(winQuote)].join(" ") : cmd, win ? [] : args, {
      cwd, env: { ...process.env, ...env }, shell: win, stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    child.on("error", (e) => resolve({ code: 127, stdout, stderr: String(e.message) }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function prompt(question, def = "") {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(`${question}${def ? ` [${def}]` : ""} `)) || def; } finally { rl.close(); }
}

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

export function realDeps() {
  return {
    root, path, env: process.env, nodeVersion: process.versions.node,
    fetch: (url, init) => fetch(url, { signal: AbortSignal.timeout(30_000), ...init }),
    run, prompt, home: () => homedir(), now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    fs: {
      exists: async (f) => existsSync(f),
      read: (f) => readFile(f, "utf8"),
      write: async (f, text) => { await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, text, "utf8"); },
    },
    chromePath: CHROME_PATHS.find((p) => existsSync(p)) ?? null,
    log: (s) => console.log(s),
  };
}
