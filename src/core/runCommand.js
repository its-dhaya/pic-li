"use strict";

const { execSync } = require("child_process");
const path = require("path");

const isWin = process.platform === "win32";

// ── Quote a path so spaces don't break shell commands ─────────────────────────
function q(p) {
  return `"${p}"`;
}

function run(cmd, opts = {}) {
  return execSync(cmd, {
    stdio: opts.silent ? "pipe" : "inherit",
    shell: true,
    cwd: opts.cwd || process.cwd(),
    windowsHide: true,
  });
}

function runSilent(cmd, opts = {}) {
  try {
    const out = execSync(cmd, {
      stdio: "pipe",
      shell: true,
      cwd: opts.cwd || process.cwd(),
      windowsHide: true,
    });
    return out ? out.toString().trim() : "";
  } catch (err) {
    const msg = (err.stderr ? err.stderr.toString() : "") || err.message || "";
    throw new Error(msg.trim());
  }
}

function runSafe(cmd, opts = {}) {
  try {
    const output = runSilent(cmd, opts);
    return { ok: true, output };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * Detect the correct Python 3 binary name for this OS.
 * Returns 'python3', 'python', or null if not found.
 */
function getPython() {
  for (const bin of ["python3", "python"]) {
    const { ok, output } = runSafe(`${bin} --version 2>&1`);
    if (!ok) continue;
    const match = output.match(/Python\s+(\d+)/i);
    if (match && parseInt(match[1], 10) >= 3) return bin;
  }
  return null; // not installed — callers must check for null
}

/**
 * Return the pip path inside a virtualenv — ALWAYS quoted for path-with-spaces safety.
 */
function getVenvPip(targetDir) {
  const p = isWin
    ? path.join(targetDir, "venv", "Scripts", "pip.exe")
    : path.join(targetDir, "venv", "bin", "pip");
  return q(p);
}

/**
 * Return the python path inside a virtualenv — ALWAYS quoted.
 */
function getVenvPython(targetDir) {
  const p = isWin
    ? path.join(targetDir, "venv", "Scripts", "python.exe")
    : path.join(targetDir, "venv", "bin", "python");
  return q(p);
}

module.exports = {
  run,
  runSilent,
  runSafe,
  getPython,
  getVenvPip,
  getVenvPython,
  isWin,
  q,
};
