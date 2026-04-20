#!/usr/bin/env bun
//
// scripts/chunk-events.ts — Narrative chunker (v11: DB-only emission).
//
// For every row in `raw_events` where `chunked = 0` AND `processed = 0`,
// split the session content at turn boundaries into ~12KB windows. Each
// window becomes one row in `chunks_virtual` carrying raw char offsets into
// `raw_events.content`. No files are written to `raw/events/`.
//
// Reading back: `brain chunk read <id>` slices raw content and re-applies
// `filterMechanical` at the current FILTER_VERSION.
//
// Usage:
//   bun scripts/chunk-events.ts
//   bun scripts/chunk-events.ts --project mm
//   bun scripts/chunk-events.ts --dry-run
//   bun scripts/chunk-events.ts --rechunk              # clear old chunks_virtual, re-emit
//   bun scripts/chunk-events.ts --include-processed    # chunk rows already wiki-ingested

import { db, initDb, insertChunkVirtual } from '../src/core.ts';

initDb();

const args = process.argv.slice(2);
const projectArg = (() => {
  const i = args.findIndex(a => a === '--project' || a === '-p');
  return i >= 0 ? args[i + 1] : null;
})();
const dryRun = args.includes('--dry-run');
const rechunk = args.includes('--rechunk');
const includeProcessed = args.includes('--include-processed');

const TARGET_CHUNK = 12_000;
const MAX_CHUNK = 18_000;

type EventRow = {
  id: number;
  external_id: string | null;
  source_type: string;
  project: string;
  timestamp: string;
  content: string;
};

function fetchRows(project: string | null, rechunk: boolean, includeProcessed: boolean): EventRow[] {
  let sql = `SELECT id, external_id, source_type, project, timestamp, content
             FROM raw_events
             WHERE 1 = 1`;
  const params: any[] = [];
  if (!includeProcessed) sql += ` AND processed = 0`;
  if (!rechunk) sql += ` AND chunked = 0`;
  if (project) { sql += ` AND project = ?`; params.push(project); }
  sql += ` ORDER BY project, timestamp, id`;
  return db.prepare(sql).all(...params) as EventRow[];
}

type Span = { start: number; end: number };

// Turn-aware segmentation that preserves raw offsets. A turn starts with a
// line matching the role markers emitted by the importers. The span ends
// immediately before the next role marker (or at EOF).
function splitOnTurnsWithOffsets(content: string): Span[] {
  const roleRe = /^(User|A|Assistant|Human):\s*/;
  const lines = content.split('\n');
  const segments: Span[] = [];

  let cursor = 0;
  let currentStart: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = cursor;
    const lineEnd = cursor + line.length;
    // Advance cursor for the next iteration (include the '\n' except on last line).
    cursor = lineEnd + (i < lines.length - 1 ? 1 : 0);

    if (roleRe.test(line)) {
      if (currentStart !== null) {
        segments.push({ start: currentStart, end: lineStart > currentStart ? lineStart - 1 : currentStart });
      }
      currentStart = lineStart;
    } else if (currentStart === null) {
      // Leading prose before any role marker — start a segment.
      currentStart = lineStart;
    }
  }

  if (currentStart !== null && currentStart < content.length) {
    segments.push({ start: currentStart, end: content.length });
  }

  return segments.filter(s => s.end > s.start);
}

// Oversized segment: split into sub-spans each ≤ limit, covering [seg.start, seg.end]
// contiguously with no overlaps. Prefer paragraph boundaries, then line boundaries,
// then hard cuts.
function subsplitOversized(seg: Span, content: string, limit: number): Span[] {
  if (seg.end - seg.start <= limit) return [seg];

  // Collect candidate break offsets (absolute, into `content`). Always include
  // seg.end as the final break so the loop closes cleanly.
  const text = content.slice(seg.start, seg.end);
  const collect = (rx: RegExp, takeEnd: boolean): number[] => {
    const out: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      out.push(seg.start + (takeEnd ? m.index + m[0].length : m.index));
      if (m.index === rx.lastIndex) rx.lastIndex++;
    }
    return out;
  };

  const trySplit = (breaks: number[]): Span[] | null => {
    const spans: Span[] = [];
    let start = seg.start;
    while (start < seg.end) {
      const remaining = seg.end - start;
      if (remaining <= limit) {
        spans.push({ start, end: seg.end });
        break;
      }
      // Largest break strictly greater than start and <= start + limit.
      let pick = -1;
      for (const b of breaks) {
        if (b > start && b - start <= limit) pick = b;
        else if (b - start > limit) break;
      }
      if (pick <= start) return null;
      spans.push({ start, end: pick });
      start = pick;
    }
    return spans.length > 0 ? spans : null;
  };

  const paraBreaks = collect(/\n\n+/g, true);
  const paraAttempt = paraBreaks.length > 0 ? trySplit(paraBreaks) : null;
  if (paraAttempt) return paraAttempt;

  const lineBreaks = collect(/\n/g, true);
  const lineAttempt = lineBreaks.length > 0 ? trySplit(lineBreaks) : null;
  if (lineAttempt) return lineAttempt;

  // Hard cuts
  const out: Span[] = [];
  let start = seg.start;
  while (start < seg.end) {
    const end = Math.min(start + limit, seg.end);
    out.push({ start, end });
    start = end;
  }
  return out;
}

// Greedy group of segments into chunks. Never splits a segment.
function groupIntoChunks(segments: Span[]): Span[][] {
  const chunks: Span[][] = [];
  let cur: Span[] = [];
  let curLen = 0;
  for (const seg of segments) {
    const segLen = seg.end - seg.start + 2; // +2 for join gap
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

const rows = fetchRows(projectArg, rechunk, includeProcessed);
if (rows.length === 0) {
  console.log(`Chunker: nothing to do (project=${projectArg ?? 'all'}, rechunk=${rechunk}, include-processed=${includeProcessed}).`);
  process.exit(0);
}

const markChunked = db.prepare(`UPDATE raw_events SET chunked = 1 WHERE id = ?`);
const clearExistingChunks = db.prepare(`DELETE FROM chunks_virtual WHERE source_event_id = ?`);

let eventsProcessed = 0;
let chunksWritten = 0;

const tx = db.transaction(() => {
  for (const row of rows) {
    const rawSegments = splitOnTurnsWithOffsets(row.content);
    if (rawSegments.length === 0) continue;

    const segments: Span[] = [];
    for (const seg of rawSegments) {
      const len = seg.end - seg.start;
      if (len <= MAX_CHUNK) segments.push(seg);
      else segments.push(...subsplitOversized(seg, row.content, MAX_CHUNK));
    }

    const groups = groupIntoChunks(segments);
    const total = groups.length;

    if (rechunk && !dryRun) clearExistingChunks.run(row.id);

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const segmentStart = group[0].start;
      const segmentEnd = group[group.length - 1].end;
      if (dryRun) {
        console.log(`[dry-run] event ${row.id} chunk ${i + 1}/${total} span=[${segmentStart}, ${segmentEnd}] (${segmentEnd - segmentStart} chars)`);
      } else {
        insertChunkVirtual({
          project: row.project,
          source_event_id: row.id,
          chunk_index: i + 1,
          chunk_total: total,
          segment_start: segmentStart,
          segment_end: segmentEnd,
        });
      }
      chunksWritten++;
    }

    if (!dryRun) markChunked.run(row.id);
    eventsProcessed++;
  }
});

tx();

console.log(`✅ Chunker: ${eventsProcessed} events → ${chunksWritten} chunks_virtual rows${dryRun ? ' (dry-run)' : ''}.`);
