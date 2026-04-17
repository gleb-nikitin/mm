import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const dbFile = path.join('meta', 'brain.db');
const db = new Database(dbFile);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA foreign_keys = ON;');

function getHash(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

/**
 * A simple HTTP server using Bun.serve
 */
const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/add") {
      let content = "";
      let title = "";
      if (req.method === "POST") {
        const body = await req.json() as any;
        content = body.content;
        title = body.title || `API Post ${new Date().toISOString()}`;
      } else if (req.method === "GET") {
        content = url.searchParams.get("c") || "";
        title = url.searchParams.get("t") || `API Get ${new Date().toISOString()}`;
      }
      if (!content) return new Response("Missing 'content' parameter", { status: 400 });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${timestamp}.md`;
      const filePath = path.join('raw', filename);
      const fileContent = `# ${title}\n\nAdded via API: ${new Date().toLocaleString()}\n\n---\n\n${content}`;
      const hash = getHash(content);
      fs.writeFileSync(filePath, fileContent);
      try {
        db.prepare('INSERT INTO raw_entries (title, content, source_path, hash) VALUES (?, ?, ?, ?)')
          .run(title, content, filePath, hash);
        return new Response(`✅ Added ${title} to brain.`);
      } catch (e: any) {
        return new Response(`⚠️ Entry already exists.`, { status: 200 });
      }
    }

    if (url.pathname === "/search") {
      const query = url.searchParams.get("q") || "";
      const results = db.prepare('SELECT slug, title, summary FROM wiki_pages WHERE slug IN (SELECT slug FROM search_index WHERE search_index MATCH ?)')
        .all(`"${query}"`) as any[];
      
      let response = `# Search Results for "${query}"\n\n`;
      if (results.length === 0) {
        response += "No results found.\n";
      } else {
        for (const r of results) {
          response += `- [[${r.slug}|${r.title}]]: ${r.summary || 'No summary.'}\n`;
        }
      }
      return new Response(response, { headers: { "Content-Type": "text/markdown" } });
    }

    if (url.pathname === "/read") {
      const slug = url.searchParams.get("slug") || "";
      const filePath = path.join('wiki', `${slug}.md`);
      if (fs.existsSync(filePath)) return new Response(fs.readFileSync(filePath, 'utf-8'), { headers: { "Content-Type": "text/markdown" } });
      return new Response("Not found", { status: 404 });
    }

    if (url.pathname === "/log") {
      const logPath = path.join('meta', 'log.md');
      if (fs.existsSync(logPath)) return new Response(fs.readFileSync(logPath, 'utf-8'), { headers: { "Content-Type": "text/markdown" } });
      return new Response("Log not found", { status: 404 });
    }

    if (url.pathname === "/timeline") {
      const timelinePath = path.join('meta', 'timeline.md');
      if (fs.existsSync(timelinePath)) return new Response(fs.readFileSync(timelinePath, 'utf-8'), { headers: { "Content-Type": "text/markdown" } });
      return new Response("Timeline not found", { status: 404 });
    }

    if (url.pathname === "/lint") {
      const res = spawnSync('bun', ['brain.ts', 'lint'], { encoding: 'utf-8' });
      return new Response(res.stdout || res.stderr || "Linting triggered.", { headers: { "Content-Type": "text/markdown" } });
    }

    if (url.pathname === "/index") {
      const indexPath = path.join('meta', 'index.md');
      if (fs.existsSync(indexPath)) return new Response(fs.readFileSync(indexPath, 'utf-8'), { headers: { "Content-Type": "text/markdown" } });
      return new Response("Index not found", { status: 404 });
    }

    return new Response("# Brain API v0.3.1\n\nEndpoints:\n- `/add?c=content&t=title`\n- `/search?q=query`\n- `/read?slug=slug`\n- `/index`\n- `/log`\n- `/timeline`\n- `/lint`", { status: 200, headers: { "Content-Type": "text/markdown" } });
  },
});

console.log(`🚀 Brain API listening on http://localhost:${server.port}`);
