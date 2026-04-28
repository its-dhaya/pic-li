'use strict';

const chalk = require('chalk');
const logger = require('../utils/cli/logger');
const { STACKS, CATEGORIES, ADD_INTEGRATIONS } = require('../config/stacks');

async function listCommand(opts) {
  logger.brand();

  if (opts.integrations) {
    logger.section('Available integrations  (pic add <name>)');
    logger.blank();
    Object.entries(ADD_INTEGRATIONS).forEach(([key, info]) => {
      logger.label(key, info.label);
      logger.detail('Supports: ' + info.supports.join(', '));
      logger.blank();
    });
    return;
  }

  logger.section('Available stacks');
  logger.blank();

  for (const cat of CATEGORIES) {
    const inCat = Object.entries(STACKS).filter(([, s]) => s.category === cat);
    if (!inCat.length) continue;
    console.log(`  ${chalk.bold.white(cat)}`);
    console.log(chalk.dim('  ' + '─'.repeat(44)));

    for (const [id, s] of inCat) {
      console.log(`  ${chalk.cyan(id.padEnd(20))} ${chalk.white(s.label)}`);
      console.log(`  ${' '.repeat(20)} ${chalk.dim(s.description)}`);
      console.log(`  ${' '.repeat(20)} ${chalk.dim('templates: ' + s.templates.join(', '))}`);
      console.log('');
    }
  }

  logger.divider();
  logger.blank();
  logger.info('Usage:  pic create <name> --stack <id> --template <template>');
  logger.info('List integrations:  pic list --integrations');
  logger.blank();
}

module.exports = { listCommand };
