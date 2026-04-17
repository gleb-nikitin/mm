import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
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

const server = new Server(
  {
    name: "brain-mcp",
    version: "0.3.1",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * List available tools.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_brain",
        description: "Search the persistent knowledge base. Returns ranked wiki pages and metadata.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search term.",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "get_backlinks",
        description: "Get all pages that link to a specific slug.",
        inputSchema: {
          type: "object",
          properties: {
            slug: {
              type: "string",
              description: "The canonical slug.",
            },
          },
          required: ["slug"],
        },
      },
      {
        name: "add_claim",
        description: "Record a specific claim and its raw source for provenance. Validates slug and raw_id.",
        inputSchema: {
          type: "object",
          properties: {
            slug: {
              type: "string",
              description: "The wiki page slug.",
            },
            claim: {
              type: "string",
              description: "The claim text.",
            },
            raw_id: {
              type: "number",
              description: "The ID of the raw source entry.",
            },
          },
          required: ["slug", "claim", "raw_id"],
        },
      },
      {
        name: "list_unprocessed",
        description: "List all raw entries that haven't been synthesized yet.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "read_wiki",
        description: "Read the content of a specific wiki page.",
        inputSchema: {
          type: "object",
          properties: {
            slug: {
              type: "string",
              description: "The canonical slug of the wiki page (e.g., 'Gleb_Nikitin').",
            },
          },
          required: ["slug"],
        },
      },
      {
        name: "add_to_brain",
        description: "Add a new raw fact or snippet to the brain. This will later be synthesized by the librarian.",
        inputSchema: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The content to add.",
            },
            title: {
              type: "string",
              description: "An optional title for the snippet.",
            },
          },
          required: ["content"],
        },
      },
      {
        name: "process_brain",
        description: "Trigger the librarian to process any pending raw entries into wiki pages.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "maintain_brain",
        description: "Trigger routine maintenance to fix links, improve summaries, and normalize pages.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

/**
 * Handle tool calls.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "search_brain": {
      const query = request.params.arguments?.query as string;
      const wikiResults = db.prepare('SELECT slug, title, tags, summary FROM wiki_pages WHERE slug IN (SELECT slug FROM search_index WHERE search_index MATCH ?)')
        .all(`"${query}"`) as any[];
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              wiki: wikiResults.map(r => ({
                slug: r.slug,
                title: r.title,
                tags: JSON.parse(r.tags),
                summary: r.summary
              }))
            }, null, 2),
          },
        ],
      };
    }

    case "get_backlinks": {
      const slug = request.params.arguments?.slug as string;
      const results = db.prepare('SELECT source_slug FROM wiki_links WHERE target_slug = ?').all(slug) as any[];
      return {
        content: [{ type: "text", text: JSON.stringify(results) }],
      };
    }

    case "add_claim": {
      const slug = request.params.arguments?.slug as string;
      const claim = request.params.arguments?.claim as string;
      const raw_id = request.params.arguments?.raw_id as number;
      
      const pageExists = db.prepare('SELECT 1 FROM wiki_pages WHERE slug = ?').get(slug);
      if (!pageExists) return { content: [{ type: "text", text: `Error: Wiki page '${slug}' not found.` }], isError: true };
      
      const rawExists = db.prepare('SELECT 1 FROM raw_entries WHERE id = ?').get(raw_id);
      if (!rawExists) return { content: [{ type: "text", text: `Error: Raw entry '${raw_id}' not found.` }], isError: true };

      try {
        const res = db.prepare('INSERT INTO claims (wiki_slug, claim_text) VALUES (?, ?)').run(slug, claim);
        const claim_id = res.lastInsertRowid;
        db.prepare('INSERT INTO claim_sources (claim_id, raw_id) VALUES (?, ?)').run(claim_id, raw_id);
        return {
          content: [{ type: "text", text: `✅ Recorded claim for ${slug}.` }],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }

    case "list_unprocessed": {
      const results = db.prepare('SELECT id, title, created_at FROM raw_entries WHERE processed = 0').all();
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }

    case "read_wiki": {
      const slug = request.params.arguments?.slug as string;
      const filePath = path.join('wiki', `${slug}.md`);
      
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        return {
          content: [{ type: "text", text: content }],
        };
      } else {
        return {
          content: [{ type: "text", text: `Error: Wiki page for '${slug}' not found.` }],
          isError: true,
        };
      }
    }

    case "add_to_brain": {
      const content = request.params.arguments?.content as string;
      const title = (request.params.arguments?.title as string) || `Snippet from MCP ${new Date().toISOString()}`;
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${timestamp}.md`;
      const filePath = path.join('raw', filename);
      const fileContent = `# ${title}\n\nAdded via MCP: ${new Date().toLocaleString()}\n\n---\n\n${content}`;
      const hash = getHash(content);

      fs.writeFileSync(filePath, fileContent);
      
      try {
        db.prepare('INSERT INTO raw_entries (title, content, source_path, hash) VALUES (?, ?, ?, ?)')
          .run(title, content, filePath, hash);
        return {
          content: [{ type: "text", text: `✅ Successfully added '${title}' to the brain.` }],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `⚠️ Entry already exists.` }],
        };
      }
    }

    case "process_brain": {
      const result = spawnSync('bun', ['brain.ts', 'process'], { encoding: 'utf-8' });
      return {
        content: [{ type: "text", text: result.stdout || result.stderr || "Process triggered." }],
      };
    }

    case "maintain_brain": {
      const result = spawnSync('bun', ['brain.ts', 'maintain'], { encoding: 'utf-8' });
      return {
        content: [{ type: "text", text: result.stdout || result.stderr || "Maintenance triggered." }],
      };
    }

    default:
      throw new Error("Unknown tool");
  }
});

/**
 * Start the server using stdio transport.
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
