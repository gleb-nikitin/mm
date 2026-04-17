import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { 
  db, PATHS, getHash, slugify, hybridSearch, getStats, embed, cosine_sim, chunkText 
} from './core.ts';

const server = new Server(
  {
    name: "brain-mcp",
    version: "0.7.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_brain",
        description: "Search the persistent knowledge base. Returns ranked wiki pages and metadata.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search term." },
            limit: { type: "number", description: "Max results (default 10)." }
          },
          required: ["query"],
        },
      },
      {
        name: "query_brain",
        description: "Ask a complex question. Returns synthesized answer with citations.",
        inputSchema: {
          type: "object",
          properties: {
            question: { type: "string", description: "The question to answer." }
          },
          required: ["question"],
        },
      },
      {
        name: "add_to_brain",
        description: "Add a new raw fact or insight. Handles deduplication.",
        inputSchema: {
          type: "object",
          properties: {
            content: { type: "string", description: "The raw text." },
            title: { type: "string", description: "Optional title." }
          },
          required: ["content"],
        },
      },
      {
        name: "validate_claim",
        description: "Fact-check a claim against the brain. Returns verdict + citations.",
        inputSchema: {
          type: "object",
          properties: {
            claim: { type: "string", description: "The claim to validate." }
          },
          required: ["claim"],
        },
      },
      {
        name: "brain_stats",
        description: "Get high-level statistics about the brain (page counts, chunk coverage).",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "embed_brain",
        description: "Manually trigger embedding for a page or the whole brain.",
        inputSchema: {
          type: "object",
          properties: {
            slug: { type: "string", description: "Optional page slug." }
          }
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "search_brain": {
      const query = request.params.arguments?.query as string;
      const limit = (request.params.arguments?.limit as number) || 10;
      const results = await hybridSearch(query, limit);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }

    case "query_brain": {
      const question = request.params.arguments?.question as string;
      const res = spawnSync('bun', ['brain.ts', 'query', question], { encoding: 'utf-8' });
      return {
        content: [{ type: "text", text: res.stdout || res.stderr || "Query executed." }],
      };
    }

    case "add_to_brain": {
      const content = request.params.arguments?.content as string;
      const title = (request.params.arguments?.title as string) || `Snippet ${new Date().toISOString()}`;
      const hash = getHash(content);
      if (db.prepare('SELECT 1 FROM raw_entries WHERE hash = ?').get(hash)) {
        return { content: [{ type: "text", text: "⚠️ Duplicate content detected. Not saved." }] };
      }
      const res = spawnSync('bun', ['brain.ts', 'add', content, '--title', title], { encoding: 'utf-8' });
      return { content: [{ type: "text", text: res.stdout || "Added." }] };
    }

    case "validate_claim": {
      const claim = request.params.arguments?.claim as string;
      const res = spawnSync('bun', ['brain.ts', 'validate', claim], { encoding: 'utf-8' });
      return {
        content: [{ type: "text", text: res.stdout || res.stderr || "Validation executed." }],
      };
    }

    case "brain_stats": {
      const stats = getStats();
      return {
        content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
      };
    }

    case "embed_brain": {
      const slug = request.params.arguments?.slug as string;
      const args = slug ? ['brain.ts', 'embed', slug] : ['brain.ts', 'embed'];
      const res = spawnSync('bun', args, { encoding: 'utf-8' });
      return {
        content: [{ type: "text", text: res.stdout || "Embedding task triggered." }],
      };
    }

    default:
      throw new Error("Unknown tool");
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
