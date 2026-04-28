"use strict";

const chalk = require("chalk");
const path = require("path");
const fs = require("fs");
const readline = require("readline");

/* ─── Package resolver ────────────────────────────────────────────────────── */
function findPkg() {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, "package.json");
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
    dir = path.dirname(dir);
  }
  return { version: "0.0.0", name: "app" };
}
const PKG = findPkg();

/* ─── Theme ───────────────────────────────────────────────────────────────── */
const T = {
  bg: (t) => chalk.bgBlack(t),
  primary: (t) => chalk.hex("#00D4FF")(t),
  success: (t) => chalk.hex("#4ADE80")(t),
  warn: (t) => chalk.hex("#FFB86C")(t),
  error: (t) => chalk.hex("#FF5F5F")(t),
  muted: (t) => chalk.hex("#555E6B")(t),
  dim: (t) => chalk.dim(t),
  white: (t) => chalk.white(t),
  bold: (t) => chalk.bold(t),
};

/* ─── Glyphs ──────────────────────────────────────────────────────────────── */
const G = {
  dot_ok: T.success("◆"),
  dot_warn: T.warn("◆"),
  dot_err: T.error("◆"),
  dot_info: T.primary("◆"),
  dot_dim: T.muted("◇"),
  task_done: T.success("✓"),
  task_todo: T.muted("○"),
  task_active: T.primary("◉"),
  task_skip: T.muted("–"),
  task_fail: T.error("✕"),
  stack_active: T.primary("◉"),
  stack_inactive: T.muted("○"),
  tmpl_selected: T.success("◆"),
  tmpl_default: T.muted("◇"),
  connector: T.muted("└"),
  chevron_open: T.primary("▾"),
  chevron_closed: T.muted("▸"),
  chevron: T.primary("›"),
  pipe: T.muted("│"),
  corner_tl: T.muted("╭"),
  corner_bl: T.muted("╰"),
  corner_tr: T.muted("╮"),
  corner_br: T.muted("╯"),
  h_line: "─",
  arrow: T.primary("→"),
  bullet: T.muted("·"),
  scanning: T.primary("◉"),
};

/* ─── Geometry ────────────────────────────────────────────────────────────── */
const W = 62;
const pad = "  ";
const hline = (char = G.h_line, len = W) => T.muted(char.repeat(len));

/* ─── ASCII logo ──────────────────────────────────────────────────────────── */
const LOGO_LINES = [
  " ██████╗ ██╗ ██████╗    ██╗     ██╗",
  " ██╔══██╗██║██╔════╝    ██║     ██║",
  " ██████╔╝██║██║         ██║     ██║",
  " ██╔═══╝ ██║██║         ██║     ██║",
  " ██║     ██║╚██████╗    ███████╗██║",
  " ╚═╝     ╚═╝ ╚═════╝    ╚══════╝╚═╝",
];

/* ─── Core helpers ────────────────────────────────────────────────────────── */
function write(line = "") {
  process.stdout.write(line + "\n");
}

function box_top() {
  write(pad + G.corner_tl + hline() + G.corner_tr);
}
function box_bottom() {
  write(pad + G.corner_bl + hline() + G.corner_br);
}
function box_row(content = "") {
  const stripped = content.replace(/\x1B\[[0-9;]*m/g, "");
  const fill = Math.max(0, W - stripped.length);
  write(pad + G.pipe + " " + content + " ".repeat(fill - 1) + G.pipe);
}

/* ─── Tag renderer ────────────────────────────────────────────────────────── */
function renderTag(tag) {
  if (!tag) return "";
  if (tag === "popular")
    return "  " + chalk.hex("#00A8CC").bgHex("#0d2030")(" popular ");
  if (tag === "new")
    return "  " + chalk.hex("#3ab56b").bgHex("#12200d")("   new   ");
  return "  " + T.muted(`[${tag}]`);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  REACTIVE TUI                                                               */
/* ═══════════════════════════════════════════════════════════════════════════ */

const ANSI = {
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  clearDown: "\x1b[J",
  // FIX: guard against n=0 — \x1b[0A behaviour varies across terminals
  up: (n) => (n > 0 ? `\x1b[${n}A` : ""),
};

function buildUI(secArr, deps, st) {
  const lines = [];
  const p = "  ";
  const inSt = st.zone === "stacks" || st.zone === "templates";
  const active = st.selectedId
    ? secArr.flatMap((s) => s.items).find((i) => i.id === st.selectedId)
    : null;

  // ── Breadcrumb ──
  const prefix = T.muted("Select a stack »» ");
  if (!active) {
    lines.push(p + prefix + T.dim("(none selected)"));
  } else {
    let bc = prefix + T.bold(T.primary(active.label));
    if (st.selectedTmpl)
      bc += T.muted("  /  ") + T.bold(T.success(st.selectedTmpl));
    lines.push(p + bc);
  }
  lines.push("");

  // ── Section list ──
  for (let si = 0; si < secArr.length; si++) {
    const sec = secArr[si];
    const isOpen = st.openSecIdx === si && st.zone !== "sections";
    const isCur = st.zone === "sections" && st.secCursor === si;
    const ruleLen = Math.max(2, 48 - sec.label.length);

    const chev = isOpen ? T.primary("▾") : T.muted("▸");
    const lbl = isOpen
      ? T.bold(T.primary(sec.label))
      : T.bold(T.white(sec.label));
    const cur = isCur ? T.white("> ") : "  ";
    lines.push(p + cur + chev + "  " + lbl + "  " + T.dim("─".repeat(ruleLen)));

    if (isOpen) {
      for (let ii = 0; ii < sec.items.length; ii++) {
        const item = sec.items[ii];
        const isSel = st.selectedId === item.id;
        const isCurSt = inSt && st.stackCursor === ii;
        const sCur = isCurSt ? T.white("> ") : "  ";
        const sGlyph = isSel ? T.primary("◉") : T.muted("○");
        const sLbl = isSel
          ? T.bold(T.primary(item.label))
          : T.white(item.label);
        lines.push(
          p + "   " + sCur + sGlyph + "  " + sLbl + renderTag(item.tag || "")
        );

        if (isSel && (item.templates || []).length > 0) {
          for (let ti = 0; ti < item.templates.length; ti++) {
            const tmpl = item.templates[ti];
            const tSel = st.selectedTmpl === tmpl;
            const tCur = st.zone === "templates" && st.tmplCursor === ti;
            const mark = tCur ? T.white("> ") : "  ";
            const tG = tSel ? T.success("◆") : T.muted("◇");
            const tL = tSel
              ? T.bold(T.success(tmpl))
              : chalk.hex("#8891a0")(tmpl);
            lines.push(p + "        " + mark + T.muted("└  ") + tG + "  " + tL);
          }
        }
      }
      lines.push("");
    }
  }

  // ── Project name input ──
  if (st.selectedId) {
    const isFoc = st.zone === "projectName";
    const bc = isFoc ? T.primary : T.muted;
    const lineW = "─".repeat(54);
    lines.push("");
    lines.push(
      p +
        "  " +
        bc("▌ ") +
        T.muted("ENTER PROJECT NAME") +
        (isFoc ? T.dim("  (Tab / Enter to continue)") : "")
    );
    lines.push(p + "  " + bc("┌" + lineW + "┐"));
    const display = st.projName
      ? T.white(st.projName) + (isFoc ? T.primary("█") : "")
      : T.dim("ex: my-project") + (isFoc ? T.dim(" █") : "");
    lines.push(p + "  " + bc("│") + " " + display);
    lines.push(p + "  " + bc("└" + lineW + "┘"));
  }

  // ── Divider ──
  lines.push("");
  lines.push(p + T.dim("─".repeat(58)));

  // ── Dep toggle header ──
  {
    const isCur = st.zone === "depToggle";
    const cur = isCur ? T.white("> ") : "  ";
    const chev = st.depOpen ? T.primary("▾") : T.muted("▸");
    const badge = st.depDone ? "  " + T.success("◆ all clear") : "";
    lines.push("");
    lines.push(
      p + cur + chev + "  " + T.bold(T.white("Dependency check")) + badge
    );
  }

  // ── Dep body ──
  if (st.depOpen) {
    const lineW = "─".repeat(54);
    lines.push(p + "  " + T.muted("┌" + lineW + "┐"));

    if (st.depProgress === 0 && !st.depRunning) {
      lines.push(
        p +
          "  " +
          T.muted("│") +
          "  " +
          T.muted("· · ·  ") +
          T.dim("run check to scan environment")
      );
    } else {
      for (let i = 0; i < st.depProgress && i < deps.length; i++) {
        const d = deps[i];
        const g = d.ok ? T.success("✓") : T.error("✕");
        const name = T.white(d.name.padEnd(10));
        const info = d.ok
          ? T.muted("v" + d.ver + "  ") + T.success("installed")
          : T.dim((d.url || "") + "  ") + T.warn("not found");
        lines.push(p + "  " + T.muted("│") + "  " + g + "  " + name + info);
      }
      if (st.depRunning) {
        lines.push(
          p + "  " + T.muted("│") + "  " + T.primary("◉  scanning...")
        );
      }
    }
    lines.push(p + "  " + T.muted("└" + lineW + "┘"));

    const isFoc = st.zone === "depBtn";
    const btnLine = "─".repeat(52);
    const ok = !!st.selectedId && !!st.projName.trim() && st.depDone;

    if (!st.depRunning) {
      if (!st.depDone) {
        const bc = isFoc ? T.primary : T.muted;
        lines.push("");
        lines.push(p + "  " + bc("┌" + btnLine + "┐"));
        lines.push(
          p +
            "  " +
            bc("│") +
            "  " +
            T.primary("◆  ") +
            T.bold(
              isFoc
                ? T.white("run dependency check")
                : T.muted("run dependency check")
            ) +
            (isFoc ? T.dim("  ← Enter") : "")
        );
        lines.push(p + "  " + bc("└" + btnLine + "┘"));
        lines.push("");
      } else {
        const bc = isFoc ? T.primary : ok ? T.success : T.muted;
        lines.push("");
        lines.push(p + "  " + bc("┌" + btnLine + "┐"));
        lines.push(
          p +
            "  " +
            bc("│") +
            "  " +
            (ok ? T.success("◆") : T.muted("◆")) +
            "  " +
            T.bold(
              ok ? T.white("scaffold project") : T.muted("scaffold project")
            ) +
            "  " +
            (ok ? T.primary("→") : T.muted("→")) +
            (isFoc && !ok ? T.warn("  (select stack + name first)") : "") +
            (isFoc && ok ? T.dim("  ← Enter") : "")
        );
        lines.push(p + "  " + bc("└" + btnLine + "┘"));
        lines.push("");
      }
    } else {
      lines.push("");
      lines.push(
        p +
          "  " +
          T.primary("◉  ") +
          T.muted("running checks... " + st.depProgress + "/" + deps.length)
      );
      lines.push("");
    }
  }

  // ── Summary box ──
  if (st.showSummary && active) {
    const lineW = "─".repeat(56);
    const blank = "│" + " ".repeat(56) + "│";
    const tmpl = st.selectedTmpl || "default";
    const name = st.projName.trim();
    // Use the stack's own commands; fall back sensibly if not provided
    const installCmd = active.installCmd || "npm install";
    const devCmd = active.runCmd || "pic run";
    const cmds = ["cd " + name, installCmd, devCmd, "pic run"];
    lines.push("");
    lines.push(p + "╭" + lineW + "╮");
    lines.push(p + blank);
    lines.push(
      p +
        "│  " +
        T.success("✓  ") +
        T.bold(T.white(name)) +
        "  " +
        T.muted("is ready")
    );
    lines.push(p + blank);
    lines.push(
      p + "│  " + T.muted("stack".padEnd(10) + "  ") + T.primary(active.label)
    );
    lines.push(
      p + "│  " + T.muted("template".padEnd(10) + "  ") + T.white(tmpl)
    );
    lines.push(
      p + "│  " + T.muted("location".padEnd(10) + "  ") + T.dim("~/" + name)
    );
    lines.push(p + blank);
    lines.push(p + "│" + T.dim("─".repeat(56)) + "│");
    lines.push(p + "│  " + T.bold(T.white("Next steps")));
    lines.push(p + blank);
    for (const cmd of cmds) {
      const note = cmd === "pic run" ? T.muted("  ─  run all stacks") : "";
      lines.push(p + "│  " + T.muted("$  ") + T.primary(cmd) + note);
    }
    lines.push(p + blank);
    lines.push(p + "╰" + lineW + "╯");
  }

  // ── Hint bar ──
  const hints = {
    sections: "↑↓ move  Enter open  Tab skip",
    stacks: "↑↓ move  Enter select  Esc back  Tab skip",
    templates: "↑↓ move  Enter pick  Esc back  Tab skip",
    projectName: "Type name  Enter / Tab continue  Esc back",
    depToggle: "Enter toggle dep panel  Tab wrap",
    depBtn: "Enter run / scaffold  Esc back",
  };
  lines.push("");
  lines.push(p + T.muted(hints[st.zone] || ""));

  return lines;
}

/* ── Main TUI runner ─────────────────────────────────────────────────────── */
function runStackSelectorTUI(sections, deps) {
  return new Promise((resolve, reject) => {
    // ── Guard: must be a real TTY ──────────────────────────────────────────
    // Without a TTY, setRawMode silently fails and keypress events never fire.
    if (!process.stdin.isTTY) {
      reject(
        new Error(
          "stackSelector requires an interactive terminal (stdin is not a TTY).\n" +
            "Run the CLI directly instead of piping / redirecting stdin."
        )
      );
      return;
    }

    // ── Windows: enable Virtual Terminal Processing ────────────────────────
    // On Windows, ANSI cursor-movement codes (\x1b[NA etc.) are OFF by default
    // in the legacy console host. Without this, the TUI just scrolls endlessly
    // downward instead of redrawing in place.
    // chalk@4 enables color VT, but NOT cursor/erase sequences — do it explicitly.
    if (process.platform === "win32") {
      try {
        // Trick: writing an ANSI sequence that chalk hasn't already sent forces
        // the Windows Console to switch into VT mode for this handle.
        process.stdout.write("\x1b[0m");
        // Also set the output code page to UTF-8 so box-drawing chars render.
        // (requires chcp, safe to ignore if it fails)
        require("child_process").execSync("chcp 65001", { stdio: "ignore" });
      } catch (_) {}
    }

    // Normalise sections: accept both array and { key: { label, items } } object
    const secArr = Array.isArray(sections)
      ? sections
      : Object.entries(sections).map(([id, s]) => ({ id, ...s }));

    // ── State ──────────────────────────────────────────────────────────────
    const st = {
      zone: "sections",
      secCursor: 0,
      openSecIdx: null,
      stackCursor: 0,
      selectedId: null,
      tmplCursor: 0,
      selectedTmpl: null,
      projName: "",
      depOpen: false,
      depRunning: false,
      depDone: false,
      depProgress: 0,
      showSummary: false,
      // Deps filtered to only what the selected stack requires.
      // Starts empty; populated the moment a stack is picked.
      activeDeps: [],
    };

    let prevLines = 0;
    let depTimer = null;

    // ── Helpers ────────────────────────────────────────────────────────────
    const openSec = () =>
      st.openSecIdx !== null ? secArr[st.openSecIdx] : null;
    const getItem = () =>
      st.selectedId
        ? secArr.flatMap((s) => s.items).find((i) => i.id === st.selectedId)
        : null;
    const getTmpls = () => getItem()?.templates || [];
    const canScaffold = () =>
      !!st.selectedId && !!st.projName.trim() && st.depDone;

    // ── Dep animation ──────────────────────────────────────────────────────
    function startDepScan() {
      st.depRunning = true;
      st.depProgress = 0;
      render();
      depTimer = setInterval(() => {
        st.depProgress++;
        // Only scan the deps relevant to the selected stack
        if (st.depProgress >= st.activeDeps.length) {
          clearInterval(depTimer);
          depTimer = null;
          st.depRunning = false;
          st.depDone = true;
        }
        render();
      }, 420);
    }

    // ── Render ─────────────────────────────────────────────────────────────
    function render() {
      const lines = buildUI(secArr, st.activeDeps, st);

      // Move cursor back up over the previous render, then clear downward
      if (prevLines > 0) {
        process.stdout.write(ANSI.up(prevLines) + ANSI.clearDown);
      }

      process.stdout.write(ANSI.hideCursor);
      process.stdout.write(lines.join("\n") + "\n");
      prevLines = lines.length;

      // Show cursor only when the user needs to type a project name
      if (st.zone === "projectName") {
        process.stdout.write(ANSI.showCursor);
      }
    }

    // ── Cleanup ────────────────────────────────────────────────────────────
    function cleanup() {
      if (depTimer) {
        clearInterval(depTimer);
        depTimer = null;
      }
      try {
        // FIX: remove listener BEFORE touching raw mode / pause
        process.stdin.removeListener("keypress", onKey);
        process.stdin.setRawMode(false);
        // FIX: pause stdin so the process can exit cleanly
        process.stdin.pause();
      } catch (_) {}
      process.stdout.write(ANSI.showCursor);
    }

    function finish(result) {
      cleanup();
      resolve(result);
    }

    // ── Key handler ────────────────────────────────────────────────────────
    function onKey(str, key) {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(0);
      }

      const zone = st.zone;

      if (zone === "sections") {
        if (key.name === "up") st.secCursor = Math.max(0, st.secCursor - 1);
        if (key.name === "down")
          st.secCursor = Math.min(secArr.length - 1, st.secCursor + 1);
        if (key.name === "return") {
          st.openSecIdx = st.secCursor;
          st.stackCursor = 0;
          st.zone = "stacks";
        }
        if (key.name === "tab") st.zone = "depToggle";
      } else if (zone === "stacks") {
        const items = openSec()?.items || [];
        if (key.name === "up") {
          if (st.stackCursor === 0) st.zone = "sections";
          else st.stackCursor--;
        }
        if (key.name === "down")
          st.stackCursor = Math.min(items.length - 1, st.stackCursor + 1);
        if (key.name === "return") {
          const item = items[st.stackCursor];
          if (item) {
            if (st.selectedId === item.id) {
              st.selectedId = null;
              st.selectedTmpl = null;
              st.activeDeps = [];
              // Reset dep state so next stack gets a fresh check
              st.depDone = false;
              st.depProgress = 0;
            } else {
              st.selectedId = item.id;
              st.selectedTmpl = null;
              st.tmplCursor = 0;
              // Filter the master dep list to only what this stack needs
              st.activeDeps = item.requires
                ? deps.filter((d) => item.requires.includes(d.name))
                : deps;
              // Reset dep check — different stack may need different tools
              st.depDone = false;
              st.depProgress = 0;
              st.zone =
                item.templates?.length > 0 ? "templates" : "projectName";
            }
          }
        }
        if (key.name === "escape") st.zone = "sections";
        if (key.name === "tab")
          st.zone =
            st.selectedId && getTmpls().length > 0
              ? "templates"
              : "projectName";
      } else if (zone === "templates") {
        const tmpls = getTmpls();
        if (key.name === "up") st.tmplCursor = Math.max(0, st.tmplCursor - 1);
        if (key.name === "down")
          st.tmplCursor = Math.min(tmpls.length - 1, st.tmplCursor + 1);
        if (key.name === "return") {
          st.selectedTmpl = tmpls[st.tmplCursor];
          st.zone = "projectName";
        }
        if (key.name === "escape") st.zone = "stacks";
        if (key.name === "tab") st.zone = "projectName";
      } else if (zone === "projectName") {
        if (key.name === "return" || key.name === "tab") {
          st.zone = "depToggle";
        } else if (key.name === "escape") {
          st.zone = getTmpls().length > 0 ? "templates" : "stacks";
        } else if (key.name === "backspace" || key.name === "delete") {
          st.projName = st.projName.slice(0, -1);
        } else if (str && !key.ctrl && !key.meta && str.length === 1) {
          st.projName += str;
        }
      } else if (zone === "depToggle") {
        if (key.name === "return" || str === " ") {
          st.depOpen = !st.depOpen;
          if (st.depOpen) st.zone = "depBtn";
        }
        if (key.name === "up") st.zone = "projectName";
        if (key.name === "down") {
          if (st.depOpen) st.zone = "depBtn";
        }
        if (key.name === "tab") st.zone = "sections";
        if (key.name === "escape") st.zone = "projectName";
      } else if (zone === "depBtn") {
        if (key.name === "return") {
          if (!st.depDone && !st.depRunning) {
            startDepScan();
            return; // startDepScan calls render()
          } else if (st.depDone && canScaffold()) {
            st.showSummary = true;
            render();
            setTimeout(
              () =>
                finish({
                  stackId: st.selectedId,
                  template: st.selectedTmpl,
                  projectName: st.projName.trim(),
                }),
              700
            );
            return;
          }
        }
        if (key.name === "up") st.zone = "depToggle";
        if (key.name === "escape") st.zone = "depToggle";
        if (key.name === "tab") st.zone = "sections";
      }

      render();
    }

    // ── Boot ───────────────────────────────────────────────────────────────
    // Order matters:
    //   1. emitKeypressEvents FIRST (wraps stdin stream with keypress parser)
    //   2. setRawMode(true)   — disable line-buffering, send each keystroke immediately
    //   3. resume()           — FIX: stdin is PAUSED by default in Node.js;
    //                           without resume() the stream never emits data
    //                           and keypress events never fire
    //   4. on("keypress", …)  — attach handler
    //   5. initial render

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume(); // ← THE CRITICAL FIX
    process.stdin.on("keypress", onKey);

    // Write one blank line so the first render's cursor-up lands correctly
    process.stdout.write("\n");
    prevLines = 1;
    render();
  });
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  PUBLIC LOGGER API                                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */
const logger = {
  brand(opts = {}) {
    const { model = "", directory = "" } = opts;
    write("");
    box_top();
    for (const line of LOGO_LINES) {
      box_row(T.primary(line));
    }
    write(pad + G.pipe + T.muted(G.h_line.repeat(W)) + G.pipe);
    const ver = T.muted(`v${PKG.version}`);
    const name = T.bold(T.white((PKG.name || "app").toUpperCase()));
    box_row(`  ${name}  ${ver}`);
    if (model) box_row(`  ${T.muted("model")}  ${T.primary(model)}`);
    if (directory) box_row(`  ${T.muted("dir  ")}  ${T.dim(directory)}`);
    box_bottom();
    write("");
  },

  stackBreadcrumb(opts = {}) {
    const { selectedStack = null, selectedTemplate = null } = opts;
    const prefix = T.muted("Select a stack ") + T.muted("»»") + " ";
    if (!selectedStack) {
      write(`${pad}${prefix}${T.dim("(none selected)")}`);
    } else {
      let line = prefix + T.primary(selectedStack);
      if (selectedTemplate)
        line += T.muted("  /  ") + T.success(selectedTemplate);
      write(`${pad}${line}`);
    }
    write("");
  },

  sectionToggle(title, isOpen = false) {
    const chevron = isOpen ? G.chevron_open : G.chevron_closed;
    const label = isOpen ? T.bold(T.primary(title)) : T.bold(T.white(title));
    const rule = hline(G.h_line, W - title.length - 4);
    write(`${pad}${chevron}  ${label}  ${rule}`);
  },

  stackItem(opts = {}) {
    const { label = "", isActive = false, tag = "" } = opts;
    const glyph = isActive ? G.stack_active : G.stack_inactive;
    const lbl = isActive ? T.bold(T.primary(label)) : T.white(label);
    write(`${pad}    ${glyph}  ${lbl}${renderTag(tag)}`);
  },

  subItem(label, isSelected = false) {
    const glyph = isSelected ? G.tmpl_selected : G.tmpl_default;
    const lbl = isSelected
      ? T.bold(T.success(label))
      : chalk.hex("#8891a0")(label);
    write(`${pad}       ${G.connector}  ${glyph}  ${lbl}`);
  },

  groupLabel(label) {
    write(`${pad}  ${T.muted("▎")} ${T.muted(label)}`);
  },

  projectPrompt(opts = {}) {
    const { value = "" } = opts;
    write("");
    write(`${pad}  ${T.primary("▌")} ${T.muted("ENTER PROJECT NAME")}`);
    const display = value
      ? T.white(value) + T.primary("█")
      : T.dim("ex: my-project") + T.dim("  █");
    write(`${pad}  ${T.muted("┌" + "─".repeat(W - 4) + "┐")}`);
    write(`${pad}  ${T.muted("│")} ${display}`);
    write(`${pad}  ${T.muted("└" + "─".repeat(W - 4) + "┘")}`);
    write("");
  },

  depHeader(opts = {}) {
    const { isOpen = false, allClear = false } = opts;
    const chevron = isOpen ? G.chevron_open : G.chevron_closed;
    const title = T.bold(T.white("Dependency check"));
    const badge = allClear
      ? "  " + T.success("◆") + " " + T.success("all clear")
      : "";
    write(`${pad}${chevron}  ${title}${badge}`);
  },

  depTerminal(deps = [], opts = {}) {
    const { progress = deps.length, scanning = false, empty = false } = opts;
    write(`${pad}  ${T.muted("┌" + "─".repeat(W - 4) + "┐")}`);
    if (empty || (!scanning && progress === 0)) {
      write(
        `${pad}  ${T.muted("│")}  ${T.muted("· · ·")}  ${T.dim(
          "run check to scan environment"
        )}`
      );
    } else {
      for (const d of deps.slice(0, progress)) {
        const glyph = d.ok ? G.task_done : G.task_fail;
        const name = T.white(d.name.padEnd(12));
        const info = d.ok
          ? T.muted("v" + d.ver) + "  " + T.success("installed")
          : T.dim(d.url || "") + "  " + T.warn("not found");
        write(`${pad}  ${T.muted("│")}  ${glyph}  ${name}${info}`);
      }
      if (scanning) {
        write(
          `${pad}  ${T.muted("│")}  ${G.scanning}  ${T.primary("scanning...")}`
        );
      }
    }
    write(`${pad}  ${T.muted("└" + "─".repeat(W - 4) + "┘")}`);
  },

  actionBtn(type = "run-dep", enabled = true) {
    write("");
    if (type === "run-dep") {
      const label =
        T.primary("◆") + "  " + T.bold(T.white("run dependency check"));
      write(`${pad}  ${T.muted("┌" + "─".repeat(W - 4) + "┐")}`);
      write(`${pad}  ${T.muted("│")}  ${label}`);
      write(`${pad}  ${T.muted("└" + "─".repeat(W - 4) + "┘")}`);
    } else if (type === "scaffold") {
      const dot = enabled ? T.success("◆") : T.muted("◆");
      const label = enabled
        ? T.bold(T.white("scaffold project")) + "  " + T.primary("→")
        : T.muted("scaffold project") + "  " + T.muted("→");
      const border = enabled ? T.primary : T.muted;
      const side = enabled ? T.primary : T.muted;
      write(`${pad}  ${border("┌" + "─".repeat(W - 4) + "┐")}`);
      write(`${pad}  ${side("│")}  ${dot}  ${label}`);
      write(`${pad}  ${border("└" + "─".repeat(W - 4) + "┘")}`);
    }
    write("");
  },

  stackSelector(opts = {}) {
    const { sections = {}, deps = [] } = opts;
    return runStackSelectorTUI(sections, deps);
  },

  tip(msg) {
    write(`${pad}${T.muted("Tip")}  ${T.dim(msg)}`);
    write("");
  },

  section(title) {
    write("");
    write(`${pad}${G.chevron} ${T.bold(T.white(title))}`);
    write(`${pad}${hline(G.h_line, W - 2)}`);
  },

  label(key, val, color) {
    const k = T.muted(key.padEnd(14));
    const v = color ? chalk[color]?.(val) ?? val : T.white(val);
    write(`${pad}  ${k}  ${v}`);
  },

  info(msg) {
    write(`${pad}${G.dot_info}  ${msg}`);
  },
  success(msg) {
    write(`${pad}${G.dot_ok}  ${T.success(msg)}`);
  },
  warn(msg) {
    write(`${pad}${G.dot_warn}  ${T.warn(msg)}`);
  },
  error(msg) {
    write(`${pad}${G.dot_err}  ${T.error(msg)}`);
  },
  muted(msg) {
    write(`${pad}${G.dot_dim}  ${T.dim(msg)}`);
  },

  arrow(msg) {
    write(`${pad}${G.arrow}  ${msg}`);
  },
  detail(msg) {
    write(`${pad}   ${T.dim(msg)}`);
  },

  step(n, total, msg) {
    const counter = T.muted(
      `[${String(n).padStart(String(total).length)}/${total}]`
    );
    write(`${pad}${counter}  ${msg}`);
  },

  tasks(title, tasks = []) {
    if (title) {
      write("");
      write(`${pad}${G.chevron} ${T.bold(T.white(title))}`);
    }
    for (const t of tasks) {
      const glyph =
        {
          done: G.task_done,
          active: G.task_active,
          todo: G.task_todo,
          skip: G.task_skip,
          fail: G.task_fail,
        }[t.state] ?? G.task_todo;
      const label =
        t.state === "done"
          ? T.muted(t.label)
          : t.state === "active"
          ? T.bold(T.primary(t.label))
          : t.state === "skip"
          ? T.muted(t.label)
          : t.state === "fail"
          ? T.error(t.label)
          : T.white(t.label);
      const note = t.note ? `  ${T.dim(t.note)}` : "";
      write(`${pad}  ${glyph}  ${label}${note}`);
    }
  },

  depRow(label, installed, version, installUrl) {
    const lbl = T.white(label.padEnd(18));
    if (installed) {
      write(`${pad}  ${G.task_done}  ${lbl}  ${T.muted("v" + version)}`);
    } else {
      const url = installUrl ? T.dim(installUrl) : "";
      write(
        `${pad}  ${G.task_fail}  ${lbl}  ${T.warn("not installed")}  ${url}`
      );
    }
  },

  cmd(text) {
    write(`${pad}  ${T.muted("$")}  ${T.primary(text)}`);
  },
  divider() {
    write(`${pad}${hline()}`);
  },
  blank() {
    write("");
  },

  done(opts = {}) {
    const {
      projectName = "project",
      stackLabel = "",
      template = "",
      targetDir = "",
      runCmd = [],
    } = opts;
    write("");
    box_top();
    box_row("");
    box_row(
      `  ${G.task_done}  ${T.bold(T.white(projectName))}  ${T.muted(
        "is ready"
      )}`
    );
    box_row("");
    if (stackLabel)
      box_row(`  ${T.muted("stack".padEnd(10))}  ${T.primary(stackLabel)}`);
    if (template)
      box_row(`  ${T.muted("template".padEnd(10))}  ${T.white(template)}`);
    if (targetDir)
      box_row(`  ${T.muted("location".padEnd(10))}  ${T.dim(targetDir)}`);
    box_row("");
    write(pad + G.pipe + T.muted(G.h_line.repeat(W)) + G.pipe);
    box_row(`  ${T.bold(T.white("Next steps"))}`);
    box_row("");
    const cmds = Array.isArray(runCmd) ? runCmd : runCmd ? [runCmd] : [];
    for (const c of cmds) {
      box_row(`  ${T.muted("$")}  ${T.primary(c)}`);
    }
    box_row(
      `  ${T.muted("$")}  ${T.primary("pic run")}  ${T.muted(
        "─  run all stacks"
      )}`
    );
    box_row("");
    box_bottom();
    write("");
  },

  updateNotice(current, latest) {
    write("");
    write(`${pad}${hline()}`);
    write(
      `${pad}  ${G.dot_warn}  ` +
        T.warn("Update available") +
        `  ${T.muted(current)} ${G.arrow} ${T.primary(latest)}`
    );
    logger.cmd("npm update -g " + (PKG.name || "this-package"));
    write(`${pad}${hline()}`);
    write("");
  },
};

module.exports = logger;

/* ─── Demo (node logger.js) ─────────────────────────────────────────────── */
if (require.main === module) {
  logger.brand({
    model: "gpt-4.1  /model to change",
    directory: "~/code/myapp",
  });
  logger.tip(
    "Use /feedback to send logs to the maintainers when something looks off."
  );
  logger.info("Scanning workspace...");
  logger.muted("Reading manifests and lock files");
  logger.tasks("Updated Plan", [
    {
      label: "Inventory workspace layout",
      state: "done",
      note: "Cargo members + top-level docs",
    },
    {
      label: "Trace the main runtime flow",
      state: "active",
      note: "CLI/TUI → core → protocol",
    },
    { label: "Summarise important subsystems", state: "todo" },
    { label: "Call out testing strategy", state: "todo" },
  ]);
  logger.blank();
  logger.section("Dependencies");
  logger.depRow("node", true, "20.11.0");
  logger.depRow("pnpm", true, "9.1.0");
  logger.depRow("rust", false, "", "https://rustup.rs");
  logger.depRow("docker", true, "26.0.1");
  logger.blank();
  logger.step(1, 4, "Installing packages");
  logger.step(2, 4, "Compiling assets");
  logger.success("Build complete in 3.2 s");
  logger.warn("Peer dependency mismatch detected");
  logger.error("Could not connect to registry");
  logger.done({
    projectName: "codex-rs",
    stackLabel: "Rust + TypeScript",
    template: "full-stack/monorepo",
    targetDir: "~/code/codex-rs",
    runCmd: ["cd codex-rs", "pnpm install", "pnpm dev"],
  });
  logger.updateNotice("0.0.0", "1.2.4");

  const SECTIONS = {
    frontend: {
      label: "Frontend",
      items: [
        {
          id: "react-vite",
          label: "React + Vite",
          tag: "popular",
          templates: [],
        },
        {
          id: "react-tailwind",
          label: "React + Tailwind",
          tag: "",
          templates: ["default", "tailwind", "shadcn/ui"],
        },
        {
          id: "nextjs",
          label: "Next.js",
          tag: "new",
          templates: ["app-router", "pages-router"],
        },
        {
          id: "svelte",
          label: "Svelte + Kit",
          tag: "",
          templates: ["default", "ts"],
        },
      ],
    },
    backend: {
      label: "Backend",
      items: [
        {
          id: "express",
          label: "Express.js",
          tag: "",
          templates: ["rest-api", "graphql"],
        },
        {
          id: "fastapi",
          label: "FastAPI",
          tag: "popular",
          templates: ["basic", "auth", "docker"],
        },
      ],
    },
    microservice: {
      label: "Micro service",
      items: [
        { id: "grpc", label: "gRPC + Protobuf", tag: "", templates: [] },
        {
          id: "trpc",
          label: "tRPC + Zod",
          tag: "new",
          templates: ["monorepo", "standalone"],
        },
      ],
    },
  };

  const DEPS = [
    { name: "node", ok: true, ver: "20.11.0" },
    { name: "pnpm", ok: true, ver: "9.1.0" },
    { name: "rust", ok: false, url: "rustup.rs" },
    { name: "docker", ok: true, ver: "26.0.1" },
    { name: "git", ok: true, ver: "2.44.0" },
  ];

  (async () => {
    const result = await logger.stackSelector({
      sections: SECTIONS,
      deps: DEPS,
    });
    logger.blank();
    logger.success(
      `Scaffolding  ${result.projectName}  (${result.stackId} / ${
        result.template || "default"
      })`
    );
  })();
}
