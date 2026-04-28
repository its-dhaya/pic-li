'use strict';

const { runSafe } = require('../../core/runCommand');

const TOOLS = {
  node:    { label: 'Node.js',     cmd: 'node --version',    install: 'https://nodejs.org',                           category: 'Core'   },
  npm:     { label: 'npm',         cmd: 'npm --version',     install: 'https://nodejs.org',                           category: 'Core'   },
  npx:     { label: 'npx',         cmd: 'npx --version',     install: 'https://nodejs.org',                           category: 'Core'   },
  git:     { label: 'Git',         cmd: 'git --version',     install: 'https://git-scm.com',                          category: 'Core'   },
  java:    { label: 'Java JDK',    cmd: 'java -version',     install: 'https://adoptium.net',                         category: 'Java'   },
  mvn:     { label: 'Maven',       cmd: 'mvn -version',      install: 'https://maven.apache.org/install.html',        category: 'Java'   },
  gradle:  { label: 'Gradle',      cmd: 'gradle -version',   install: 'https://gradle.org/install',                   category: 'Java'   },
  // python and pip use custom multi-binary detection — see checkTool()
  python:  { label: 'Python 3',    cmd: null,                install: 'https://python.org',                           category: 'Python' },
  pip:     { label: 'pip',         cmd: null,                install: 'https://pip.pypa.io',                          category: 'Python' },
  flutter: { label: 'Flutter SDK', cmd: 'flutter --version', install: 'https://flutter.dev/docs/get-started/install', category: 'Mobile' },
  dart:    { label: 'Dart SDK',    cmd: 'dart --version',    install: 'https://dart.dev/get-dart',                    category: 'Mobile' },
  go:      { label: 'Go',          cmd: 'go version',        install: 'https://go.dev/dl',                            category: 'Go'     },
  docker:  { label: 'Docker',      cmd: 'docker --version',  install: 'https://docs.docker.com/get-docker',           category: 'DevOps' },
  code:    { label: 'VS Code',     cmd: 'code --version',    install: 'https://code.visualstudio.com',                category: 'Editor' },
  cursor:  { label: 'Cursor',      cmd: 'cursor --version',  install: 'https://cursor.sh',                            category: 'Editor' },
};

// ── Python: try python3 then python — must be v3 ─────────────────────────────
function checkPython() {
  for (const bin of ['python3', 'python']) {
    const { ok, output } = runSafe(`${bin} --version 2>&1`);
    if (!ok) continue;
    // Must contain "Python 3" — rules out Python 2
    const match = output.match(/Python\s+(\d+)\.(\d+)/i);
    if (match && parseInt(match[1], 10) >= 3) {
      return { installed: true, version: `${match[1]}.${match[2]}`, binary: bin };
    }
  }
  return { installed: false, version: null, binary: null };
}

// ── pip: try pip3 then pip ────────────────────────────────────────────────────
function checkPip() {
  for (const bin of ['pip3', 'pip']) {
    const { ok, output } = runSafe(`${bin} --version 2>&1`);
    if (!ok) continue;
    const version = output.match(/(\d+\.\d+[\.\d]*)/)?.[1] || 'installed';
    return { installed: true, version, binary: bin };
  }
  return { installed: false, version: null, binary: null };
}

function checkTool(key) {
  const tool = TOOLS[key];
  if (!tool) return { installed: false, version: null };

  // Custom multi-binary checks
  if (key === 'python') return checkPython();
  if (key === 'pip')    return checkPip();

  // java -version writes to stderr — redirect with 2>&1
  const cmd = key === 'java' ? tool.cmd + ' 2>&1' : tool.cmd + ' 2>&1';
  const { ok, output } = runSafe(cmd);
  if (!ok) return { installed: false, version: null };
  const version = output.match(/(\d+\.\d+[\.\d]*)/)?.[1] || 'installed';
  return { installed: true, version };
}

function checkTools(keys) {
  const results = {};
  for (const key of keys) {
    results[key] = { ...TOOLS[key], ...checkTool(key) };
  }
  return results;
}

function getMissing(results) {
  return Object.entries(results)
    .filter(([, info]) => !info.installed)
    .map(([key, info]) => ({ key, ...info }));
}

module.exports = { TOOLS, checkTool, checkTools, checkPython, checkPip, getMissing };
