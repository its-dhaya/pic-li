"use strict";

/**
 * venvResolver.js
 *
 * Shared utility that rewrites bare Python / uvicorn / flask / manage.py
 * commands to use the project's local venv binary directly.
 *
 * This is the fix for "uvicorn/flask is not recognised" on Windows and any
 * environment where the venv is not activated in the current shell session.
 * execSync() always runs in a fresh subprocess — activation does not carry
 * over — so the only reliable approach is to use the full binary path.
 *
 * Used by:
 *   src/commands/run-build-open.js   (pic run / pic build)
 *   src/core/createProject.js        (stores venv-aware runCmd in .pic/config.json)
 */

const path = require("path");
const fs = require("fs-extra");

/**
 * Returns the absolute path to the venv Python binary if a venv exists in
 * `cwd`, otherwise returns null.
 *
 * Windows : venv\Scripts\python.exe
 * Unix    : venv/bin/python
 */
function getVenvPython(cwd) {
  const isWin = process.platform === "win32";
  const binary = isWin
    ? path.join(cwd, "venv", "Scripts", "python.exe")
    : path.join(cwd, "venv", "bin", "python");
  return fs.existsSync(binary) ? binary : null;
}

/**
 * Rewrites a Python-related command so it uses the project venv directly
 * instead of whatever (possibly absent) binary is on the system PATH.
 *
 * Non-Python commands (npm, go, mvn, flutter, …) are returned unchanged.
 * If no venv exists in `cwd` the command is also returned unchanged.
 *
 * The venv path is always double-quoted so directory names that contain
 * spaces (e.g. "C:\flutter scr\…") are handled correctly on all platforms.
 *
 * @param {string} cmd  Command string to potentially rewrite
 * @param {string} cwd  Project root — checked for a venv/bin/python binary
 * @returns {string}    Resolved command safe to pass directly to execSync
 */
function resolveCmd(cmd, cwd) {
  const venvPy = getVenvPython(cwd);
  if (!venvPy) return cmd; // no venv → leave unchanged

  // Always quote: handles spaces in the path on all OSes
  const pyq = `"${venvPy}"`;

  // uvicorn <args>  →  "<venvPy>" -m uvicorn <args>
  if (/^uvicorn\s/.test(cmd))
    return `${pyq} -m uvicorn ${cmd.slice("uvicorn ".length)}`;

  // flask [run|shell|db ...]  →  "<venvPy>" -m flask [...]
  if (/^flask\b/.test(cmd))
    return `${pyq} -m flask ${cmd.slice("flask".length).trimStart()}`;

  // python manage.py <sub>  →  "<venvPy>" manage.py <sub>
  if (/^python\s+manage\.py\b/.test(cmd))
    return `${pyq} manage.py ${cmd
      .replace(/^python\s+manage\.py\s*/, "")
      .trim()}`;

  // python -m <module> <args>  →  "<venvPy>" -m <module> <args>
  if (/^python\s+-m\s+/.test(cmd))
    return `${pyq} -m ${cmd.replace(/^python\s+-m\s+/, "").trim()}`;

  // python <script>  →  "<venvPy>" <script>
  if (/^python\s+/.test(cmd))
    return `${pyq} ${cmd.replace(/^python\s+/, "").trim()}`;

  return cmd; // npm, go, mvn, flutter, cargo, … — untouched
}

module.exports = { getVenvPython, resolveCmd };
