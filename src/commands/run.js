"use strict";

const path = require("path");
const fs = require("fs-extra");
const { execSync } = require("child_process");
const logger = require("../utils/cli/logger");
const { STACKS } = require("../config/stacks");

// ── Helper: read .pic config from cwd ────────────────────────────────────────
function readPicConfig() {
  const configPath = path.join(process.cwd(), ".pic", "config.json");
  if (!fs.existsSync(configPath)) return null;
  try {
    return fs.readJSONSync(configPath);
  } catch {
    return null;
  }
}

// ── venv resolution ───────────────────────────────────────────────────────────
// Returns the path to the venv Python binary, or null if no venv exists.
// Works on both Windows (Scripts\python.exe) and Unix (bin/python).
function getVenvPython(cwd) {
  const isWin = process.platform === "win32";
  const binary = isWin
    ? path.join(cwd, "venv", "Scripts", "python.exe")
    : path.join(cwd, "venv", "bin", "python");
  return fs.existsSync(binary) ? binary : null;
}

/**
 * resolveCmd — rewrites bare Python/uvicorn/flask/manage.py commands so they
 * use the project's venv directly instead of relying on PATH activation.
 *
 * This is the core fix for the "uvicorn/flask is not recognized" error on
 * Windows (and anywhere else the venv is not activated in the shell session).
 *
 * Non-Python commands (npm, go, mvn, …) are returned unchanged.
 *
 * @param {string} cmd  - The command string to potentially rewrite
 * @param {string} cwd  - The project directory to look for a venv in
 * @returns {string}    - The resolved command, safe to pass to execSync
 */
function resolveCmd(cmd, cwd) {
  const venvPy = getVenvPython(cwd);
  if (!venvPy) return cmd; // no venv present — leave unchanged

  // Always quote the path: handles spaces in directory names (e.g. "flutter scr")
  const pyq = `"${venvPy}"`;

  // uvicorn <args>  →  <venvPy> -m uvicorn <args>
  if (/^uvicorn\s/.test(cmd))
    return `${pyq} -m uvicorn ${cmd.slice("uvicorn ".length)}`;

  // flask [run|shell|db ...]  →  <venvPy> -m flask [...]
  if (/^flask\b/.test(cmd))
    return `${pyq} -m flask ${cmd.slice("flask".length).trimStart()}`;

  // python manage.py <subcmd>  →  <venvPy> manage.py <subcmd>
  if (/^python\s+manage\.py\b/.test(cmd))
    return `${pyq} manage.py ${cmd
      .replace(/^python\s+manage\.py\s*/, "")
      .trim()}`;

  // python -m <module> <args>  →  <venvPy> -m <module> <args>
  if (/^python\s+-m\s+/.test(cmd))
    return `${pyq} -m ${cmd.replace(/^python\s+-m\s+/, "").trim()}`;

  // python <script>  →  <venvPy> <script>
  if (/^python\s+/.test(cmd))
    return `${pyq} ${cmd.replace(/^python\s+/, "").trim()}`;

  return cmd; // npm, go, mvn, flutter, etc. — untouched
}

// ── Detect stack from filesystem ──────────────────────────────────────────────
function detectRunCmd(cwd) {
  const has = (f) => fs.existsSync(path.join(cwd, f));
  const pkg = (() => {
    try {
      return fs.readJSONSync(path.join(cwd, "package.json"));
    } catch {
      return {};
    }
  })();
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  // Python projects — always expressed as `python -m <runner>` so that
  // resolveCmd can correctly swap in the venv python at run time.
  if (has("manage.py")) return "python manage.py runserver";

  if (has("app/main.py")) {
    const req = has("requirements.txt")
      ? fs.readFileSync(path.join(cwd, "requirements.txt"), "utf8")
      : "";
    if (req.includes("fastapi")) return "uvicorn app.main:app --reload";
    if (req.includes("flask")) return "flask run";
  }

  if (has("run.py")) {
    const req = has("requirements.txt")
      ? fs.readFileSync(path.join(cwd, "requirements.txt"), "utf8")
      : "";
    if (req.includes("flask")) return "flask run";
  }

  // Java
  if (has("pom.xml")) return "mvn spring-boot:run";
  if (has("build.gradle")) return "./gradlew bootRun";

  // Go
  if (has("go.mod")) return "go run .";

  // Mobile
  if (has("pubspec.yaml")) return "flutter run";
  if (has("Cargo.toml")) return "cargo run";

  // Node — check specific frameworks before generic scripts
  if (deps["@nestjs/core"]) return "npm run start:dev";
  if (deps["next"]) return "npm run dev";
  if (deps["vite"]) return "npm run dev";
  if (deps["expo"]) return "npx expo start";
  if (pkg.scripts?.dev) return "npm run dev";
  if (pkg.scripts?.start) return "npm start";

  return null;
}

function detectBuildCmd(cwd) {
  const has = (f) => fs.existsSync(path.join(cwd, f));
  const pkg = (() => {
    try {
      return fs.readJSONSync(path.join(cwd, "package.json"));
    } catch {
      return {};
    }
  })();

  if (has("pom.xml")) return "mvn package -DskipTests";
  if (has("build.gradle")) return "./gradlew build";
  if (has("go.mod")) return "go build -o app .";
  if (pkg.scripts?.build) return "npm run build";
  return null;
}

// ── run ───────────────────────────────────────────────────────────────────────
async function runCommand(opts) {
  logger.brand();
  const cwd = process.cwd();
  const config = readPicConfig();
  const rawCmd = opts.cmd || config?.runCmd || detectRunCmd(cwd);

  if (!rawCmd) {
    logger.error("Could not determine run command.");
    logger.detail("Run: pic init   to configure this project");
    logger.detail('  or pass:  pic run --cmd "your command"');
    process.exit(1);
  }

  // ── Rewrite Python commands to use the project venv ──────────────────────
  // This fixes "uvicorn/flask is not recognized" on Windows and any
  // environment where the venv is not activated in the current shell session.
  const cmd = resolveCmd(rawCmd, cwd);

  const stackLabel = config
    ? STACKS[config.stackId]?.label || config.stackId
    : "project";
  logger.section(`Running ${stackLabel}`);
  logger.blank();
  logger.cmd(rawCmd); // show the human-readable form, not the resolved path
  logger.blank();

  try {
    execSync(cmd, { cwd, stdio: "inherit", shell: true });
  } catch (err) {
    if (err.status !== 130) {
      // 130 = Ctrl+C — not an error
      logger.blank();
      logger.error("Process exited with error.");
    }
  }
}

// ── build ─────────────────────────────────────────────────────────────────────
async function buildCommand(opts) {
  logger.brand();
  const cwd = process.cwd();
  const config = readPicConfig();
  const rawCmd = opts.cmd || config?.buildCmd || detectBuildCmd(cwd);

  if (!rawCmd) {
    logger.error("Could not determine build command.");
    logger.detail("Run: pic init   to configure this project");
    process.exit(1);
  }

  const cmd = resolveCmd(rawCmd, cwd);

  const stackLabel = config
    ? STACKS[config.stackId]?.label || config.stackId
    : "project";
  logger.section(`Building ${stackLabel}`);
  logger.blank();
  logger.cmd(rawCmd);
  logger.blank();

  try {
    execSync(cmd, { cwd, stdio: "inherit", shell: true });
    logger.blank();
    logger.success("Build complete");
    logger.blank();
  } catch (err) {
    logger.blank();
    logger.error("Build failed");
    process.exit(err.status || 1);
  }
}

// ── open ──────────────────────────────────────────────────────────────────────
async function openCommand(opts) {
  logger.brand();
  const cwd = process.cwd();

  const editors = [
    { cmd: "code", label: "VS Code" },
    { cmd: "cursor", label: "Cursor" },
    { cmd: "subl", label: "Sublime Text" },
    { cmd: "idea", label: "IntelliJ IDEA" },
    { cmd: "webstorm", label: "WebStorm" },
  ];

  let editor = null;
  for (const e of editors) {
    try {
      const which = require("which");
      which.sync(e.cmd);
      editor = e;
      break;
    } catch {}
  }

  if (!editor) {
    logger.error("No supported editor found (VS Code, Cursor, Sublime, IDEA).");
    logger.detail("Install VS Code: https://code.visualstudio.com");
    process.exit(1);
  }

  const target = opts.path ? path.resolve(opts.path) : cwd;
  logger.section(`Opening in ${editor.label}`);
  logger.blank();
  logger.cmd(`${editor.cmd} "${target}"`);
  logger.blank();

  try {
    execSync(`${editor.cmd} "${target}"`, { stdio: "ignore", shell: true });
    logger.success(`Opened in ${editor.label}`);
  } catch (err) {
    logger.error(`Could not open ${editor.label}: ${err.message}`);
    process.exit(1);
  }
  logger.blank();
}

module.exports = {
  runCommand,
  buildCommand,
  openCommand,
  resolveCmd,
  getVenvPython,
};
