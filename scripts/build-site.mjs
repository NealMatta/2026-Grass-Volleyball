#!/usr/bin/env node
/**
 * Assembles dist/ — the only directory that gets published.
 *
 * This is an allowlist, not an exclude list, and that's deliberate. The repo
 * contains data/raw/signups.csv with every player's phone number and email.
 * .gitignore protects the git history, but a direct `netlify deploy --dir .`
 * would happily upload it. Copying named files into a clean dist/ means the
 * raw data cannot reach the public site even by accident.
 *
 * Run: node scripts/build-site.mjs
 */

import { cpSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

// Explicit allowlist. Adding a file to the site means adding it here.
const INCLUDE = [
  'index.html',
  'css',
  'js',
  'data/teams.json',
  'data/schedule.json',
];

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'data'), { recursive: true });

for (const rel of INCLUDE) {
  const from = join(root, rel);
  if (!existsSync(from)) {
    console.error(`  ✗ missing: ${rel}`);
    process.exit(1);
  }
  cpSync(from, join(dist, rel), { recursive: true });
}

// Belt and braces: fail loudly if anything sensitive slipped through.
const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const files = walk(dist);
const forbidden = files.filter((f) => /\/raw\/|\.csv$|\.env/.test(f));
if (forbidden.length) {
  console.error('  ✗ refusing to publish:', forbidden);
  process.exit(1);
}

console.log(`  ✓ dist/ built — ${files.length} files`);
for (const f of files) console.log(`     ${f.replace(dist + '/', '')}`);
