#!/usr/bin/env bun
/**
 * reset-brain.ts — wipe all brain content, keep code and config.
 *
 * Clears:
 *   raw/**          (all source files and chunks)
 *   wiki/*.md       (all wiki pages)
 *   wiki/*.canvas   (canvas files)
 *   meta/brain.db*  (SQLite database)
 *   meta/log.md, index.md, timeline.md, *-report.md
 *
 * Preserves:
 *   meta/schema.md, meta/skills/**, meta/remaining-gaps.md
 *   wiki/.obsidian/**
 *   all source code, scripts, agent docs
 */

import * as fs from 'fs';
import * as path from 'path';

const BRAIN_ROOT = process.env.MT_BRAIN_ROOT || process.cwd();

const RAW_DIR  = path.join(BRAIN_ROOT, 'raw');
const WIKI_DIR = path.join(BRAIN_ROOT, 'wiki');
const META_DIR = path.join(BRAIN_ROOT, 'meta');

let deleted = 0;

function rm(filePath: string) {
  try {
    fs.unlinkSync(filePath);
    deleted++;
  } catch {}
}

function rmAllFiles(dir: string, opts: { keepDotFiles?: boolean } = {}) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rmAllFiles(full, opts);
      try { fs.rmdirSync(full); } catch {}
    } else {
      if (opts.keepDotFiles && entry.name.startsWith('.')) continue;
      rm(full);
    }
  }
}

// 1. raw/ — everything
console.log('Clearing raw/...');
rmAllFiles(RAW_DIR);

// 2. wiki/ — .md and .canvas files only, preserve .obsidian/
console.log('Clearing wiki/*.md and wiki/*.canvas...');
if (fs.existsSync(WIKI_DIR)) {
  for (const entry of fs.readdirSync(WIKI_DIR, { withFileTypes: true })) {
    if (entry.isDirectory()) continue; // skip .obsidian/ and any subdirs
    if (entry.name.endsWith('.md') || entry.name.endsWith('.canvas')) {
      rm(path.join(WIKI_DIR, entry.name));
    }
  }
}

// 3. meta/brain.db*
console.log('Clearing meta/brain.db...');
for (const f of ['brain.db', 'brain.db-shm', 'brain.db-wal']) {
  rm(path.join(META_DIR, f));
}

// 4. meta generated reports and logs
console.log('Clearing meta reports and logs...');
if (fs.existsSync(META_DIR)) {
  for (const entry of fs.readdirSync(META_DIR, { withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    const n = entry.name;
    if (
      n === 'log.md' ||
      n === 'index.md' ||
      n === 'timeline.md' ||
      n === 'RELAUNCH_NEEDED' ||
      n.endsWith('-report.md')
    ) {
      rm(path.join(META_DIR, n));
    }
  }
}

// 5. Recreate empty raw/ subdirs so importers don't choke
for (const sub of ['claude', 'codex', 'gemini', 'docs', 'research', 'knowledge', 'events']) {
  fs.mkdirSync(path.join(RAW_DIR, sub), { recursive: true });
}

console.log(`\nDone. ${deleted} files removed. Brain is empty and ready.`);
