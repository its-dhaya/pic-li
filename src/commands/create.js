"use strict";

const path = require("path");
const logger = require("../utils/cli/logger");
const { createProject } = require("../core/createProject");
const { STACKS, CATEGORIES } = require("../config/stacks");

// ── Master dep catalogue ──────────────────────────────────────────────────────
// Every tool any stack might need. The TUI filters this list down to only the
// deps required by whichever stack the user selects.
const ALL_DEPS = {
  node: { name: "node", ok: true, ver: process.versions.node },
  npm: { name: "npm", ok: true, ver: "—" },
  python: { name: "python", ok: false, url: "python.org/downloads" },
  pip: { name: "pip", ok: false, url: "pip.pypa.io" },
  java: { name: "java", ok: false, url: "adoptium.net" },
  mvn: { name: "mvn", ok: false, url: "maven.apache.org" },
  gradle: { name: "gradle", ok: false, url: "gradle.org" },
  flutter: { name: "flutter", ok: false, url: "flutter.dev" },
  dart: { name: "dart", ok: false, url: "dart.dev" },
  go: { name: "go", ok: false, url: "go.dev/dl" },
  git: { name: "git", ok: true, ver: "—" },
};

// Flat array of every unique dep referenced by any stack — the master list.
// logger.stackSelector filters this down per selected stack automatically.
function buildMasterDeps() {
  const seen = new Set();
  const list = [];
  for (const stack of Object.values(STACKS)) {
    for (const req of stack.requires || []) {
      if (!seen.has(req) && ALL_DEPS[req]) {
        seen.add(req);
        list.push(ALL_DEPS[req]);
      }
    }
  }
  return list;
}

// ── Build SECTIONS for the TUI ────────────────────────────────────────────────
// Each item carries `requires`, `runCmd`, and `installCmd` so the TUI can:
//   • show only the relevant deps once a stack is selected
//   • show the correct "Next steps" in the summary box
function buildSections() {
  const sections = {};
  for (const cat of CATEGORIES) {
    const items = Object.entries(STACKS)
      .filter(([, s]) => s.category === cat)
      .map(([id, s]) => ({
        id,
        label: s.label,
        tag: s.tag || "",
        templates: s.templates || [],
        requires: s.requires || [],
        runCmd: s.runCmd || "pic run",
        installCmd: s.installCmd || "npm install",
      }));
    if (items.length === 0) continue;
    const key = cat.toLowerCase().replace(/\s+/g, "-").replace(/[()]/g, "");
    sections[key] = { label: cat, items };
  }
  return sections;
}

// ── Main command ──────────────────────────────────────────────────────────────
async function createCommand(nameArg, opts) {
  logger.brand();

  let stackId = opts.stack || null;
  let template = opts.template || null;
  let name = nameArg || null;

  if (stackId && !STACKS[stackId]) {
    logger.error(`Unknown stack: "${stackId}"`);
    logger.detail("Run: pic list");
    process.exit(1);
  }

  // ── Interactive TUI — only when no --stack flag was given ─────────────────
  if (!stackId) {
    const result = await logger.stackSelector({
      sections: buildSections(),
      deps: buildMasterDeps(),
    });
    stackId = result.stackId;
    template = result.template || null;
    name = result.projectName;
  }

  // ── Fallbacks for flag-only usage ─────────────────────────────────────────
  if (!template) {
    template = STACKS[stackId]?.templates?.[0] || "default";
  }
  if (!name) {
    logger.error(
      "Project name is required.  Usage: pic create <name> --stack <id>"
    );
    process.exit(1);
  }
  if (!stackId) process.exit(0);

  const base = opts.dir ? path.resolve(opts.dir) : process.cwd();
  const targetDir = path.join(base, name);

  await createProject({
    name,
    stackId,
    template,
    targetDir,
    skipChecks: !!opts.skipChecks,
  });
}

module.exports = { createCommand };
