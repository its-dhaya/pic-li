"use strict";

const path = require("path");
const fs = require("fs-extra");
const ora = require("ora");
const https = require("https");

const logger = require("../utils/cli/logger");
const { checkTools, getMissing } = require("../utils/system/detector");
const { getGenerator } = require("../generators/index");
const { STACKS } = require("../config/stacks");
const { confirm } = require("../utils/cli/prompts");
const { handleMissingTools } = require("./autoInstall");

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE NORMALIZER
// Reads everything from stack.templateAliases — no hardcoded names here.
//
// Resolution order:
//   1. Exact match in stack.templateAliases  ("mongodb" → "mongo")
//   2. Already a valid canonical ID in stack.templates — pass through as-is
//   3. Universal synonyms for "default"
//   4. Pass through unchanged — generator handles unknown values itself
// ─────────────────────────────────────────────────────────────────────────────
const UNIVERSAL_DEFAULT_SYNONYMS = new Set([
  "minimal",
  "blank",
  "basic",
  "starter",
  "empty",
]);

function normalizeTemplate(raw, stack) {
  if (!raw) return "default";

  const key = String(raw).toLowerCase().trim();
  const aliases = stack.templateAliases || {};
  const validIds = new Set(stack.templates || []);

  // 1. Stack alias map hit
  if (aliases[key] !== undefined) return aliases[key];

  // 2. Already a valid canonical ID for this stack
  if (validIds.has(key)) return key;

  // 3. Universal "default" synonyms
  if (UNIVERSAL_DEFAULT_SYNONYMS.has(key)) return "default";

  // 4. Pass through — let the generator decide
  return key;
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN HINT — driven entirely by stack config flags, zero stack-name checks
//
// Stack config properties used:
//   stack.activate   (bool)   — prepend venv activation (Python stacks)
//   stack.installCmd (string) — extra install step before runCmd (e.g. MERN)
//   stack.runCmd     (string) — the main start command
// ─────────────────────────────────────────────────────────────────────────────
function buildRunHint(stack, name) {
  const cd = `cd ${name}`;
  const win = process.platform === "win32";
  const cmds = [cd];

  if (stack.activate) {
    cmds.push(win ? "venv\\Scripts\\activate" : "source venv/bin/activate");
  }

  if (stack.installCmd) {
    cmds.push(stack.installCmd);
  }

  if (stack.runCmd) {
    cmds.push(stack.runCmd);
  }

  return cmds;
}

// ─────────────────────────────────────────────────────────────────────────────
// SEMVER COMPARE
// ─────────────────────────────────────────────────────────────────────────────
function isNewer(latest, current) {
  const parse = (v) => v.split(".").map(Number);
  const [lM, lm, lp] = parse(latest);
  const [cM, cm, cp] = parse(current);
  if (lM !== cM) return lM > cM;
  if (lm !== cm) return lm > cm;
  return lp > cp;
}

// ─────────────────────────────────────────────────────────────────────────────
// NON-BLOCKING UPDATE CHECK
// ─────────────────────────────────────────────────────────────────────────────
function checkForUpdate() {
  return new Promise((resolve) => {
    let pkg;
    try {
      pkg = JSON.parse(
        require("fs").readFileSync(
          path.join(__dirname, "..", "..", "package.json"),
          "utf8"
        )
      );
    } catch {
      return resolve({ hasUpdate: false });
    }

    const req = https.get(
      "https://registry.npmjs.org/pic-li/latest",
      { timeout: 2000 },
      (res) => {
        let raw = "";
        res.on("data", (d) => (raw += d));
        res.on("end", () => {
          try {
            const latest = JSON.parse(raw).version;
            resolve(
              latest && isNewer(latest, pkg.version)
                ? { hasUpdate: true, current: pkg.version, latest }
                : { hasUpdate: false }
            );
          } catch {
            resolve({ hasUpdate: false });
          }
        });
      }
    );
    req.on("error", () => resolve({ hasUpdate: false }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ hasUpdate: false });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function createProject({
  name,
  stackId,
  template: rawTemplate,
  targetDir,
  skipChecks,
}) {
  // ── Validate stack ────────────────────────────────────────────────────────
  const stack = STACKS[stackId];
  if (!stack) {
    logger.error(`Unknown stack: "${stackId}"`);
    logger.detail(`Available: ${Object.keys(STACKS).join(", ")}`);
    process.exit(1);
  }

  // ── Normalize template — reads from stack config, never from hardcoded map ─
  const template = normalizeTemplate(rawTemplate, stack);

  if (process.env.PIC_DEBUG) {
    console.log(
      `[DEBUG] stack="${stackId}"  raw="${rawTemplate}"  resolved="${template}"`
    );
  }

  // ── Non-blocking update check (runs in background) ────────────────────────
  const updateCheck = checkForUpdate();

  // ── Dependency check + auto-install ──────────────────────────────────────
  if (!skipChecks) {
    logger.section("Dependency check");
    logger.blank();

    const results = checkTools(stack.requires);
    Object.entries(results).forEach(([, info]) => {
      logger.depRow(info.label, info.installed, info.version, info.install);
    });

    const missing = getMissing(results);

    if (missing.length > 0) {
      await handleMissingTools(missing);

      const results2 = checkTools(stack.requires);
      const stillMissing = getMissing(results2);

      if (stillMissing.length > 0) {
        logger.blank();
        logger.warn(
          "Still missing: " + stillMissing.map((m) => m.label).join(", ")
        );
        logger.detail(
          "The project may not scaffold correctly without these tools."
        );
        logger.blank();
        const proceed = await confirm("Continue anyway (may fail)?", false);
        if (!proceed) {
          logger.blank();
          logger.info("Cancelled. Install the missing tools and try again.");
          logger.blank();
          process.exit(0);
        }
      } else {
        logger.blank();
        logger.success("All dependencies ready");
      }
    } else {
      logger.blank();
      logger.success("All dependencies found");
    }
  }

  // ── Project info ──────────────────────────────────────────────────────────
  logger.section("Creating project");
  logger.blank();
  logger.label("Name", name);
  logger.label("Stack", stack.label);
  logger.label("Template", template);
  logger.label("Location", targetDir);
  logger.blank();

  // ── Guard: target dir must not already exist ──────────────────────────────
  if (await fs.pathExists(targetDir)) {
    logger.error(`Directory already exists: ${targetDir}`);
    logger.detail("Delete it first or choose a different name.");
    process.exit(1);
  }
  fs.ensureDirSync(targetDir);

  // ── Resolve and run generator ─────────────────────────────────────────────
  const generator = getGenerator(stackId);
  if (!generator) {
    logger.error(`No generator registered for stack: "${stackId}"`);
    process.exit(1);
  }

  const spinner = ora({
    prefixText: " ",
    spinner: "dots2",
    color: "cyan",
  }).start("Starting...");

  function onStep(label) {
    spinner.text = label;
  }

  try {
    await generator.generate({ name, template, targetDir, onStep });
    spinner.succeed("Done");
  } catch (err) {
    spinner.fail("Project creation failed");
    logger.error(err.message);
    if (process.env.PIC_DEBUG) console.error(err.stack);
    // Remove target dir only if it ended up empty (partial or no scaffold)
    try {
      if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length === 0) {
        fs.removeSync(targetDir);
      }
    } catch {}
    process.exit(1);
  }

  // ── Persist .pic/config.json ──────────────────────────────────────────────
  try {
    const pkgVer = JSON.parse(
      require("fs").readFileSync(
        path.join(__dirname, "..", "..", "package.json"),
        "utf8"
      )
    ).version;

    const picDir = path.join(targetDir, ".pic");
    fs.ensureDirSync(picDir);
    fs.writeJSONSync(
      path.join(picDir, "config.json"),
      {
        name,
        stackId,
        template,
        createdAt: new Date().toISOString(),
        version: pkgVer,
        runCmd: stack.runCmd ?? null,
        buildCmd: stack.buildCmd ?? null,
        devPort: stack.devPort ?? null,
      },
      { spaces: 2 }
    );
  } catch {}

  // ── Success output ────────────────────────────────────────────────────────
  const runCmds = buildRunHint(stack, name);
  logger.done(
    name,
    stack.label,
    template,
    path.relative(process.cwd(), targetDir) || targetDir,
    runCmds
  );

  const upd = await updateCheck;
  if (upd.hasUpdate) logger.updateNotice(upd.current, upd.latest);
}

module.exports = { createProject, checkForUpdate };
