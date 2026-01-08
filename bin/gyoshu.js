#!/usr/bin/env node

/**
 * Gyoshu CLI - Install/uninstall helper for OpenCode
 * 
 * Usage:
 *   bunx gyoshu install   - Add gyoshu to opencode.json
 *   bunx gyoshu uninstall - Remove gyoshu from opencode.json
 *   bunx gyoshu check     - Verify installation status
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const OPENCODE_CONFIG = 'opencode.json';

function findOpencodeConfig() {
  // Check current directory
  if (existsSync(OPENCODE_CONFIG)) {
    return OPENCODE_CONFIG;
  }
  // Check home directory
  const homeConfig = join(process.env.HOME || '', OPENCODE_CONFIG);
  if (existsSync(homeConfig)) {
    return homeConfig;
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
    // Create new config in current directory
    configPath = OPENCODE_CONFIG;
    config = {};
    console.log(`Creating new ${OPENCODE_CONFIG}...`);
  }
  
  // Ensure plugin array exists
  if (!Array.isArray(config.plugin)) {
    config.plugin = [];
  }
  
  // Check if already installed
  if (config.plugin.includes('gyoshu')) {
    console.log('Gyoshu is already installed in ' + configPath);
    return;
  }
  
  // Add gyoshu
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
  
  // Remove gyoshu
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

Examples:
  bunx gyoshu install
  npx gyoshu check

More info: https://github.com/Yeachan-Heo/My-Jogyo
`);
}

// Main
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
