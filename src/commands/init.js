'use strict';

const path = require('path');
const fs   = require('fs-extra');
const logger  = require('../utils/cli/logger');
const { select, confirm } = require('../utils/cli/prompts');
const { STACKS } = require('../config/stacks');

async function initCommand(opts) {
  logger.brand();

  const cwd = process.cwd();
  const picConfig = path.join(cwd, '.pic', 'config.json');

  // ── Already initialised? ──────────────────────────────────────────────────
  if (fs.existsSync(picConfig) && !opts.force) {
    logger.warn('.pic/config.json already exists in this folder.');
    const overwrite = await confirm('Overwrite?', false);
    if (!overwrite) {
      logger.blank();
      logger.info('Aborted. Use --force to skip this prompt.');
      return;
    }
  }

  logger.section('Initialize PIC in this folder');
  logger.blank();
  logger.detail(cwd);
  logger.blank();

  // ── Auto-detect stack ─────────────────────────────────────────────────────
  const detected = detectStack(cwd);

  let stackId;
  if (detected) {
    logger.info(`Detected: ${STACKS[detected]?.label || detected}`);
    const use = await confirm(`Use "${STACKS[detected]?.label || detected}"?`, true);
    stackId = use ? detected : null;
  }

  if (!stackId) {
    const choices = Object.entries(STACKS).map(([id, s]) => ({
      title: `${s.label.padEnd(26)} ${s.category}`,
      value: id,
    }));
    stackId = await select('Which stack is this project?', choices);
    if (!stackId) return;
  }

  // ── Detect run command ────────────────────────────────────────────────────
  const stack = STACKS[stackId];
  const name  = path.basename(cwd);

  const config = {
    name,
    stackId,
    template:   'default',
    createdAt:  new Date().toISOString(),
    version:    require('../../package.json').version,
    runCmd:     stack.runCmd,
    buildCmd:   stack.buildCmd,
    devPort:    stack.devPort,
    initMode:   true,
  };

  fs.ensureDirSync(path.join(cwd, '.pic'));
  fs.writeJSONSync(picConfig, config, { spaces: 2 });

  // ── Add .pic to .gitignore if it exists ───────────────────────────────────
  const gitignorePath = path.join(cwd, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gi = fs.readFileSync(gitignorePath, 'utf8');
    if (!gi.includes('.pic/')) {
      fs.appendFileSync(gitignorePath, '\n# PIC-LI\n.pic/\n');
    }
  }

  logger.blank();
  logger.success('PIC initialized');
  logger.blank();
  logger.label('Project', name);
  logger.label('Stack',   stack.label);
  logger.label('Config',  '.pic/config.json');
  logger.blank();
  logger.info('You can now use: pic run  |  pic build  |  pic open');
  logger.blank();
}

function detectStack(dir) {
  const has = f => fs.existsSync(path.join(dir, f));
  const readJson = f => {
    try { return fs.readJSONSync(path.join(dir, f)); } catch { return {}; }
  };

  // Java
  if (has('pom.xml'))        return 'spring-boot';
  if (has('build.gradle'))   return 'spring-gradle';

  // Python
  if (has('manage.py'))      return 'django';
  if (has('app/main.py')) {
    const req = has('requirements.txt') ? fs.readFileSync(path.join(dir, 'requirements.txt'), 'utf8') : '';
    if (req.includes('fastapi')) return 'fastapi';
    if (req.includes('flask'))   return 'flask';
  }

  // Go
  if (has('go.mod'))         return 'go';

  // Flutter
  if (has('pubspec.yaml'))   return 'flutter';

  // Node — look at package.json
  if (has('package.json')) {
    const pkg  = readJson('package.json');
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps['@nestjs/core'])          return 'nestjs';
    if (deps['next'])                  return 'nextjs';
    if (deps['@angular/core'])         return 'angular';
    if (deps['vue'])                   return 'vue';
    if (deps['expo'])                  return 'react-native';
    if (deps['express'] && has('client') && has('server')) return 'mern';
    if (deps['express'])               return 'express';
    if (deps['react'] && deps['vite']) return 'react-vite';
    if (deps['react'])                 return 'react-cra';
    if (deps['gin-gonic/gin'])         return 'go';
  }

  return null;
}

module.exports = { initCommand };
