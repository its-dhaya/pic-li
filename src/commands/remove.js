'use strict';

const path = require('path');
const fs   = require('fs-extra');
const logger = require('../utils/cli/logger');
const { runSilent } = require('../core/runCommand');
const { confirm } = require('../utils/cli/prompts');

const REMOVERS = {
  tailwind: async ({ cwd, onStep }) => {
    onStep('Uninstalling Tailwind packages');
    try { runSilent('npm uninstall tailwindcss postcss autoprefixer', { cwd }); } catch {}
    onStep('Removing config files');
    ['tailwind.config.js', 'postcss.config.js', 'tailwind.config.ts'].forEach(f => {
      try { fs.removeSync(path.join(cwd, f)); } catch {}
    });
    onStep('Stripping Tailwind directives from CSS');
    const cssFiles = ['src/index.css','src/styles/index.css','src/App.css','src/style.css'];
    for (const f of cssFiles) {
      const p = path.join(cwd, f);
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf8')
          .replace(/@tailwind base;\n?/g, '')
          .replace(/@tailwind components;\n?/g, '')
          .replace(/@tailwind utilities;\n?/g, '');
        fs.writeFileSync(p, content);
      }
    }
  },

  eslint: async ({ cwd, onStep }) => {
    onStep('Uninstalling ESLint + Prettier');
    try { runSilent('npm uninstall eslint prettier eslint-config-prettier eslint-plugin-prettier', { cwd }); } catch {}
    onStep('Removing config files');
    ['.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml',
     '.prettierrc', '.prettierrc.js', '.prettierrc.json', 'prettier.config.js'].forEach(f => {
      try { fs.removeSync(path.join(cwd, f)); } catch {}
    });
  },

  docker: async ({ cwd, onStep }) => {
    onStep('Removing Docker files');
    ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', '.dockerignore'].forEach(f => {
      try { fs.removeSync(path.join(cwd, f)); } catch {}
    });
  },

  firebase: async ({ cwd, onStep }) => {
    onStep('Uninstalling Firebase');
    try { runSilent('npm uninstall firebase', { cwd }); } catch {}
    onStep('Removing firebase.js');
    ['src/firebase.js', 'src/firebase.ts'].forEach(f => {
      try { fs.removeSync(path.join(cwd, f)); } catch {}
    });
  },

  prisma: async ({ cwd, onStep }) => {
    onStep('Uninstalling Prisma');
    try { runSilent('npm uninstall prisma @prisma/client', { cwd }); } catch {}
    onStep('Removing prisma folder');
    try { fs.removeSync(path.join(cwd, 'prisma')); } catch {}
  },

  husky: async ({ cwd, onStep }) => {
    onStep('Uninstalling Husky');
    try { runSilent('npm uninstall husky lint-staged', { cwd }); } catch {}
    try { fs.removeSync(path.join(cwd, '.husky')); } catch {}
  },
};

async function removeCommand(integration, opts) {
  logger.brand();

  const intKey = integration.toLowerCase();
  const remover = REMOVERS[intKey];

  if (!remover) {
    logger.error(`Unknown integration: "${integration}"`);
    logger.blank();
    logger.info('Removable integrations:');
    Object.keys(REMOVERS).forEach(k => logger.detail(k));
    logger.blank();
    process.exit(1);
  }

  logger.section(`Removing ${integration}`);
  logger.blank();
  logger.warn('This will delete config files and uninstall packages.');
  const ok = await confirm('Continue?', false);
  if (!ok) { logger.blank(); logger.info('Cancelled.'); return; }

  logger.blank();
  const cwd = process.cwd();

  function onStep(label) { logger.detail(label); }

  try {
    await remover({ cwd, onStep });
    logger.blank();
    logger.success(`${integration} removed`);
    logger.blank();
  } catch (err) {
    logger.error(`Failed: ${err.message}`);
    if (process.env.PIC_DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

module.exports = { removeCommand };
