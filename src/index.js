#!/usr/bin/env node
'use strict';

const { program } = require('commander');
const pkg = require('../package.json');

// ── Entry guard: ensure node >= 16 ───────────────────────────────────────────
const [major] = process.versions.node.split('.').map(Number);
if (major < 16) {
  console.error(`\n  PIC-LI requires Node.js v16 or higher. You have v${process.versions.node}.\n`);
  process.exit(1);
}

// ── Program ───────────────────────────────────────────────────────────────────
program
  .name('pic')
  .description('PIC-LI — Project Initializer Command\n  One command to scaffold any stack.')
  .version(pkg.version, '-v, --version', 'Show PIC-LI version');

// ── create ────────────────────────────────────────────────────────────────────
program
  .command('create [name]')
  .alias('new')
  .description('Create a new project (interactive or with flags)')
  .option('-s, --stack <id>',        'Stack ID  (skip interactive stack prompt)')
  .option('-t, --template <name>',   'Template  (skip interactive template prompt)')
  .option('-d, --dir <path>',        'Parent directory for the new project  [default: cwd]')
  .option('--skip-checks',           'Skip dependency check')
  .action(async (name, opts) => {
    const { createCommand } = require('./commands/create');
    await createCommand(name, opts);
  });

// ── init ──────────────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Initialize PIC config in an existing project folder')
  .option('-f, --force', 'Overwrite existing .pic/config.json')
  .action(async (opts) => {
    const { initCommand } = require('./commands/init');
    await initCommand(opts);
  });

// ── add ───────────────────────────────────────────────────────────────────────
program
  .command('add <integration>')
  .description('Add an integration to the current project')
  .addHelpText('after', `
  Integrations: tailwind, eslint, docker, firebase, prisma, mongoose, shadcn, husky, auth

  Examples:
    pic add tailwind
    pic add docker
    pic add firebase`)
  .option('--stack <id>', 'Override stack detection')
  .action(async (integration, opts) => {
    const { addCommand } = require('./commands/add');
    await addCommand(integration, opts);
  });

// ── remove ────────────────────────────────────────────────────────────────────
program
  .command('remove <integration>')
  .alias('rm')
  .description('Remove an integration from the current project')
  .action(async (integration, opts) => {
    const { removeCommand } = require('./commands/remove');
    await removeCommand(integration, opts);
  });

// ── list ──────────────────────────────────────────────────────────────────────
program
  .command('list')
  .alias('ls')
  .description('List all supported stacks and templates')
  .option('--integrations', 'Show available integrations instead')
  .action(async (opts) => {
    const { listCommand } = require('./commands/list');
    await listCommand(opts);
  });

// ── check ─────────────────────────────────────────────────────────────────────
program
  .command('check [stack]')
  .description('Check if dependencies for a stack are installed')
  .action(async (stackId) => {
    const { checkCommand } = require('./commands/check');
    await checkCommand(stackId);
  });

// ── doctor ────────────────────────────────────────────────────────────────────
program
  .command('doctor')
  .description('Full system diagnostic — checks all tools')
  .action(async (opts) => {
    const { doctorCommand } = require('./commands/doctor');
    await doctorCommand(opts);
  });

// ── run ───────────────────────────────────────────────────────────────────────
program
  .command('run')
  .description('Start the dev server for the current project')
  .option('--cmd <command>', 'Override the run command')
  .action(async (opts) => {
    const { runCommand } = require('./commands/run');
    await runCommand(opts);
  });

// ── build ─────────────────────────────────────────────────────────────────────
program
  .command('build')
  .description('Build the current project for production')
  .option('--cmd <command>', 'Override the build command')
  .action(async (opts) => {
    const { buildCommand } = require('./commands/run');
    await buildCommand(opts);
  });

// ── open ──────────────────────────────────────────────────────────────────────
program
  .command('open')
  .description('Open the current project in your editor (VS Code, Cursor, etc.)')
  .option('--path <p>', 'Path to open  [default: cwd]')
  .action(async (opts) => {
    const { openCommand } = require('./commands/run');
    await openCommand(opts);
  });

// ── setup ─────────────────────────────────────────────────────────────────────
program
  .command('setup')
  .description('Show installation commands for required dev tools')
  .action(async (opts) => {
    const { setupCommand } = require('./commands/setup');
    await setupCommand(opts);
  });

// ── Default: show help with brand header ──────────────────────────────────────
if (!process.argv.slice(2).length) {
  const logger = require('./utils/cli/logger');
  logger.brand();
  program.outputHelp();
  console.log('');
  process.exit(0);
}

program.parseAsync(process.argv).catch(err => {
  const chalk = require('chalk');
  console.error(chalk.red('\n  Error: ' + err.message));
  if (process.env.PIC_DEBUG) console.error(err.stack);
  process.exit(1);
});
