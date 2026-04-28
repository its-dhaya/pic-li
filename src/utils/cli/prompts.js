"use strict";

/**
 * All prompts use the `prompts` package (v2) which:
 *  - works on Windows CMD, PowerShell, Git Bash
 *  - works on macOS (bash, zsh)
 *  - works on Linux (bash, zsh, fish, etc.)
 *  - does NOT kill the terminal on Ctrl+C (handles gracefully)
 *
 * ─── Stack selector wizard ──────────────────────────────────────────────────
 * The full interactive stack-selector (stack → template → name → dep check →
 * scaffold) is now a reactive Ink TUI inside logger.js. Use it like this:
 *
 *   const logger = require("./logger");
 *   const result = await logger.stackSelector({ sections, deps });
 *   // result → { stackId: string, template: string|null, projectName: string }
 *
 * The individual helpers below (selectStack, selectTemplate, inputProjectName)
 * still work for any standalone one-off prompts elsewhere in the CLI.
 * ────────────────────────────────────────────────────────────────────────────
 */

const prompts = require("prompts");
const chalk = require("chalk");
const { STACKS, CATEGORIES } = require("../../config/stacks");

// Handle Ctrl+C gracefully instead of crashing
function onCancel() {
  console.log("");
  console.log(chalk.dim("  Cancelled."));
  console.log("");
  process.exit(0);
}

// ── Stack selection ───────────────────────────────────────────────────────────
async function selectStack() {
  const choices = [];
  for (const cat of CATEGORIES) {
    choices.push({
      title: chalk.dim(`── ${cat} `),
      value: null,
      disabled: true,
    });
    const inCat = Object.entries(STACKS).filter(([, s]) => s.category === cat);
    for (const [id, s] of inCat) {
      choices.push({
        title: `  ${s.label.padEnd(26)} ${chalk.dim(s.description)}`,
        value: id,
      });
    }
  }

  const res = await prompts(
    {
      type: "select",
      name: "stackId",
      message: "Select a stack",
      choices,
      hint: "Use arrow keys, press Enter to confirm",
      warn: "(header — not selectable)",
    },
    { onCancel }
  );

  return res.stackId;
}

// ── Template selection ────────────────────────────────────────────────────────
async function selectTemplate(stackId) {
  const stack = STACKS[stackId];
  if (!stack || stack.templates.length <= 1)
    return stack?.templates?.[0] || "default";

  const choices = stack.templates.map((t) => ({
    title: formatTemplate(t),
    value: t,
  }));

  const res = await prompts(
    {
      type: "select",
      name: "template",
      message: `Select a template for ${chalk.white(stack.label)}`,
      choices,
    },
    { onCancel }
  );

  return res.template;
}

// ── Project name input ────────────────────────────────────────────────────────
async function inputProjectName(defaultName) {
  const res = await prompts(
    {
      type: "text",
      name: "name",
      message: "Project name",
      initial: defaultName || "my-project",
      validate: (v) => {
        if (!v.trim()) return "Name cannot be empty";
        if (!/^[a-zA-Z0-9_\-. ]+$/.test(v.trim()))
          return "Use letters, numbers, hyphens, underscores or dots only";
        return true;
      },
    },
    { onCancel }
  );

  return res.name ? res.name.trim() : null;
}

// ── Confirm (yes/no) ──────────────────────────────────────────────────────────
async function confirm(message, initial = false) {
  const res = await prompts(
    { type: "confirm", name: "value", message, initial },
    { onCancel }
  );
  return res.value;
}

// ── Select from a list ────────────────────────────────────────────────────────
async function select(message, choices) {
  const res = await prompts(
    { type: "select", name: "value", message, choices },
    { onCancel }
  );
  return res.value;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTemplate(t) {
  const names = {
    default: "Default              minimal setup",
    typescript: "TypeScript           strongly typed",
    tailwind: "Tailwind CSS         utility-first styling",
    "tailwind-shadcn": "Tailwind + shadcn/ui accessible components",
    "tailwind-typescript": "Tailwind + TS        styled + typed",
    "rest-api": "REST API             CRUD endpoints",
    "rest-api-mongo": "REST API + MongoDB",
    "rest-api-mysql": "REST API + MySQL",
    "rest-api-postgres": "REST API + PostgreSQL",
    "with-sqlalchemy": "With SQLAlchemy ORM",
    "with-mongodb": "With MongoDB (Motor)",
    "full-stack": "Full Stack           API + DB + Auth",
    "with-auth": "With JWT Auth",
    "with-provider": "With Provider        state management",
    "with-riverpod": "With Riverpod        state management",
    "with-bloc": "With BLoC pattern",
    "with-tailwind": "With Tailwind CSS",
    "with-drf": "With Django REST Framework",
    "with-postgres": "With PostgreSQL",
    "with-gorm": "With GORM ORM",
    microservice: "Microservice         ready template",
    graphql: "GraphQL API",
    material: "Angular Material",
    tabs: "Tab navigation",
    "with-typescript": "With TypeScript",
  };
  return names[t] || t;
}

module.exports = {
  selectStack,
  selectTemplate,
  inputProjectName,
  confirm,
  select,
  formatTemplate,
};
