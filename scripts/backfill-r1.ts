import { initDb, db } from '../src/core.ts';
import { recordSessionObservation } from '../src/r1/session-index.ts';
import type { Vendor } from '../src/r1/types.ts';

type RawEventRow = {
  id: number;
  project: string;
  external_id: string;
  timestamp: string;
  content: string;
  metadata: string | null;
};

type ImportStateRow = {
  source_path: string;
  last_mtime: number;
  provider: string | null;
  external_id: string | null;
  project: string | null;
  cwd: string | null;
  model: string | null;
  last_user_snippet: string | null;
};

function isVendor(value: unknown): value is Vendor {
  return value === 'claude' || value === 'codex' || value === 'gemini';
}

function parseMetadata(raw: string | null): { value: Record<string, unknown>; malformed: boolean } {
  if (!raw) return { value: {}, malformed: false };
  try {
    const parsed = JSON.parse(raw);
    return {
      value: parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {},
      malformed: false,
    };
  } catch {
    return { value: {}, malformed: true };
  }
}

function stripVendorPrefix(externalId: string): { vendor: Vendor | null; sessionId: string } {
  const idx = externalId.indexOf(':');
  if (idx <= 0) return { vendor: null, sessionId: externalId };
  const maybeVendor = externalId.slice(0, idx);
  return {
    vendor: isVendor(maybeVendor) ? maybeVendor : null,
    sessionId: externalId.slice(idx + 1),
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function importStateFor(sourcePath: string | null, sessionId: string | null): ImportStateRow | null {
  if (sourcePath && sessionId) {
    const row = db.prepare(
      `SELECT * FROM import_state WHERE source_path = ? OR external_id = ? LIMIT 1`
    ).get(sourcePath, sessionId) as ImportStateRow | undefined;
    return row ?? null;
  }
  if (sourcePath) {
    const row = db.prepare(
      `SELECT * FROM import_state WHERE source_path = ? LIMIT 1`
    ).get(sourcePath) as ImportStateRow | undefined;
    return row ?? null;
  }
  if (sessionId) {
    const row = db.prepare(
      `SELECT * FROM import_state WHERE external_id = ? LIMIT 1`
    ).get(sessionId) as ImportStateRow | undefined;
    return row ?? null;
  }
  return null;
}

function syncEventFtsExternalId(oldExternalId: string, newExternalId: string): void {
  try {
    db.prepare(`UPDATE events_fts SET external_id = ? WHERE external_id = ?`).run(newExternalId, oldExternalId);
  } catch {
    // events_fts is best-effort here; initDb recreates it and search rebuild can
    // repopulate it if a damaged legacy DB is missing the virtual table.
  }
}

function migrateRawEventExternalId(row: RawEventRow, vendor: Vendor, sessionId: string): number {
  const targetExternalId = `${vendor}:${sessionId}`;
  if (row.external_id === targetExternalId) return row.id;

  const existing = db.prepare(
    `SELECT id FROM raw_events WHERE external_id = ?`
  ).get(targetExternalId) as { id: number } | undefined;

  if (!existing) {
    db.prepare(`UPDATE raw_events SET external_id = ? WHERE id = ?`).run(targetExternalId, row.id);
    syncEventFtsExternalId(row.external_id, targetExternalId);
    return row.id;
  }

  if (existing.id === row.id) return row.id;

  // Collision means an importer already created the new namespaced row after
  // upgrade. Keep that canonical row, move durable provenance to it, and remove
  // the stale unprefixed row so future search/import sees one session.
  db.prepare(
    `INSERT OR IGNORE INTO claim_sources_event (claim_id, event_id)
     SELECT claim_id, ? FROM claim_sources_event WHERE event_id = ?`
  ).run(existing.id, row.id);
  db.prepare(`DELETE FROM claim_sources_event WHERE event_id = ?`).run(row.id);
  db.prepare(`UPDATE artifact_sources SET source_event_id = ? WHERE source_event_id = ?`).run(existing.id, row.id);
  db.prepare(`DELETE FROM chunks_virtual WHERE source_event_id = ?`).run(row.id);
  try { db.prepare(`DELETE FROM events_fts WHERE external_id = ?`).run(row.external_id); } catch {}
  db.prepare(`DELETE FROM raw_events WHERE id = ?`).run(row.id);
  return existing.id;
}

initDb();

const rows = db.prepare(
  `SELECT id, project, external_id, timestamp, content, metadata
   FROM raw_events
   WHERE source_type = 'llm_chat'
   ORDER BY id`
).all() as RawEventRow[];

let backfilled = 0;
let skipped = 0;
let malformed = 0;
let migrated_external_ids = 0;
let merged_collisions = 0;

for (const row of rows) {
  const parsed = parseMetadata(row.metadata);
  if (parsed.malformed) malformed++;
  const meta = parsed.value;
  const prefixed = stripVendorPrefix(row.external_id);
  const sessionId = stringValue(meta.session_id) ?? stringValue(meta.external_id) ?? prefixed.sessionId;
  const state = importStateFor(stringValue(meta.source_path), sessionId);
  const vendorRaw = stringValue(meta.provider) ?? state?.provider ?? prefixed.vendor;
  if (!isVendor(vendorRaw) || !sessionId) {
    skipped++;
    continue;
  }
  const targetExternalId = `${vendorRaw}:${sessionId}`;
  const hadPrefix = row.external_id === targetExternalId;
  const collision = !hadPrefix && !!db.prepare(
    `SELECT id FROM raw_events WHERE external_id = ? AND id != ?`
  ).get(targetExternalId, row.id);
  const rawEventId = migrateRawEventExternalId(row, vendorRaw, sessionId);
  if (!hadPrefix) migrated_external_ids++;
  if (collision) merged_collisions++;

  const sourcePath = stringValue(meta.source_path) ?? state?.source_path ?? `raw_event:${row.id}`;
  const started = stringValue(meta.started) ?? row.timestamp;
  const ended = stringValue(meta.ended) ?? started;
  const project = stringValue(meta.project) ?? state?.project ?? row.project;
  const cwd = stringValue(meta.cwd) ?? state?.cwd ?? null;
  const model = stringValue(meta.model) ?? state?.model ?? null;
  const metadata = parsed.malformed
    ? JSON.stringify({ backfill_error: 'metadata_parse_error', original_external_id: row.external_id })
    : row.metadata;

  recordSessionObservation({
    vendor: vendorRaw,
    session_id: sessionId,
    source_path: sourcePath,
    raw_event_id: rawEventId,
    project,
    cwd,
    model,
    started_at: started || null,
    last_activity_at: ended || started || row.timestamp || new Date().toISOString(),
    last_mtime: state?.last_mtime ?? 0,
    last_log_line: state?.last_user_snippet ?? null,
    state: parsed.malformed ? 'orphan' : undefined,
    orphan_reason: parsed.malformed ? 'metadata_parse_error' : null,
    metadata,
  }, row.content);
  backfilled++;
}

const sessionIndexCount = (db.prepare(`SELECT COUNT(*) AS c FROM session_index`).get() as { c: number }).c;
const linkCount = (db.prepare(`SELECT COUNT(*) AS c FROM session_message_links`).get() as { c: number }).c;

console.log(JSON.stringify({
  raw_events_scanned: rows.length,
  session_index_rows: sessionIndexCount,
  message_link_rows: linkCount,
  backfilled,
  skipped,
  malformed_metadata: malformed,
  migrated_external_ids,
  merged_collisions,
}, null, 2));
