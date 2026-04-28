'use strict';

/**
 * autoInstall.js
 * 
 * When a required tool is missing, offer to install it automatically
 * using the platform's package manager (winget / brew / apt).
 * 
 * After installing, re-checks the binary. If still not in PATH (common
 * on Windows where a new terminal session is needed), tells the user
 * exactly what to do and exits cleanly.
 */

const { execSync } = require('child_process');
const logger  = require('../utils/cli/logger');
const { confirm } = require('../utils/cli/prompts');
const { checkTool, checkPython } = require('../utils/system/detector');
const { runSafe, isWin } = require('./runCommand');

// ── Install commands per OS per tool key ──────────────────────────────────────
const INSTALL_CMDS = {
  win32: {
    node:    'winget install OpenJS.NodeJS.LTS',
    git:     'winget install Git.Git',
    python:  'winget install Python.Python.3',
    go:      'winget install GoLang.Go',
    java:    'winget install EclipseAdoptium.Temurin.21.JDK',
    mvn:     'winget install Apache.Maven',
    gradle:  'winget install Gradle.Gradle',
    flutter: 'winget install Google.Flutter',
    docker:  'winget install Docker.DockerDesktop',
  },
  darwin: {
    node:    'brew install node@20',
    git:     'brew install git',
    python:  'brew install python@3',
    go:      'brew install go',
    java:    'brew install --cask temurin@21',
    mvn:     'brew install maven',
    gradle:  'brew install gradle',
    flutter: 'brew install --cask flutter',
    docker:  'brew install --cask docker',
  },
  linux: {
    node:    'curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs',
    git:     'sudo apt-get install -y git',
    python:  'sudo apt-get install -y python3 python3-pip python3-venv',
    go:      'sudo snap install go --classic',
    java:    'sudo apt-get install -y default-jdk',
    mvn:     'sudo apt-get install -y maven',
    gradle:  'sudo snap install gradle --classic',
    flutter: 'sudo snap install flutter --classic',
    docker:  'curl -fsSL https://get.docker.com | sh',
  },
};

function getOS() {
  if (isWin) return 'win32';
  if (process.platform === 'darwin') return 'darwin';
  return 'linux';
}

function getInstallCmd(toolKey) {
  return INSTALL_CMDS[getOS()]?.[toolKey] || null;
}

// ── Check whether winget / brew / apt is available ────────────────────────────
function hasPackageManager() {
  const os = getOS();
  if (os === 'win32')   return runSafe('winget --version 2>&1').ok;
  if (os === 'darwin')  return runSafe('brew --version 2>&1').ok;
  return runSafe('apt-get --version 2>&1').ok || runSafe('snap --version 2>&1').ok;
}

// ── Re-verify a tool after install ───────────────────────────────────────────
function recheck(toolKey) {
  // python has special multi-binary check
  if (toolKey === 'python') {
    const r = checkPython();
    return r.installed;
  }
  return checkTool(toolKey).installed;
}

/**
 * For each missing tool:
 *   1. Show the install command for this OS
 *   2. Ask "Install now?" 
 *   3. Run it, re-verify
 *   4. If still missing → warn about PATH refresh, exit
 *
 * Returns true  if all tools are now available (or user skipped and wants to continue)
 * Returns false if user declined everything and wants to abort
 */
async function handleMissingTools(missing) {
  const os = getOS();
  const hasPkgMgr = hasPackageManager();

  logger.blank();

  for (const tool of missing) {
    const installCmd = getInstallCmd(tool.key);

    logger.warn(`${tool.label} is not installed.`);

    if (!hasPkgMgr) {
      // No package manager — just show the URL
      logger.detail(`Install manually: ${tool.install}`);
      logger.blank();
      continue;
    }

    if (!installCmd) {
      logger.detail(`Install manually: ${tool.install}`);
      logger.blank();
      continue;
    }

    // Show what we'll run
    logger.detail(`Install command (${os === 'win32' ? 'winget' : os === 'darwin' ? 'brew' : 'apt/snap'}):`);
    logger.cmd(installCmd);
    logger.blank();

    const doInstall = await confirm(`Install ${tool.label} now?`, true);
    if (!doInstall) {
      logger.detail(`Skipped. Install manually: ${tool.install}`);
      logger.blank();
      continue;
    }

    // ── Run the installer ────────────────────────────────────────────────────
    logger.blank();
    logger.info(`Installing ${tool.label}...`);
    logger.blank();

    try {
      execSync(installCmd, {
        stdio: 'inherit',   // show install output live
        shell: true,
        windowsHide: false, // winget may open its own window
      });
    } catch (err) {
      logger.blank();
      logger.warn(`Installer exited with an error. It may have partially succeeded.`);
    }

    logger.blank();

    // ── Re-check ─────────────────────────────────────────────────────────────
    if (recheck(tool.key)) {
      logger.success(`${tool.label} installed and detected`);
      logger.blank();
    } else {
      // Installed but not in PATH yet — very common on Windows
      logger.warn(`${tool.label} was installed but is not yet in PATH.`);
      if (isWin) {
        logger.detail('Windows requires a new terminal session after installation.');
        logger.detail('Please close this window, open a new terminal, and run:');
        logger.blank();
        logger.cmd(`pic create --stack ${tool.key} (or your original command)`);
      } else {
        logger.detail('Try running this in your terminal, then re-run pic:');
        logger.blank();
        // For brew on macOS, the binary may need a shell reload
        if (process.platform === 'darwin') {
          logger.cmd('eval "$(/opt/homebrew/bin/brew shellenv)"');
        }
        logger.cmd(`export PATH="$PATH:$(${tool.key === 'go' ? '/usr/local/go/bin' : '/usr/bin'})"  # adjust path`);
      }
      logger.blank();
      logger.info('Exiting. Re-run pic after updating your PATH.');
      logger.blank();
      process.exit(0);
    }
  }

  return true;
}

module.exports = { handleMissingTools, getInstallCmd, getOS };
