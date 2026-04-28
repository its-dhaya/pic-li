# Contributing to PIC-LI

Thank you for contributing. This guide covers the full project layout and explains exactly how to add new stacks, templates, and integrations.

---

## Project structure

```
pic-li/
├── src/
│   ├── index.js                  Entry point — wires all commands via Commander
│   │
│   ├── config/
│   │   └── stacks.js             Stack registry — all stack IDs, metadata, templates
│   │
│   ├── core/
│   │   ├── createProject.js      Orchestrates generation, dep-check, .pic/config.json
│   │   └── runCommand.js         Cross-platform shell runner, venv helpers
│   │
│   ├── commands/
│   │   ├── create.js             `pic create`
│   │   ├── init.js               `pic init`
│   │   ├── add.js                `pic add <integration>`
│   │   ├── remove.js             `pic remove <integration>`
│   │   ├── list.js               `pic list`
│   │   ├── check.js              `pic check [stack]`
│   │   ├── doctor.js             `pic doctor`
│   │   ├── run.js                `pic run` / `pic build` / `pic open`
│   │   └── setup.js              `pic setup`
│   │
│   ├── generators/
│   │   ├── index.js              Registry — maps stack ID → generator module
│   │   ├── react/
│   │   │   ├── vite.js           React + Vite
│   │   │   ├── cra.js            Create React App
│   │   │   └── native.js         React Native (Expo)
│   │   ├── frontend/
│   │   │   ├── nextjs.js
│   │   │   ├── vue.js
│   │   │   └── angular.js
│   │   ├── backend/
│   │   │   ├── express.js
│   │   │   ├── nestjs.js
│   │   │   ├── spring-boot.js    Handles both spring-boot and spring-gradle
│   │   │   ├── fastapi.js
│   │   │   ├── flask.js
│   │   │   └── django.js
│   │   ├── mobile/
│   │   │   └── flutter.js
│   │   ├── fullstack/
│   │   │   └── mern.js           Full client/ + server/ monorepo
│   │   └── misc/
│   │       └── go.js
│   │
│   └── utils/
│       ├── cli/
│       │   ├── logger.js         PIC-LI branded chalk output (no emoji)
│       │   └── prompts.js        Cross-platform interactive prompts (prompts v2)
│       └── system/
│           └── detector.js       Tool detection — runs version commands safely
│
├── package.json
├── README.md
└── CONTRIBUTING.md
```

---

## Adding a new stack

### 1. Register the stack in `src/config/stacks.js`

```js
'my-stack': {
  label:       'My Stack',
  category:    'Backend (Node)',           // must match a value in CATEGORIES
  description: 'Brief one-line description',
  requires:    ['node', 'npm'],            // keys from utils/system/detector.js TOOLS
  templates:   ['default', 'with-auth'],
  generator:   'backend/my-stack',        // relative path under src/generators/
  runCmd:      'npm run dev',
  buildCmd:    'npm run build',
  devPort:     3000,
},
```

If you need a new category, add it to the `CATEGORIES` array in the same file. Categories control the order stacks appear in `pic list` and the interactive prompt.

### 2. Create the generator at `src/generators/backend/my-stack.js`

Every generator exports a single async `generate` function with this signature:

```js
'use strict';

const fs = require('fs-extra');
const path = require('path');
const { runSilent } = require('../../core/runCommand');

async function generate({ name, template, targetDir, onStep }) {
  // name       — project name string, e.g. "my-api"
  // template   — selected template string, e.g. "with-auth"
  // targetDir  — absolute path where the project should be created (already ensured)
  // onStep     — call this to update the spinner text: onStep('Installing deps')

  onStep('Creating project structure');
  // ... scaffold files with fs-extra and runSilent

  onStep('Installing dependencies');
  runSilent('npm install', { cwd: targetDir });

  onStep('Writing README');
  fs.writeFileSync(path.join(targetDir, 'README.md'), `# ${name}\n`);
}

module.exports = { generate };
```

**Rules for generators:**

- Always call `onStep(label)` before each logical phase — it drives the spinner.
- Use `runSilent(cmd, { cwd })` for all shell commands. Never use `execSync` directly.
- Use `fs-extra` (`fs.ensureDirSync`, `fs.writeFileSync`, `fs.writeJSONSync`) for all file operations.
- Never use `source venv/bin/activate` in shell commands — it does not work cross-platform. Use `getVenvPip(targetDir)` and `getVenvPython(targetDir)` from `core/runCommand.js` instead.
- Never use `npx tailwindcss init` — write `tailwind.config.js` and `postcss.config.js` manually.
- Always write a `.gitignore` and a `README.md`.
- Always write `.pic/config.json` — `createProject.js` does this automatically after generation.

### 3. Register the generator in `src/generators/index.js`

```js
'my-stack': require('./backend/my-stack'),
```

That's all. The stack will now appear in `pic list`, `pic check`, and the interactive prompt.

---

## Adding a new template to an existing stack

1. Add the template name to the `templates` array in `src/config/stacks.js`.
2. Add a human-readable label to `formatTemplate()` in `src/utils/cli/prompts.js`.
3. Handle the template with an `if (template === 'my-template')` branch inside the generator.

---

## Adding a new integration (`pic add`)

Open `src/commands/add.js` and add an entry to the `INSTALLERS` object:

```js
'my-integration': async ({ cwd, stackId, onStep }) => {
  onStep('Installing package');
  runSilent('npm install my-package', { cwd });

  onStep('Writing config');
  fs.writeFileSync(path.join(cwd, 'my.config.js'), `module.exports = {}\n`);
},
```

Then add a matching remover in `src/commands/remove.js`:

```js
'my-integration': async ({ cwd, onStep }) => {
  onStep('Removing package');
  try { runSilent('npm uninstall my-package', { cwd }); } catch {}
  onStep('Removing config file');
  try { fs.removeSync(path.join(cwd, 'my.config.js')); } catch {}
},
```

Finally, add it to `ADD_INTEGRATIONS` in `src/config/stacks.js` with a `supports` list.

---

## Adding a new tool to `pic doctor` / `pic check`

Open `src/utils/system/detector.js` and add to `TOOLS`:

```js
mytool: {
  label:    'My Tool',
  cmd:      'mytool --version',
  install:  'https://example.com/install',
  category: 'Core',
},
```

Then add the key to the appropriate category object in `src/commands/doctor.js`.

---

## Cross-platform rules

PIC-LI must work identically on:

- Windows — CMD, PowerShell, Git Bash
- macOS — bash, zsh
- Linux — bash, zsh, fish, and derivatives

Follow these rules in every generator and command:

| Do | Don't |
|----|-------|
| `getVenvPip(targetDir)` | `source venv/bin/activate` |
| `getVenvPython(targetDir)` | `venv/bin/python` hardcoded |
| `runSilent(cmd, { cwd })` with `shell: true` | `execSync` without `shell: true` |
| Write Tailwind config with `fs.writeFileSync` | `npx tailwindcss init` |
| `process.platform === 'win32'` checks | Assuming Unix |
| `path.join()` for all file paths | String concatenation with `/` |

---

## Running locally

```bash
npm install
npm link             # installs `pic` binary globally from source
pic --help
pic list
pic doctor
pic create test-app --stack react-vite --template tailwind --skip-checks
```

Use `PIC_DEBUG=1` to get full stack traces during development:

```bash
PIC_DEBUG=1 pic create test-api --stack fastapi --skip-checks
```

---

## Commit style

```
feat(react): add SWR template for react-vite
fix(django): cross-platform venv creation on Windows
chore: add bun to detector tool list
docs: update CONTRIBUTING with new template guide
```

Types: `feat` `fix` `chore` `docs` `refactor` `test`

---

## Pull request checklist

- [ ] Stack registered in `src/config/stacks.js`
- [ ] Generator exports `async generate({ name, template, targetDir, onStep })`
- [ ] Generator registered in `src/generators/index.js`
- [ ] All shell commands use `runSilent` (not `execSync` directly)
- [ ] No `source activate` or Unix-only shell syntax
- [ ] `README.md` written by the generator
- [ ] `pic create test-<stack> --stack <id> --skip-checks` runs cleanly on your machine
- [ ] Template label added to `formatTemplate()` in `src/utils/cli/prompts.js`
