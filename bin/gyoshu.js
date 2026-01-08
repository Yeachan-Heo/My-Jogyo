#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const HOME = process.env.HOME || '';
const OPENCODE_CONFIG_DIR = join(HOME, '.config', 'opencode');
const OPENCODE_CONFIG_FILE = join(OPENCODE_CONFIG_DIR, 'opencode.json');
const LEGACY_HOME_CONFIG = join(HOME, 'opencode.json');

function findOpencodeConfig() {
  if (existsSync(OPENCODE_CONFIG_FILE)) {
    return OPENCODE_CONFIG_FILE;
  }
  if (existsSync(LEGACY_HOME_CONFIG)) {
    return LEGACY_HOME_CONFIG;
  }
  return null;
}

function readConfig(configPath) {
  try {
    const content = readFileSync(configPath, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    return null;
  }
}

function writeConfig(configPath, config) {
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

function install() {
  let configPath = findOpencodeConfig();
  let config;
  
  if (configPath) {
    config = readConfig(configPath);
    if (!config) {
      console.error(`Error: Could not parse ${configPath}`);
      process.exit(1);
    }
  } else {
    configPath = OPENCODE_CONFIG_FILE;
    config = {};
    console.log(`Creating ${configPath}...`);
  }
  
  if (!Array.isArray(config.plugin)) {
    config.plugin = [];
  }
  
  if (config.plugin.includes('gyoshu')) {
    console.log('Gyoshu is already installed in ' + configPath);
    return;
  }
  
  config.plugin.push('gyoshu');
  writeConfig(configPath, config);
  
  console.log('Gyoshu installed successfully!');
  console.log(`Updated: ${configPath}`);
  console.log('\nNext steps:');
  console.log('  1. Start OpenCode: opencode');
  console.log('  2. Run: /gyoshu doctor');
}

function uninstall() {
  const configPath = findOpencodeConfig();
  
  if (!configPath) {
    console.log('No opencode.json found. Nothing to uninstall.');
    return;
  }
  
  const config = readConfig(configPath);
  if (!config) {
    console.error(`Error: Could not parse ${configPath}`);
    process.exit(1);
  }
  
  if (!Array.isArray(config.plugin) || !config.plugin.includes('gyoshu')) {
    console.log('Gyoshu is not installed.');
    return;
  }
  
  config.plugin = config.plugin.filter(p => p !== 'gyoshu');
  writeConfig(configPath, config);
  
  console.log('Gyoshu uninstalled successfully!');
  console.log(`Updated: ${configPath}`);
}

function check() {
  const configPath = findOpencodeConfig();
  
  if (!configPath) {
    console.log('Status: NOT INSTALLED');
    console.log('No opencode.json found.');
    console.log(`Expected: ${OPENCODE_CONFIG_FILE}`);
    console.log('\nTo install: bunx gyoshu install');
    return;
  }
  
  const config = readConfig(configPath);
  if (!config) {
    console.log('Status: ERROR');
    console.log(`Could not parse ${configPath}`);
    return;
  }
  
  const isInstalled = Array.isArray(config.plugin) && config.plugin.includes('gyoshu');
  
  if (isInstalled) {
    console.log('Status: INSTALLED');
    console.log(`Config: ${configPath}`);
    console.log('\nTo verify in OpenCode: /gyoshu doctor');
  } else {
    console.log('Status: NOT INSTALLED');
    console.log(`Config exists: ${configPath}`);
    console.log('\nTo install: bunx gyoshu install');
  }
}

function showHelp() {
  console.log(`
Gyoshu - Scientific Research Agent for OpenCode

Usage:
  gyoshu install     Add gyoshu to opencode.json
  gyoshu uninstall   Remove gyoshu from opencode.json  
  gyoshu check       Verify installation status
  gyoshu help        Show this help message

Config location: ~/.config/opencode/opencode.json

Examples:
  bunx gyoshu install
  npx gyoshu check

More info: https://github.com/Yeachan-Heo/My-Jogyo
`);
}

const command = process.argv[2];

switch (command) {
  case 'install':
    install();
    break;
  case 'uninstall':
    uninstall();
    break;
  case 'check':
    check();
    break;
  case 'help':
  case '--help':
  case '-h':
    showHelp();
    break;
  default:
    if (command) {
      console.error(`Unknown command: ${command}\n`);
    }
    showHelp();
    process.exit(command ? 1 : 0);
}
