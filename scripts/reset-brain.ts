#!/usr/bin/env bun
/**
 * reset-brain.ts — wipe brain state. Two modes.
 *
 * Default (no flag): artifacts wipe.
 *   Deletes: artifacts + artifact_sources + artifacts_fts rows.
 *   Resets: chunks_virtual.processed = 0.
 *   Keeps:  raw_events, chunks_virtual rows, raw/ files, wiki/ files, brain.db.
 *   Use:    iterate on the ingest skill, rerun librarian on the same chunks.
 *
 * --full: nuclear wipe. Original aggressive behavior.
 *   Deletes: raw/**, wiki/*.md + wiki/*.canvas, meta/brain.db*, meta reports.
 *   Keeps:   meta/schema.md, meta/skills/**, agent/, source code, wiki/.obsidian/.
 *   Use:    truly fresh state. Importers must re-run to repopulate raw_events.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Database } from 'bun:sqlite';

const BRAIN_ROOT = process.env.MT_BRAIN_ROOT || process.cwd();
const args = process.argv.slice(2);
const isFullWipe = args.includes('--full') || args.includes('--nuclear');

const RAW_DIR  = path.join(BRAIN_ROOT, 'raw');
const WIKI_DIR = path.join(BRAIN_ROOT, 'wiki');
const META_DIR = path.join(BRAIN_ROOT, 'meta');

if (isFullWipe) {
  nuclearWipe();
} else {
  artifactsWipe();
}

function artifactsWipe() {
  console.log('Artifacts wipe (safe default). Keeps raw_events, chunks, files.');
  console.log('For nuclear wipe (raw/ + wiki/ + DB), re-run with --full.\n');

  const DB_PATH = path.join(META_DIR, 'brain.db');
  if (!fs.existsSync(DB_PATH)) {
    console.log('No brain.db present; nothing to wipe.');
    return;
  }

  const db = new Database(DB_PATH);
  try {
    db.run('PRAGMA foreign_keys = ON');
    const artifactCount = (db.prepare('SELECT COUNT(*) as c FROM artifacts').get() as any)?.c ?? 0;
    const chunkCount    = (db.prepare('SELECT COUNT(*) as c FROM chunks_virtual').get() as any)?.c ?? 0;

    db.transaction(() => {
      db.run('DELETE FROM artifacts');
      db.run('DELETE FROM artifact_sources');
      try { db.run('DELETE FROM artifacts_fts'); } catch {}
      db.run('UPDATE chunks_virtual SET processed = 0');
    })();

    console.log(`Cleared ${artifactCount} artifacts.`);
    console.log(`Reset ${chunkCount} chunks_virtual rows to processed=0.`);
    console.log('\nDone. Brain is ready for librarian rerun.');
  } finally {
    db.close();
  }
}

function nuclearWipe() {
  console.log('*** NUCLEAR WIPE *** — deletes raw/, wiki/ markdown, and DB.\n');

  let deleted = 0;

  function rm(filePath: string) {
    try {
      fs.unlinkSync(filePath);
      deleted++;
    } catch {}
  }

  function rmAllFiles(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        rmAllFiles(full);
        try { fs.rmdirSync(full); } catch {}
      } else {
        rm(full);
      }
    }
  }

  console.log('Clearing raw/...');
  rmAllFiles(RAW_DIR);

  console.log('Clearing wiki/*.md and wiki/*.canvas...');
  if (fs.existsSync(WIKI_DIR)) {
    for (const entry of fs.readdirSync(WIKI_DIR, { withFileTypes: true })) {
      if (entry.isDirectory()) continue; // skip .obsidian/ and any subdirs
      if (entry.name.endsWith('.md') || entry.name.endsWith('.canvas')) {
        rm(path.join(WIKI_DIR, entry.name));
      }
    }
  }

  console.log('Clearing meta/brain.db...');
  for (const f of ['brain.db', 'brain.db-shm', 'brain.db-wal']) {
    rm(path.join(META_DIR, f));
  }

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

  // Recreate empty raw/ subdirs so importers don't choke
  for (const sub of ['claude', 'codex', 'gemini', 'docs', 'research', 'knowledge', 'events']) {
    fs.mkdirSync(path.join(RAW_DIR, sub), { recursive: true });
  }

  console.log(`\nDone. ${deleted} files removed. Brain is empty and ready.`);
}
