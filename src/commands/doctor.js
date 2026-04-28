'use strict';

const path = require('path');
const fs   = require('fs-extra');
const logger = require('../utils/cli/logger');
const { checkTools } = require('../utils/system/detector');
const { STACKS } = require('../config/stacks');

const ALL_TOOLS = [
  'node','npm','npx','git','docker',
  'java','mvn','gradle',
  'python','pip',
  'flutter','dart',
  'go',
  'code','cursor',
];

async function doctorCommand(opts) {
  logger.brand();
  logger.section('System health check');
  logger.blank();

  const results = checkTools(ALL_TOOLS);

  // ── Group by category ────────────────────────────────────────────────────
  const categories = {
    'Core tools':    ['node','npm','npx','git'],
    'Java':          ['java','mvn','gradle'],
    'Python':        ['python','pip'],
    'Mobile':        ['flutter','dart'],
    'Go':            ['go'],
    'DevOps':        ['docker'],
    'Editors':       ['code','cursor'],
  };

  let totalOk = 0;
  let totalMissing = 0;

  for (const [cat, keys] of Object.entries(categories)) {
    logger.detail(cat);
    for (const key of keys) {
      const info = results[key];
      if (info) {
        logger.depRow(info.label, info.installed, info.version, info.install);
        if (info.installed) totalOk++;
        else totalMissing++;
      }
    }
    logger.blank();
  }

  // ── PIC config ───────────────────────────────────────────────────────────
  const cwd = process.cwd();
  const picConfig = path.join(cwd, '.pic', 'config.json');
  if (fs.existsSync(picConfig)) {
    try {
      const config = fs.readJSONSync(picConfig);
      logger.detail('PIC config found');
      logger.label('  Project',  config.name || '-');
      logger.label('  Stack',    config.stackId || '-');
      logger.label('  Template', config.template || '-');
      logger.blank();
    } catch {}
  }

  // ── Node version warning ─────────────────────────────────────────────────
  const nodeVersion = results['node'];
  if (nodeVersion?.installed) {
    const major = parseInt(nodeVersion.version?.split('.')[0] || '0', 10);
    if (major < 16) {
      logger.warn(`Node.js v${nodeVersion.version} is below the required v16. Please upgrade.`);
      logger.blank();
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  logger.divider();
  logger.blank();
  if (totalMissing === 0) {
    logger.success(`All ${totalOk} tools found`);
  } else {
    logger.info(`${totalOk} installed, ${totalMissing} not found`);
    logger.detail('Missing tools are only required for their specific stacks.');
    logger.detail('Run: pic check <stack-id>  to check a specific stack.');
  }
  logger.blank();
}

module.exports = { doctorCommand };
