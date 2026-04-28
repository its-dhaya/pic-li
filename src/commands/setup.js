'use strict';

const { execSync } = require('child_process');
const logger = require('../utils/cli/logger');
const { checkTool } = require('../utils/system/detector');
const { select } = require('../utils/cli/prompts');

const SETUPS = {
  'Node.js LTS': {
    check: 'node',
    win:   'winget install OpenJS.NodeJS.LTS',
    mac:   'brew install node@20',
    linux: 'curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs',
  },
  'Git': {
    check: 'git',
    win:   'winget install Git.Git',
    mac:   'brew install git',
    linux: 'sudo apt-get install -y git',
  },
  'Java 21 (Temurin)': {
    check: 'java',
    win:   'winget install EclipseAdoptium.Temurin.21.JDK',
    mac:   'brew install --cask temurin@21',
    linux: 'sudo apt-get install -y temurin-21-jdk',
  },
  'Maven': {
    check: 'mvn',
    win:   'winget install Apache.Maven',
    mac:   'brew install maven',
    linux: 'sudo apt-get install -y maven',
  },
  'Python 3': {
    check: 'python',
    win:   'winget install Python.Python.3',
    mac:   'brew install python@3',
    linux: 'sudo apt-get install -y python3 python3-pip',
  },
  'Go': {
    check: 'go',
    win:   'winget install GoLang.Go',
    mac:   'brew install go',
    linux: 'sudo snap install go --classic',
  },
  'Docker': {
    check: 'docker',
    win:   'winget install Docker.DockerDesktop',
    mac:   'brew install --cask docker',
    linux: 'curl -fsSL https://get.docker.com | sh',
  },
};

async function setupCommand(opts) {
  logger.brand();
  logger.section('Setup guide');
  logger.blank();
  logger.info('This command shows you how to install tools for your OS.');
  logger.info('Commands are shown — you run them in your own terminal.');
  logger.blank();

  const platform = process.platform === 'win32' ? 'Windows'
    : process.platform === 'darwin' ? 'macOS' : 'Linux';

  logger.label('Platform', platform);
  logger.blank();

  const choices = Object.keys(SETUPS).map(k => ({ title: k, value: k }));
  choices.push({ title: 'Show all', value: '__all__' });

  const pick = await select('Which tool do you need?', choices);
  if (!pick) return;

  logger.blank();

  const items = pick === '__all__' ? Object.entries(SETUPS) : [[pick, SETUPS[pick]]];

  for (const [name, info] of items) {
    const installed = checkTool(info.check);
    if (installed.installed) {
      logger.label(name, `already installed  v${installed.version}`, null);
      continue;
    }
    logger.detail(name);
    if (platform === 'Windows') {
      logger.cmd(info.win);
    } else if (platform === 'macOS') {
      logger.cmd(info.mac);
    } else {
      logger.cmd(info.linux);
    }
    logger.blank();
  }

  if (platform === 'macOS') {
    logger.blank();
    logger.detail('Homebrew not installed?  Run:');
    logger.cmd('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
  }
  if (platform === 'Linux') {
    logger.blank();
    logger.detail('For Java Temurin on Ubuntu add the repo first:');
    logger.cmd('sudo apt-get install -y wget apt-transport-https');
    logger.cmd('wget -O - https://packages.adoptium.net/artifactory/api/gpg/key/public | sudo apt-key add -');
  }

  logger.blank();
}

module.exports = { setupCommand };
