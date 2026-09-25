import * as fs from 'fs';
import * as path from 'path';
import {
  initDb, hybridSearch, getStats, queryBrain, validateClaim, addToBrain, PATHS,
  renderActiveAgentsMarkdown, getActiveAgentsWithStatus, listArtifacts, queueChunks, readChunk, db,
  searchArtifacts, listNotes, getNote, searchNotes, getBrief, renderBrief,
} from './core.ts';
import { getActiveAgentsLiveWithStatus } from './session-probe.ts';
import { filterMechanical } from './narrative.ts';
import { apiError, handleActiveSessions, handleActiveTokens, handleCostByMessage, handleCostBySession, handleSessionContent, handleSessionEvents, handleSessions, handleTokensByParticipant } from './r1/api.ts';

// Ensure DB is ready on fresh roots
initDb();

const UI_DIR = path.resolve(new URL('../ui', import.meta.url).pathname);
const PLUGIN_SOCKET = process.env.AURORA_PLUGIN_SOCKET?.trim() || null;
const BASE_PATH = PLUGIN_SOCKET ? '/plugin/mm' : '';
const uiHref = (href: string) => BASE_PATH + href;

// --- Shared human-page nav (single source of truth). Pages opt in by
// including the `<!--NAV-->` placeholder; serveUiFile substitutes it.
const NAV_LINKS: { label: string; href: string }[] = [
  { label: 'home',      href: uiHref('/') },
  { label: 'artifacts', href: uiHref('/artifacts-ui') },
  { label: 'notes',     href: uiHref('/notes-ui') },
  { label: 'chunks',    href: uiHref('/chunks-ui') },
  { label: 'raw',       href: uiHref('/raw-ui') },
  { label: 'active',    href: uiHref('/active-ui') },
  { label: 'monitor',   href: uiHref('/monitor') },
  { label: 'sessions',  href: uiHref('/sessions') },
  { label: 'stats',     href: uiHref('/stats') },
];

const NAV_HTML = (() => {
  const links = NAV_LINKS.map(l => `<a href="${l.href}" data-nav-href="${l.href}">${l.label}</a>`).join('');
  const css = `
  .mm-nav { display: flex; gap: 12px; padding: 8px 12px; margin: 0 auto 12px; max-width: 1100px;
    font-family: 'Monaco', 'Menlo', 'Consolas', monospace; font-size: 11px;
    background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);
    border-radius: 6px; align-items: center; flex-wrap: wrap; box-sizing: border-box; }
  .mm-nav a { color: #7ec8e3; text-decoration: none; text-transform: uppercase;
    letter-spacing: 0.12em; padding: 2px 6px; border-radius: 3px; font-weight: 600; }
  .mm-nav a:hover { background: rgba(126,200,227,0.12); }
  .mm-nav a.active { color: #b794f6; }
  `;
  return `<style>${css}</style><script>window.MM_BASE = ${JSON.stringify(BASE_PATH)};</script><nav class="mm-nav" data-mm-nav>${links}</nav>` +
    `<script>(function(){var p=location.pathname;document.querySelectorAll('[data-mm-nav] a').forEach(function(a){var h=a.getAttribute('data-nav-href');if(h===p||(h.length>1&&p===h)){a.classList.add('active');}});})();</script>`;
})();

const HELP_MD = `# Brain API v0.9.0 (v16 schema)

Endpoints:
- \`/\`: Web UI (aurora theme).
- \`/help\`: This markdown endpoint list.
- \`/active?max_age_seconds=N\`: List currently-active agent sessions (Claude, Codex, Gemini).
- \`/api/v1/sessions/active?project=&role=&state=&limit=\`: JSON session tracker view over session_index.
- \`/api/v1/sessions?vendor=&participant_id=&project=&state=&since=&until=&offset=&limit=&sort=\`: JSON sessions browser over session_index joined with session_usage.
- \`/api/v1/sessions/:vendor/:session_id/content?offset=&limit=\`: JSON session content browser over imported raw_events.
- \`/api/v1/sessions/events?since_id=&project=&role=\`: SSE stream over session_events.
- \`/api/v1/cost/by-session?session_id=&vendor=\`: JSON token and cost attribution for one session.
- \`/api/v1/cost/by-message?chain_msg_id=\`: JSON token and cost attribution via message linkage.
- \`/api/v1/tokens/by-participant?participant_id=&since=&until=&window=&vendor=\`: JSON token totals by participant; omit participant_id for all participants.
- \`/api/v1/tokens/active?project=&role=&state=&vendor=\`: JSON list of active sessions with latest-turn context-window fill (ac-style) plus cumulative cost. Default state filter: working/idle/wedged. Drives relaunch decisions.
- \`/brief?project=<slug>\`: CTO session-start preamble — artifacts, active agents, health (markdown).
- \`/query?q=<question>[&source=a,b&project=x,y]\`: Ask a synthesis question, optionally scoped.
- \`/validate?q=<claim>\`: Fact-check a specific claim.
- \`/wiki/:slug\`: Read a specific wiki page.
- \`/stats\`: High-level brain statistics (includes v11 artifact + chunk counts).
- \`/search?q=<query>[&source=a,b&project=x,y]\`: Hybrid search, optionally scoped.
- \`/add\`: POST { content, title, source_type?, project? } or GET ?c=...&t=...&source=...&project=...
- \`/artifacts?project=&type=&status=&limit=\`: JSON list of artifacts (status default: active; 'all' to disable).
- \`/notes?project=&limit=&offset=&source_chunk_id=\`: JSON list of distilled notes.
- \`/note/:id\`: JSON — one distilled note with full artifacts payload.
- \`/notes-search?q=&project=&limit=&offset=\`: FTS over distilled notes.
- \`/chunks?project=&limit=\`: JSON list of pending chunks_virtual.
- \`/chunk/:id\`: JSON — reconstructed chunk content + metadata.
- \`/artifact/:id\`: JSON — artifact row + enriched sources (each with reconstructed text span).
- \`/artifacts-search?q=&project=&type=&status=&limit=\`: FTS over artifact data, returns rows + snippet (status default: active).
- \`/artifacts-ui\`: Artifacts browser UI.
- \`/notes-ui\`: Distilled notes browser UI.
- \`/chunks-ui\`: Chunks browser UI.
- \`/raw-ui\`: Plain HTML dump of every table. No filters, no JS.
- \`/monitor\`: R1 JSON/SSE monitor index.
- \`/sessions\`: Browse all imported sessions and open session transcripts.

Scoping params:
- \`source\`: comma-separated source_types (claude, telegram, chains, docs, research, knowledge, note).
- \`project\`: comma-separated project slugs (mm, ac, ...).
Source filters select raw/event types plus the special \`wiki\` and \`note\` sources. Project filters apply to raw, event, and note results; compiled wiki pages remain global.
`;

function parseSearchOpts(url: URL) {
  const splitCsv = (s: string | null) => s ? s.split(',').map(x => x.trim()).filter(Boolean) : [];
  return {
    sourceTypes: splitCsv(url.searchParams.get("source")),
    projects:    splitCsv(url.searchParams.get("project")),
  };
}

async function serveUiFile(relPath: string): Promise<Response> {
  const absPath = path.resolve(UI_DIR, '.' + relPath);
  if (!absPath.startsWith(UI_DIR)) return new Response("Forbidden", { status: 403 });
  const file = Bun.file(absPath);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  // Only HTML gets the nav injection; pass other assets through verbatim.
  if (!relPath.endsWith('.html')) return new Response(file);
  const text = await file.text();
  let html = text.replaceAll('<!--BASE-->', BASE_PATH);
  html = html.includes('<!--NAV-->') ? html.replace('<!--NAV-->', NAV_HTML) : html;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

const PORT = parseInt(process.env.MT_PORT || '3000', 10);
// Default to localhost-only. /raw-ui, /chunk/:id, /artifact/:id, and /active
// expose raw transcript data; exposing them on a public interface would leak
// real conversations. Set MT_BIND=0.0.0.0 explicitly to override — you'll get
// a startup warning so it's not accidental.
const HOST = process.env.MT_BIND || '127.0.0.1';
if (!PLUGIN_SOCKET && HOST !== '127.0.0.1' && HOST !== 'localhost') {
  console.warn(`⚠️  MT_BIND=${HOST}: API is reachable beyond localhost. Raw transcripts are exposed without auth — only do this on a trusted network.`);
}

function preparePluginSocket(socketPath: string): void {
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
  try {
    const existing = fs.lstatSync(socketPath);
    if (!existing.isSocket()) {
      throw new Error(`AURORA_PLUGIN_SOCKET path exists and is not a socket: ${socketPath}`);
    }
    fs.unlinkSync(socketPath);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

if (PLUGIN_SOCKET) preparePluginSocket(PLUGIN_SOCKET);

const serveOptions = {
  idleTimeout: 180,
  async fetch(req: Request) {
    const url = new URL(req.url);

    if (url.pathname === "/") {
      return serveUiFile("/index.html");
    }
    if (url.pathname === "/active-ui") {
      return serveUiFile("/active.html");
    }
    if (url.pathname === "/sessions") {
      return serveUiFile("/sessions.html");
    }
    if (/^\/sessions\/[^/]+\/.+/.test(url.pathname)) {
      return serveUiFile("/session-detail.html");
    }
    if (url.pathname === "/monitor") {
      return serveUiFile("/monitor-index.html");
    }
    if (url.pathname === "/monitor/sessions/active") {
      return serveUiFile("/monitor-sessions-active.html");
    }
    if (url.pathname === "/monitor/cost/by-session") {
      return serveUiFile("/monitor-cost-by-session.html");
    }
    if (url.pathname === "/monitor/cost/by-message") {
      return serveUiFile("/monitor-cost-by-message.html");
    }
    if (url.pathname === "/monitor/tokens/by-participant") {
      return serveUiFile("/monitor-tokens-by-participant.html");
    }
    if (url.pathname === "/monitor/tokens/active") {
      return serveUiFile("/monitor-tokens-active.html");
    }
    if (url.pathname === "/monitor/sessions/events") {
      return serveUiFile("/monitor-sessions-events.html");
    }
    if (url.pathname.startsWith("/ui/")) {
      return serveUiFile(url.pathname.replace(/^\/ui/, ""));
    }
    if (url.pathname === "/help") {
      return new Response(HELP_MD, { headers: { "Content-Type": "text/markdown" } });
    }

    if (url.pathname === "/api/v1/sessions/active") {
      return handleActiveSessions(url);
    }
    if (url.pathname === "/api/v1/sessions") {
      return handleSessions(url);
    }
    {
      const match = /^\/api\/v1\/sessions\/([^/]+)\/(.+)\/content$/.exec(url.pathname);
      if (match) return handleSessionContent(decodeURIComponent(match[1]), match[2], url);
    }
    if (url.pathname === "/api/v1/sessions/events") {
      return handleSessionEvents(req, url);
    }
    if (url.pathname === "/api/v1/cost/by-session") {
      return handleCostBySession(url);
    }
    if (url.pathname === "/api/v1/cost/by-message") {
      return handleCostByMessage(url);
    }
    if (url.pathname === "/api/v1/tokens/by-participant") {
      return handleTokensByParticipant(url);
    }
    if (url.pathname === "/api/v1/tokens/active") {
      return handleActiveTokens(url);
    }

    if (url.pathname.startsWith("/api/v1/")) {
      return apiError("not_found", "Unknown API route", { path: url.pathname }, 404);
    }

    if (url.pathname === "/active") {
      const maxAge = parseInt(url.searchParams.get("max_age_seconds") || "300", 10);
      const live = url.searchParams.get("probe") === "live";
      const wantJson = url.searchParams.get("format") === "json";
      const { agents, acDbStatus } = live
        ? getActiveAgentsLiveWithStatus({ maxAgeSeconds: maxAge })
        : getActiveAgentsWithStatus({ maxAgeSeconds: maxAge });
      const headers = {
        "Content-Type": wantJson ? "application/json" : "text/markdown",
        "X-MM-AC-DB-Status": acDbStatus.status,
      };
      if (wantJson) {
        const body = JSON.stringify({ agents, generated_at: new Date().toISOString(), ac_db: acDbStatus });
        return new Response(body, { headers });
      }
      return new Response(renderActiveAgentsMarkdown(agents, maxAge, acDbStatus), { headers });
    }

    if (url.pathname === "/brief") {
      const project = url.searchParams.get("project");
      if (!project) return new Response("Missing 'project' parameter", { status: 400 });
      const md = renderBrief(getBrief(project));
      return new Response(md, { headers: { "Content-Type": "text/markdown" } });
    }

    if (url.pathname === "/query") {
      const q = url.searchParams.get("q") || "";
      if (!q) return new Response("Missing 'q' parameter", { status: 400 });
      const res = await queryBrain(q, parseSearchOpts(url));
      return new Response(res.stdout || res.stderr, { headers: { "Content-Type": "text/markdown" } });
    }

    if (url.pathname === "/validate") {
      const q = url.searchParams.get("q") || "";
      if (!q) return new Response("Missing 'q' parameter", { status: 400 });
      const res = await validateClaim(q);
      return new Response(res.stdout || res.stderr, { headers: { "Content-Type": "text/markdown" } });
    }

    if (url.pathname === "/stats") {
      const stats = getStats();
      const artifactsTotal = (db.prepare('SELECT COUNT(*) as c FROM artifacts').get() as any).c;
      const artifactsActive = (db.prepare("SELECT COUNT(*) as c FROM artifacts WHERE status = 'active'").get() as any).c;
      const artifactsByType = db.prepare("SELECT type, COUNT(*) as c FROM artifacts WHERE status = 'active' GROUP BY type ORDER BY c DESC").all() as any[];
      const chunksTotal = (db.prepare('SELECT COUNT(*) as c FROM chunks_virtual').get() as any).c;
      const chunksPending = (db.prepare('SELECT COUNT(*) as c FROM chunks_virtual WHERE processed = 0').get() as any).c;
      let md = "# Brain Stats\n\n";
      md += `- Schema Version: ${stats.version}\n`;
      md += `- Pages: ${stats.pages}\n`;
      md += `- Raw Entries: ${stats.raws}\n`;
      md += `- Links: ${stats.links}\n`;
      md += `- Claims: ${stats.claims}\n`;
      md += `- Embedded Chunks: ${stats.embeddedChunks} / ${stats.totalChunks}\n`;
      md += `- Avg Sources/Page: ${stats.avgSource}\n`;
      md += `\n## v11\n\n`;
      md += `- Artifacts (active / total): ${artifactsActive} / ${artifactsTotal}\n`;
      md += `- Chunks (pending / total): ${chunksPending} / ${chunksTotal}\n`;
      if (artifactsByType.length > 0) {
        md += `\n### Active artifacts by type\n\n`;
        for (const r of artifactsByType) md += `- ${r.type}: ${r.c}\n`;
      }
      return new Response(md, { headers: { "Content-Type": "text/markdown" } });
    }

    if (url.pathname === "/artifacts-search") {
      const q = url.searchParams.get("q") || "";
      if (!q) return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } });
      const results = searchArtifacts(q, {
        project: url.searchParams.get("project") || null,
        type:    url.searchParams.get("type") || null,
        status:  url.searchParams.get("status") || "active",
        limit:   parseInt(url.searchParams.get("limit") || "50", 10),
      });
      return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
    }

    if (url.pathname === "/artifacts") {
      const project = url.searchParams.get("project");
      const type    = url.searchParams.get("type");
      const status  = url.searchParams.get("status") || "active";
      const limit   = parseInt(url.searchParams.get("limit") || "500", 10);
      const rows = listArtifacts({
        project: project || null,
        type: type || null,
        status: status === "all" ? null : status,
        limit,
      });
      // Attach source counts for each artifact (cheap: one query per page load, not per row).
      const srcMap = new Map<number, number>();
      if (rows.length > 0) {
        const ids = rows.map(r => r.id);
        const placeholders = ids.map(() => '?').join(',');
        const sources = db.prepare(`SELECT artifact_id, COUNT(*) as c FROM artifact_sources WHERE artifact_id IN (${placeholders}) GROUP BY artifact_id`).all(...ids) as any[];
        for (const s of sources) srcMap.set(s.artifact_id, s.c);
      }
      const enriched = rows.map(r => ({ ...r, source_count: srcMap.get(r.id) || 0 }));
      return new Response(JSON.stringify(enriched), { headers: { "Content-Type": "application/json" } });
    }

    if (url.pathname === "/notes-search") {
      const q = url.searchParams.get("q") || "";
      if (!q) return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } });
      const results = searchNotes(q, {
        project: url.searchParams.get("project") || null,
        limit:   parseInt(url.searchParams.get("limit") || "50", 10),
        offset:  parseInt(url.searchParams.get("offset") || "0", 10),
      });
      return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
    }

    if (url.pathname === "/notes") {
      const sourceChunkParam = url.searchParams.get("source_chunk_id");
      const sourceChunkId = sourceChunkParam ? parseInt(sourceChunkParam, 10) : null;
      if (sourceChunkParam && (!sourceChunkId || sourceChunkId <= 0)) {
        return new Response("Bad source_chunk_id", { status: 400 });
      }
      const rows = listNotes({
        project: url.searchParams.get("project") || null,
        source_chunk_id: sourceChunkId,
        limit:  parseInt(url.searchParams.get("limit") || "50", 10),
        offset: parseInt(url.searchParams.get("offset") || "0", 10),
      });
      return new Response(JSON.stringify(rows), { headers: { "Content-Type": "application/json" } });
    }

    if (url.pathname === "/chunks") {
      const project = url.searchParams.get("project");
      const processed = url.searchParams.get("processed"); // 'pending' | 'processed' | 'all' | null
      const limit = parseInt(url.searchParams.get("limit") || "500", 10);
      const clauses: string[] = [];
      const params: any[] = [];
      if (project) { clauses.push('cv.project = ?'); params.push(project); }
      if (processed === 'pending' || !processed) clauses.push('cv.processed = 0');
      else if (processed === 'processed') clauses.push('cv.processed = 1');
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = db.prepare(
        `SELECT cv.id, cv.project, cv.source_event_id, cv.chunk_index, cv.chunk_total,
                cv.segment_start, cv.segment_end, cv.filter_version, cv.processed, cv.created_at,
                re.external_id, re.source_type, re.timestamp as event_timestamp
         FROM chunks_virtual cv
         LEFT JOIN raw_events re ON re.id = cv.source_event_id
         ${where}
         ORDER BY cv.id DESC
         LIMIT ?`
      ).all(...params, limit);
      return new Response(JSON.stringify(rows), { headers: { "Content-Type": "application/json" } });
    }

    if (url.pathname.startsWith("/chunk/")) {
      const id = parseInt(url.pathname.replace("/chunk/", ""), 10);
      if (!id) return new Response("Bad chunk id", { status: 400 });
      try {
        const chunk = readChunk(id);
        return new Response(JSON.stringify(chunk), { headers: { "Content-Type": "application/json" } });
      } catch (e: any) {
        return new Response(e.message || "Not found", { status: 404 });
      }
    }

    if (url.pathname === "/artifacts-ui") {
      return serveUiFile("/artifacts.html");
    }

    if (url.pathname === "/notes-ui") {
      return serveUiFile("/notes.html");
    }

    if (url.pathname === "/chunks-ui") {
      return serveUiFile("/chunks.html");
    }

    if (url.pathname === "/raw-ui") {
      return new Response(renderRawDump(), { headers: { "Content-Type": "text/html" } });
    }

    if (url.pathname.startsWith("/artifact/")) {
      const id = parseInt(url.pathname.replace("/artifact/", ""), 10);
      if (!id) return new Response("Bad artifact id", { status: 400 });
      const row = db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(id) as any;
      if (!row) return new Response("Not found", { status: 404 });
      const sources = db.prepare(`SELECT * FROM artifact_sources WHERE artifact_id = ? ORDER BY id ASC`).all(id) as any[];
      const enrichedSources = sources.map(s => {
        let text: string | null = null;
        let kind = 'unknown';
        let provenance: any = null;
        if (s.source_event_id) {
          kind = 'event';
          const ev = db.prepare(`SELECT id, external_id, source_type, project, timestamp, content FROM raw_events WHERE id = ?`).get(s.source_event_id) as any;
          if (ev) {
            provenance = { id: ev.id, external_id: ev.external_id, source_type: ev.source_type, project: ev.project, timestamp: ev.timestamp, total_chars: ev.content.length };
            const start = s.span_start ?? 0;
            const end   = s.span_end   ?? ev.content.length;
            text = filterMechanical(ev.content.slice(start, end));
          }
        } else if (s.source_raw_id) {
          kind = 'raw';
          const r = db.prepare(`SELECT id, title, source_path, source_type, project, content FROM raw_entries WHERE id = ?`).get(s.source_raw_id) as any;
          if (r) {
            provenance = { id: r.id, title: r.title, source_path: r.source_path, source_type: r.source_type, project: r.project, total_chars: r.content.length };
            const start = s.span_start ?? 0;
            const end   = s.span_end   ?? r.content.length;
            text = r.content.slice(start, end);
          }
        }
        return { ...s, kind, provenance, text };
      });
      return new Response(JSON.stringify({
        artifact: { ...row, data: JSON.parse(row.data) },
        sources: enrichedSources,
      }), { headers: { "Content-Type": "application/json" } });
    }

    if (url.pathname.startsWith("/note/")) {
      const id = parseInt(url.pathname.replace("/note/", ""), 10);
      if (!id) return new Response("Bad note id", { status: 400 });
      const note = getNote(id);
      if (!note) return new Response("Not found", { status: 404 });
      return new Response(JSON.stringify(note), { headers: { "Content-Type": "application/json" } });
    }

    if (url.pathname.startsWith("/wiki/")) {
      const slug = url.pathname.replace("/wiki/", "");
      const filePath = path.join(PATHS.wiki, `${slug}.md`);
      if (fs.existsSync(filePath)) {
        return new Response(fs.readFileSync(filePath, 'utf-8'), { headers: { "Content-Type": "text/markdown" } });
      }
      return new Response("Page not found", { status: 404 });
    }

    if (url.pathname === "/search") {
      const q = url.searchParams.get("q") || "";
      const opts = parseSearchOpts(url);
      const results = await hybridSearch(q, 10, opts);
      let md = `# Search Results for "${q}"\n\n`;
      if (results.length === 0) md += "No results found.";
      else {
        results.forEach(r => {
          const provenance = r.source_type || r.project
            ? ` {${r.source_type || '-'}/${r.project || '-'}}`
            : '';
          md += `- [${r.source.toUpperCase()}]${provenance} [[${r.slug || r.title}|${r.title}]] (score: ${r.score.toFixed(3)})\n`;
          md += `  > ${r.snippet.replace(/\n/g, ' ')}\n\n`;
          if (r.source === 'note') {
            const source = r.source_provenance_status === 'valid' && r.external_id
              ? `event:${r.external_id} (characters ${r.source_segment_start}-${r.source_segment_end})`
              : r.source_provenance_status || 'unresolved';
            md += `  > Provenance: ${source}\n\n`;
          }
        });
      }
      return new Response(md, { headers: { "Content-Type": "text/markdown" } });
    }

    if (url.pathname === "/add") {
      let content = "";
      let title = "";
      let sourceType: string | undefined;
      let project: string | undefined;
      if (req.method === "POST") {
        const body = await req.json() as any;
        content    = body.content;
        title      = body.title;
        sourceType = body.source_type;
        project    = body.project;
      } else {
        content    = url.searchParams.get("c") || "";
        title      = url.searchParams.get("t") || "";
        sourceType = url.searchParams.get("source") || undefined;
        project    = url.searchParams.get("project") || undefined;
      }
      if (!content) return new Response("Missing content", { status: 400 });
      const res = addToBrain(content, title, { sourceType, project });
      if (res.status === 'duplicate') return new Response("⚠️ Duplicate content detected.", { status: 200 });
      return new Response(`✅ Saved as raw entry.`, { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
};

const server = Bun.serve(PLUGIN_SOCKET
  ? { unix: PLUGIN_SOCKET, fetch: serveOptions.fetch }
  : { ...serveOptions, port: PORT, hostname: HOST });

console.log(PLUGIN_SOCKET
  ? `🚀 Brain API listening on unix:${PLUGIN_SOCKET}`
  : `🚀 Brain API listening on http://${HOST}:${server.port}`);

// --- /raw-ui: dump every row of every table. No filters, no nav, no JS. ---

function esc(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(s: unknown, max = 400): string {
  const str = String(s ?? '');
  return str.length > max ? str.slice(0, max) + ` … (${str.length - max} more chars)` : str;
}

function dumpTable(label: string, sql: string, opts: { truncFields?: string[]; maxBody?: number } = {}): string {
  let rows: any[];
  try { rows = db.prepare(sql).all() as any[]; } catch (e: any) {
    return `<section><h2>${esc(label)}</h2><p class="err">${esc(e.message)}</p></section>`;
  }
  if (rows.length === 0) {
    return `<section><h2>${esc(label)} <span class="count">(0)</span></h2><p class="empty">(empty)</p></section>`;
  }
  const cols = Object.keys(rows[0]);
  const truncSet = new Set(opts.truncFields || []);
  const maxBody = opts.maxBody ?? 400;
  const thead = cols.map(c => `<th>${esc(c)}</th>`).join('');
  const body = rows.map(r => {
    const tds = cols.map(c => {
      let v: unknown = r[c];
      if (truncSet.has(c)) v = truncate(v, maxBody);
      return `<td>${esc(v)}</td>`;
    }).join('');
    return `<tr>${tds}</tr>`;
  }).join('');
  const openAttr = rows.length > 50 ? '' : ' open';
  return `<section><details${openAttr}><summary><h2>${esc(label)} <span class="count">(${rows.length})</span></h2></summary><table><thead><tr>${thead}</tr></thead><tbody>${body}</tbody></table></details></section>`;
}

function renderRawDump(): string {
  const styles = `
    body { background: #0a0e14; color: #e6edf3; font-family: Monaco, Menlo, Consolas, monospace; font-size: 12px; margin: 0; padding: 16px; }
    h1 { font-size: 14px; letter-spacing: 0.2em; color: #7ec8e3; margin: 0 0 16px; }
    h2 { font-size: 13px; color: #7ec8e3; display: inline; }
    .count { color: rgba(230,237,243,0.4); font-weight: normal; }
    section { margin-bottom: 24px; border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 12px; background: rgba(255,255,255,0.02); }
    summary { cursor: pointer; list-style: none; outline: none; }
    summary::-webkit-details-marker { display: none; }
    summary::before { content: "▸ "; color: #7ec8e3; }
    details[open] summary::before { content: "▾ "; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px; }
    th, td { border: 1px solid rgba(255,255,255,0.06); padding: 4px 6px; text-align: left; vertical-align: top; max-width: 600px; word-break: break-word; white-space: pre-wrap; }
    th { background: rgba(126,200,227,0.06); color: #7ec8e3; font-weight: 600; }
    tr:nth-child(even) td { background: rgba(255,255,255,0.01); }
    .empty { color: rgba(230,237,243,0.4); font-style: italic; margin: 8px 0 0; }
    .err { color: #f87171; margin: 8px 0 0; }
  `;
  const parts: string[] = [];
  parts.push(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Mnemonic · Raw Dump</title><style>${styles}</style></head><body>`);
  parts.push(NAV_HTML);
  parts.push(`<h1>MNEMONIC · RAW DUMP</h1>`);

  parts.push(dumpTable('schema_version', 'SELECT * FROM schema_version'));

  parts.push(dumpTable('artifacts', 'SELECT * FROM artifacts ORDER BY id DESC'));
  parts.push(dumpTable('artifact_sources', 'SELECT * FROM artifact_sources ORDER BY id DESC'));

  parts.push(dumpTable('chunks_virtual', 'SELECT * FROM chunks_virtual ORDER BY id DESC'));

  parts.push(dumpTable(
    'raw_events',
    'SELECT id, source_type, project, external_id, chain_id, timestamp, title, content, processed, chunked FROM raw_events ORDER BY id DESC',
    { truncFields: ['content'], maxBody: 400 }
  ));

  parts.push(dumpTable(
    'raw_entries',
    'SELECT id, title, source_path, hash, source_type, project, processed, created_at, content FROM raw_entries ORDER BY id DESC',
    { truncFields: ['content'], maxBody: 400 }
  ));

  parts.push(dumpTable('wiki_pages', 'SELECT * FROM wiki_pages ORDER BY updated_at DESC'));
  parts.push(dumpTable('wiki_aliases', 'SELECT * FROM wiki_aliases'));
  parts.push(dumpTable('wiki_links', 'SELECT * FROM wiki_links'));

  parts.push(dumpTable('claims', 'SELECT * FROM claims ORDER BY id DESC'));
  parts.push(dumpTable('claim_sources', 'SELECT * FROM claim_sources'));
  parts.push(dumpTable('claim_sources_event', 'SELECT * FROM claim_sources_event'));

  parts.push(dumpTable('import_state', 'SELECT * FROM import_state ORDER BY last_mtime DESC'));
  parts.push(dumpTable(
    'chunks',
    "SELECT id, owner_type, page_slug, raw_id, chunk_type, substr(text, 1, 200) as text_preview, CASE WHEN embedding IS NULL THEN 0 ELSE 1 END as has_embedding, created_at FROM chunks ORDER BY id DESC"
  ));

  parts.push(dumpTable('operations_log', 'SELECT * FROM operations_log ORDER BY id DESC LIMIT 200'));

  parts.push('</body></html>');
  return parts.join('\n');
}
