import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { 
  db, PATHS, getHash, slugify, hybridSearch, getStats, embed 
} from './core.ts';

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // Root - Markdown Instructions
    if (url.pathname === "/") {
      return new Response(`# Brain API v0.7.0

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
      const question = url.searchParams.get("q") || "";
      if (!question) return new Response("Missing 'q' parameter", { status: 400 });
      const res = spawnSync('bun', ['brain.ts', 'query', question], { encoding: 'utf-8' });
      return new Response(res.stdout || res.stderr, { headers: { "Content-Type": "text/markdown" } });
    }

    if (url.pathname === "/validate") {
      const claim = url.searchParams.get("q") || "";
      if (!claim) return new Response("Missing 'q' parameter", { status: 400 });
      const res = spawnSync('bun', ['brain.ts', 'validate', claim], { encoding: 'utf-8' });
      return new Response(res.stdout || res.stderr, { headers: { "Content-Type": "text/markdown" } });
    }

    if (url.pathname === "/stats") {
      const stats = getStats();
      let md = "# Brain Stats\n\n";
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
      const query = url.searchParams.get("q") || "";
      const results = await hybridSearch(query);
      let md = `# Search Results for "${query}"\n\n`;
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
      const hash = getHash(content);
      if (db.prepare('SELECT 1 FROM raw_entries WHERE hash = ?').get(hash)) {
        return new Response("⚠️ Duplicate content detected. Not saved.", { status: 200 });
      }
      const res = spawnSync('bun', ['brain.ts', 'add', content, '--title', title || ""], { encoding: 'utf-8' });
      return new Response(res.stdout || "Added.", { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`🚀 Brain API listening on http://localhost:${server.port}`);
