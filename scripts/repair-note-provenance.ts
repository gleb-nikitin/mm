#!/usr/bin/env bun

import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

type CsvRow = {
  note_id: number;
  project: string;
  source_chunk_id: number;
  external_id: string;
  segment_start: number | null;
  segment_end: number | null;
  filter_version: number | null;
};

type Repair = {
  noteId: number;
  sourceChunkId: number;
  sourceEventId: number;
  externalId: string;
  segmentStart: number;
  segmentEnd: number;
  filterVersion: number | null;
  spanHash: string;
  disposition: 'same_offset' | 'relocated';
};

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

function integer(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

const backupPath = option('--backup-db');
const csvPath = option('--csv');
const apply = process.argv.includes('--apply');
const brainRoot = process.env.MT_BRAIN_ROOT || process.cwd();
const dbPath = option('--db') || path.join(brainRoot, 'meta', 'brain.db');

if (!backupPath || !csvPath) {
  console.error('Usage: bun scripts/repair-note-provenance.ts --backup-db <brain.db> --csv <provenance.csv> [--db <live.db>] [--apply]');
  process.exit(2);
}
for (const required of [dbPath, backupPath, csvPath]) {
  if (!fs.existsSync(required)) {
    console.error(`Missing required file: ${required}`);
    process.exit(2);
  }
}

const lines = fs.readFileSync(csvPath, 'utf8').trimEnd().split(/\r?\n/);
const header = parseCsvLine(lines.shift() || '');
const indexes = new Map(header.map((name, index) => [name, index]));
for (const required of ['note_id', 'project', 'source_chunk_id', 'external_id', 'segment_start', 'segment_end', 'filter_version']) {
  if (!indexes.has(required)) throw new Error(`CSV is missing required column ${required}`);
}
const value = (fields: string[], name: string) => fields[indexes.get(name)!] || '';
const csvRows: CsvRow[] = lines.filter(Boolean).map(line => {
  const fields = parseCsvLine(line);
  const noteId = integer(value(fields, 'note_id'));
  const sourceChunkId = integer(value(fields, 'source_chunk_id'));
  if (noteId === null || sourceChunkId === null) throw new Error(`CSV has invalid note/chunk id: ${line}`);
  return {
    note_id: noteId,
    project: value(fields, 'project'),
    source_chunk_id: sourceChunkId,
    external_id: value(fields, 'external_id'),
    segment_start: integer(value(fields, 'segment_start')),
    segment_end: integer(value(fields, 'segment_end')),
    filter_version: integer(value(fields, 'filter_version')),
  };
});

const live = apply ? new Database(dbPath) : new Database(dbPath, { readonly: true });
const backup = new Database(backupPath, { readonly: true });
const liveNote = live.prepare('SELECT id, project, source_chunk_id FROM notes WHERE id = ?');
const liveEvent = live.prepare('SELECT id, content FROM raw_events WHERE external_id = ?');
const backupEvent = backup.prepare('SELECT content FROM raw_events WHERE external_id = ?');
const repairs: Repair[] = [];
const unresolved: Array<{ note_id: number; reason: string }> = [];

for (const row of csvRows) {
  const note = liveNote.get(row.note_id) as any;
  if (!note || note.project !== row.project || note.source_chunk_id !== row.source_chunk_id) {
    unresolved.push({ note_id: row.note_id, reason: 'note_identity_mismatch' });
    continue;
  }
  if (!row.external_id || row.segment_start === null || row.segment_end === null) {
    unresolved.push({ note_id: row.note_id, reason: 'backup_coordinates_missing' });
    continue;
  }
  const oldEvent = backupEvent.get(row.external_id) as { content: string } | undefined;
  const currentEvent = liveEvent.get(row.external_id) as { id: number; content: string } | undefined;
  if (!oldEvent) {
    unresolved.push({ note_id: row.note_id, reason: 'backup_event_missing' });
    continue;
  }
  if (!currentEvent) {
    unresolved.push({ note_id: row.note_id, reason: 'current_event_missing' });
    continue;
  }
  if (row.segment_start < 0 || row.segment_end <= row.segment_start || row.segment_end > oldEvent.content.length) {
    unresolved.push({ note_id: row.note_id, reason: 'backup_span_invalid' });
    continue;
  }

  const oldSpan = oldEvent.content.slice(row.segment_start, row.segment_end);
  let segmentStart = row.segment_start;
  let disposition: Repair['disposition'] = 'same_offset';
  if (currentEvent.content.slice(row.segment_start, row.segment_end) !== oldSpan) {
    const first = currentEvent.content.indexOf(oldSpan);
    const last = currentEvent.content.lastIndexOf(oldSpan);
    if (first < 0) {
      unresolved.push({ note_id: row.note_id, reason: 'span_not_found' });
      continue;
    }
    if (first !== last) {
      unresolved.push({ note_id: row.note_id, reason: 'span_ambiguous' });
      continue;
    }
    segmentStart = first;
    disposition = 'relocated';
  }
  repairs.push({
    noteId: row.note_id,
    sourceChunkId: row.source_chunk_id,
    sourceEventId: currentEvent.id,
    externalId: row.external_id,
    segmentStart,
    segmentEnd: segmentStart + oldSpan.length,
    filterVersion: row.filter_version,
    spanHash: hash(oldSpan),
    disposition,
  });
}

if (apply) {
  const columns = new Set((live.prepare('PRAGMA table_info(notes)').all() as Array<{ name: string }>).map(row => row.name));
  for (const required of [
    'source_event_id', 'source_external_id', 'source_segment_start', 'source_segment_end',
    'source_filter_version', 'source_span_hash',
  ]) {
    if (!columns.has(required)) throw new Error(`Live DB is not migrated to notes provenance v16: missing ${required}`);
  }
  const update = live.prepare(
    `UPDATE notes
     SET source_event_id = ?, source_external_id = ?,
         source_segment_start = ?, source_segment_end = ?,
         source_filter_version = ?, source_span_hash = ?
     WHERE id = ? AND source_chunk_id = ?`
  );
  const verifyEvent = live.prepare('SELECT content FROM raw_events WHERE id = ? AND external_id = ?');
  const applyRepairs = live.transaction(() => {
    for (const repair of repairs) {
      const event = verifyEvent.get(repair.sourceEventId, repair.externalId) as { content: string } | undefined;
      const currentSpan = event?.content.slice(repair.segmentStart, repair.segmentEnd);
      if (!event || hash(currentSpan || '') !== repair.spanHash) {
        throw new Error(`Source event changed during repair for note ${repair.noteId}`);
      }
      const result = update.run(
        repair.sourceEventId,
        repair.externalId,
        repair.segmentStart,
        repair.segmentEnd,
        repair.filterVersion,
        repair.spanHash,
        repair.noteId,
        repair.sourceChunkId,
      );
      if (result.changes !== 1) throw new Error(`Note ${repair.noteId} changed during repair`);
    }
  });
  applyRepairs.immediate();
}

const unresolvedByReason: Record<string, number> = {};
for (const row of unresolved) unresolvedByReason[row.reason] = (unresolvedByReason[row.reason] || 0) + 1;
const noteCount = (live.prepare('SELECT COUNT(*) AS count FROM notes').get() as any).count as number;
console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  db: dbPath,
  backup_db: backupPath,
  csv: csvPath,
  notes: noteCount,
  csv_rows: csvRows.length,
  notes_without_csv: Math.max(0, noteCount - csvRows.length),
  resolved: repairs.length,
  same_offset: repairs.filter(row => row.disposition === 'same_offset').length,
  relocated: repairs.filter(row => row.disposition === 'relocated').length,
  unresolved: unresolved.length,
  unresolved_by_reason: unresolvedByReason,
  unresolved_rows: unresolved,
}, null, 2));

backup.close();
live.close();
