'use strict';
/**
 * Tiny .env loader (no npm dependency). Reads KEY=VALUE lines from a .env
 * file in the project root and applies them to process.env, without
 * overwriting variables that are already set in the real environment.
 */

const fs = require('fs');
const path = require('path');

function loadEnv(envPath = path.join(__dirname, '..', '..', '.env')) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

module.exports = { loadEnv };
