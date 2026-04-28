'use strict';

const logger = require('../utils/cli/logger');
const { checkTools, getMissing } = require('../utils/system/detector');
const { STACKS } = require('../config/stacks');

async function checkCommand(stackId) {
  logger.brand();

  const ALL = ['node','npm','git','java','mvn','python','pip','flutter','go','docker'];

  if (stackId && !STACKS[stackId]) {
    logger.error(`Unknown stack: "${stackId}"`);
    logger.detail('Run: pic list');
    process.exit(1);
  }

  const tools = stackId ? STACKS[stackId].requires : ALL;
  const label = stackId ? STACKS[stackId].label : 'all tools';

  logger.section(`Dependency check  —  ${label}`);
  logger.blank();

  const results = checkTools(tools);
  Object.entries(results).forEach(([, info]) => {
    logger.depRow(info.label, info.installed, info.version, info.install);
  });

  const missing = getMissing(results);
  logger.blank();

  if (missing.length === 0) {
    logger.success('All dependencies found');
  } else {
    logger.warn(`${missing.length} missing: ${missing.map(m => m.label).join(', ')}`);
    logger.blank();
    missing.forEach(m => {
      logger.detail(`Install ${m.label}:`);
      logger.detail(`  ${m.install}`);
    });
  }
  logger.blank();
}

module.exports = { checkCommand };
