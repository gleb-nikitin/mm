import * as fs from 'fs';
import * as path from 'path';
import {
  initDb, hybridSearch, getStats, queryBrain, validateClaim, addToBrain, PATHS,
  renderActiveAgentsMarkdown
} from './core.ts';

// Ensure DB is ready on fresh roots
initDb();

const UI_DIR = path.resolve(new URL('../ui', import.meta.url).pathname);

const HELP_MD = `# Brain API v0.8.0

Endpoints:
- \`/\`: Web UI (aurora theme).
- \`/help\`: This markdown endpoint list.
- \`/active?max_age_seconds=N\`: List currently-active agent sessions (Claude, Codex, Gemini).
- \`/query?q=<question>[&source=a,b&project=x,y]\`: Ask a synthesis question, optionally scoped.
- \`/validate?q=<claim>\`: Fact-check a specific claim.
- \`/wiki/:slug\`: Read a specific wiki page.
- \`/stats\`: High-level brain statistics.
- \`/search?q=<query>[&source=a,b&project=x,y]\`: Hybrid search, optionally scoped.
- \`/add\`: POST { content, title, source_type?, project? } or GET ?c=...&t=...&source=...&project=...

Scoping params:
- \`source\`: comma-separated source_types (claude, telegram, chains, docs, research, knowledge).
- \`project\`: comma-separated project slugs (mm, ac, ...).
When either filter is set, wiki search is skipped — results come from raw-entry chunks only.
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
  return new Response(file);
}

const PORT = parseInt(process.env.MT_PORT || '3000', 10);

const server = Bun.serve({
  port: PORT,
  idleTimeout: 180,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/") {
      return serveUiFile("/index.html");
    }
    if (url.pathname === "/active-ui") {
      return serveUiFile("/active.html");
    }
    if (url.pathname.startsWith("/ui/")) {
      return serveUiFile(url.pathname.replace(/^\/ui/, ""));
    }
    if (url.pathname === "/help") {
      return new Response(HELP_MD, { headers: { "Content-Type": "text/markdown" } });
    }

    if (url.pathname === "/active") {
      const maxAge = parseInt(url.searchParams.get("max_age_seconds") || "300", 10);
      const md = renderActiveAgentsMarkdown(maxAge);
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
      let md = "# Brain Stats\n\n";
      md += `- Schema Version: ${stats.version}\n`;
      md += `- Pages: ${stats.pages}\n`;
      md += `- Raw Entries: ${stats.raws}\n`;
      md += `- Links: ${stats.links}\n`;
      md += `- Claims: ${stats.claims}\n`;
      md += `- Embedded Chunks: ${stats.embeddedChunks} / ${stats.totalChunks}\n`;
      md += `- Avg Sources/Page: ${stats.avgSource}\n`;
      return new Response(md, { headers: { "Content-Type": "text/markdown" } });
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
});

console.log(`🚀 Brain API listening on http://localhost:${server.port}`);
