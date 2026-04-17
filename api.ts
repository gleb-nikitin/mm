import * as fs from 'fs';
import * as path from 'path';
import { 
  initDb, hybridSearch, getStats, queryBrain, validateClaim, addToBrain, PATHS 
} from './core.ts';

// Ensure DB is ready on fresh roots
initDb();

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // Root - Markdown Instructions
    if (url.pathname === "/") {
      return new Response(`# Brain API v0.7.3

Endpoints:
- \`/query?q=<question>\`: Ask a synthesis question.
- \`/validate?q=<claim>\`: Fact-check a specific claim.
- \`/wiki/:slug\`: Read a specific wiki page.
- \`/stats\`: High-level brain statistics.
- \`/search?q=<query>\`: Hybrid search results.
- \`/add\`: POST { content, title } or GET ?c=...&t=... to add raw snippets.
`, { headers: { "Content-Type": "text/markdown" } });
    }

    if (url.pathname === "/query") {
      const q = url.searchParams.get("q") || "";
      if (!q) return new Response("Missing 'q' parameter", { status: 400 });
      const res = await queryBrain(q);
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
      const results = await hybridSearch(q);
      let md = `# Search Results for "${q}"\n\n`;
      if (results.length === 0) md += "No results found.";
      else {
        results.forEach(r => {
          md += `- [${r.source.toUpperCase()}] [[${r.slug || r.title}|${r.title}]] (score: ${r.score.toFixed(3)})\n`;
          md += `  > ${r.snippet.replace(/\n/g, ' ')}\n\n`;
        });
      }
      return new Response(md, { headers: { "Content-Type": "text/markdown" } });
    }

    if (url.pathname === "/add") {
      let content = "";
      let title = "";
      if (req.method === "POST") {
        const body = await req.json() as any;
        content = body.content;
        title = body.title;
      } else {
        content = url.searchParams.get("c") || "";
        title = url.searchParams.get("t") || "";
      }
      if (!content) return new Response("Missing content", { status: 400 });
      const res = addToBrain(content, title);
      if (res.status === 'duplicate') return new Response("⚠️ Duplicate content detected.", { status: 200 });
      return new Response(`✅ Saved as raw entry.`, { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`🚀 Brain API listening on http://localhost:${server.port}`);
