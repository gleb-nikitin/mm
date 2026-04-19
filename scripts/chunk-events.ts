#!/usr/bin/env bun
//
// scripts/chunk-events.ts — Narrative Chunker.
//
// Bridges `raw_events` (DB, streaming) and `raw_entries` (disk, durable).
//
// For every row in `raw_events` where `chunked = 0` AND `processed = 0`,
// split the session content at turn boundaries ("User:" / "A:" / "Assistant:")
// into ~12KB chunks and write them to
// `raw/events/<project>/<timestamp>-<idprefix>[-NNofMM].md`.
//
// Each chunk file has provenance frontmatter pointing back to the originating
// event (external_id). Once a row is chunked, set `chunked = 1` so the next
// pass is idempotent. The librarian consumes the resulting raw/ files through
// the existing `brain index rebuild` → `raw_entries` pipeline.
//
// Usage:
//   bun scripts/chunk-events.ts                    # all projects, unchunked + unprocessed
//   bun scripts/chunk-events.ts --project mm       # scope to one project
//   bun scripts/chunk-events.ts --dry-run          # preview, don't write
//   bun scripts/chunk-events.ts --rechunk          # ignore the `chunked` flag
//   bun scripts/chunk-events.ts --include-processed
//                                                  # chunk rows that were already
//                                                  # wiki-ingested via `ingest-event`
//                                                  # (useful for evaluating the new
//                                                  # chunker against historical data)

import * as fs from 'fs';
import * as path from 'path';
import { db, PATHS, initDb } from '../src/core.ts';

initDb();

const args = process.argv.slice(2);
const projectArg = (() => {
  const i = args.findIndex(a => a === '--project' || a === '-p');
  return i >= 0 ? args[i + 1] : null;
})();
const dryRun = args.includes('--dry-run');
const rechunk = args.includes('--rechunk');
const includeProcessed = args.includes('--include-processed');

const TARGET_CHUNK = 12_000; // soft target: once we pass this at a turn boundary, close.
const MAX_CHUNK = 18_000;    // hard ceiling: never exceed this.

type EventRow = {
  id: number;
  external_id: string | null;
  source_type: string;
  project: string;
  timestamp: string;
  content: string;
  title: string | null;
};

function fetchRows(project: string | null, rechunk: boolean, includeProcessed: boolean): EventRow[] {
  let sql = `SELECT id, external_id, source_type, project, timestamp, content, title
             FROM raw_events
             WHERE 1 = 1`;
  const params: any[] = [];
  if (!includeProcessed) sql += ` AND processed = 0`;
  if (!rechunk) sql += ` AND chunked = 0`;
  if (project) { sql += ` AND project = ?`; params.push(project); }
  sql += ` ORDER BY project, timestamp, id`;
  return db.prepare(sql).all(...params) as EventRow[];
}

// Split content into turn-bounded segments. A turn starts with a line matching
// the role markers used by the importers. Content before the first marker (rare,
// usually empty) becomes a leading segment of its own.
function splitOnTurns(content: string): string[] {
  const roleRe = /^(User|A|Assistant|Human):\s*/;
  const lines = content.split('\n');
  const segments: string[] = [];
  let cur: string[] = [];
  for (const line of lines) {
    if (roleRe.test(line) && cur.length > 0) {
      segments.push(cur.join('\n').replace(/\n+$/, ''));
      cur = [line];
    } else {
      cur.push(line);
    }
  }
  if (cur.length > 0) segments.push(cur.join('\n').replace(/\n+$/, ''));
  return segments.filter(s => s.length > 0);
}

// A single turn can exceed MAX_CHUNK (log pastes, giant tool output). Split
// oversized turns first on paragraph boundaries, then on line boundaries, then
// as a last resort, hard cuts. Preserves ordering; marks non-head pieces with
// `[cont.]` so the reader knows the break is mechanical.
function subsplitOversized(seg: string, limit: number): string[] {
  if (seg.length <= limit) return [seg];
  const out: string[] = [];

  const push = (piece: string, isHead: boolean) => {
    out.push(isHead ? piece : `[cont.] ${piece}`);
  };

  const greedyJoin = (parts: string[], joiner: string, isHead: boolean): boolean => {
    let cur = '';
    let head = isHead;
    for (const p of parts) {
      if (p.length > limit) return false; // individual piece too big for this granularity
      const candidate = cur ? cur + joiner + p : p;
      if ((head ? candidate.length : candidate.length + 8) > limit) {
        push(cur, head); head = false; cur = p;
      } else {
        cur = candidate;
      }
    }
    if (cur) push(cur, head);
    return true;
  };

  const paras = seg.split(/\n\n+/);
  if (paras.length > 1 && greedyJoin(paras, '\n\n', true)) return out;

  out.length = 0;
  const lines = seg.split('\n');
  if (lines.length > 1 && greedyJoin(lines, '\n', true)) return out;

  out.length = 0;
  let head = true;
  for (let i = 0; i < seg.length; i += limit - (head ? 0 : 8)) {
    push(seg.slice(i, i + limit - (head ? 0 : 8)), head);
    head = false;
  }
  return out;
}

// Greedy group of segments into chunks. Never split a segment (turn).
// Close a chunk when the running length exceeds TARGET_CHUNK, unless the
// next segment would overflow MAX_CHUNK alone (in which case the oversized
// segment becomes its own chunk).
function groupIntoChunks(segments: string[]): string[][] {
  const chunks: string[][] = [];
  let cur: string[] = [];
  let curLen = 0;
  for (const seg of segments) {
    const segLen = seg.length + 2; // +2 for the "\n\n" separator we'll use on join
    if (cur.length > 0 && curLen + segLen > MAX_CHUNK) {
      chunks.push(cur);
      cur = [];
      curLen = 0;
    }
    cur.push(seg);
    curLen += segLen;
    if (curLen >= TARGET_CHUNK) {
      chunks.push(cur);
      cur = [];
      curLen = 0;
    }
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

function timestampSlug(iso: string): string {
  // "2026-04-17T21:35:18.141Z" → "2026-04-17T21-35-18-141Z"
  return iso.replace(/[:.]/g, '-');
}

function idPrefix(externalId: string | null): string {
  if (!externalId) return 'no-id';
  const head = externalId.split('-')[0] || externalId;
  return head.slice(0, 8);
}

function renderChunk(row: EventRow, chunkSegs: string[], index: number, total: number): string {
  const title = `Session ${row.external_id ?? row.id} (${index}/${total})`;
  const body = chunkSegs.join('\n\n');
  return [
    '---',
    `title: "${title}"`,
    `source_type: events`,
    `project: ${row.project}`,
    `event_external_id: ${row.external_id ?? ''}`,
    `event_db_id: ${row.id}`,
    `event_source_type: ${row.source_type}`,
    `event_timestamp: ${row.timestamp}`,
    `chunk_index: ${index}`,
    `chunk_total: ${total}`,
    '---',
    '',
    `# ${title}`,
    '',
    body,
    '',
    '---',
    '',
    '## Provenance',
    '',
    `- event:${row.external_id ?? row.id} (chunk ${index} of ${total})`,
    `- source_type: ${row.source_type}`,
    `- timestamp: ${row.timestamp}`,
    '',
  ].join('\n');
}

const rows = fetchRows(projectArg, rechunk, includeProcessed);
if (rows.length === 0) {
  console.log(`Chunker: nothing to do (project=${projectArg ?? 'all'}, rechunk=${rechunk}, include-processed=${includeProcessed}).`);
  process.exit(0);
}

const markChunked = db.prepare(`UPDATE raw_events SET chunked = 1 WHERE id = ?`);

let eventsProcessed = 0;
let chunksWritten = 0;
let filesSkipped = 0;

const tx = db.transaction(() => {
  for (const row of rows) {
    const rawSegments = splitOnTurns(row.content);
    if (rawSegments.length === 0) { continue; }

    const segments: string[] = [];
    for (const seg of rawSegments) {
      if (seg.length <= MAX_CHUNK) segments.push(seg);
      else segments.push(...subsplitOversized(seg, MAX_CHUNK));
    }

    const chunks = row.content.length <= MAX_CHUNK
      ? [segments]
      : groupIntoChunks(segments);

    const outDir = path.join(PATHS.raw, 'events', row.project);
    if (!dryRun) fs.mkdirSync(outDir, { recursive: true });

    const tsSlug = timestampSlug(row.timestamp);
    const idp = idPrefix(row.external_id);
    const total = chunks.length;

    for (let i = 0; i < chunks.length; i++) {
      const partSuffix = total > 1
        ? `-${String(i + 1).padStart(2, '0')}of${String(total).padStart(2, '0')}`
        : '';
      const fname = `${tsSlug}-${idp}${partSuffix}.md`;
      const fpath = path.join(outDir, fname);

      if (fs.existsSync(fpath) && !rechunk) {
        filesSkipped++;
        continue;
      }

      const content = renderChunk(row, chunks[i], i + 1, total);
      if (dryRun) {
        console.log(`[dry-run] would write ${path.relative(PATHS.raw, fpath)} (${content.length} chars)`);
      } else {
        fs.writeFileSync(fpath, content);
      }
      chunksWritten++;
    }

    if (!dryRun) markChunked.run(row.id);
    eventsProcessed++;
  }
});

tx();

console.log(`✅ Chunker: ${eventsProcessed} events → ${chunksWritten} chunks written${filesSkipped ? `, ${filesSkipped} existing skipped` : ''}${dryRun ? ' (dry-run)' : ''}.`);
