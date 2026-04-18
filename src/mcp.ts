import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { 
  initDb, hybridSearch, queryBrain, validateClaim, addToBrain, embedBrain, getStats, getProjects 
} from './core.ts';

const server = new Server(
  {
    name: "brain-mcp",
    version: "0.7.3",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

initDb();

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_brain",
        description: "Search the persistent knowledge base. Returns ranked results. Optionally scope by source_type and/or project.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search term." },
            limit: { type: "number", description: "Max results." },
            source_types: { type: "array", items: { type: "string" }, description: "Optional source filter (e.g. ['claude','docs'])." },
            projects:     { type: "array", items: { type: "string" }, description: "Optional project filter (e.g. ['mm','ac'])." }
          },
          required: ["query"],
        },
      },
      {
        name: "query_brain",
        description: "Ask a question. Returns synthesized answer with citations. Optionally scope by source_type and/or project.",
        inputSchema: {
          type: "object",
          properties: {
            question: { type: "string", description: "The question to answer." },
            source_types: { type: "array", items: { type: "string" }, description: "Optional source filter." },
            projects:     { type: "array", items: { type: "string" }, description: "Optional project filter." }
          },
          required: ["question"],
        },
      },
      {
        name: "add_to_brain",
        description: "Add raw content. Handles content-hash deduplication. Tag with source_type and project for scoping.",
        inputSchema: {
          type: "object",
          properties: {
            content: { type: "string", description: "The text." },
            title: { type: "string", description: "Optional title." },
            source_type: { type: "string", description: "Channel: claude, telegram, chains, docs, research, knowledge (default: 'raw')." },
            project:     { type: "string", description: "Domain slug (e.g. 'mm', 'ac'); default: 'unknown'." }
          },
          required: ["content"],
        },
      },
      {
        name: "validate_claim",
        description: "Fact-check a claim. Returns verdict + citations. Optionally scope by source_type and/or project.",
        inputSchema: {
          type: "object",
          properties: {
            claim: { type: "string", description: "The claim." },
            source_types: { type: "array", items: { type: "string" }, description: "Optional source filter." },
            projects:     { type: "array", items: { type: "string" }, description: "Optional project filter." }
          },
          required: ["claim"],
        },
      },
      {
        name: "brain_stats",
        description: "Get brain health and coverage statistics.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "list_projects",
        description: "List all unique project slugs in the brain.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "embed_brain",
        description: "Run incremental embedding.",
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
      const args = request.params.arguments || {};
      const results = await hybridSearch(
        args.query as string,
        (args.limit as number) || 10,
        { sourceTypes: args.source_types as string[] | undefined, projects: args.projects as string[] | undefined }
      );
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
    case "query_brain": {
      const args = request.params.arguments || {};
      const res = await queryBrain(
        args.question as string,
        { sourceTypes: args.source_types as string[] | undefined, projects: args.projects as string[] | undefined }
      );
      return { content: [{ type: "text", text: res.stdout || res.stderr || "Success" }] };
    }
    case "add_to_brain": {
      const args = request.params.arguments || {};
      const res = addToBrain(
        args.content as string,
        args.title as string,
        { sourceType: args.source_type as string | undefined, project: args.project as string | undefined }
      );
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
    case "validate_claim": {
      const args = request.params.arguments || {};
      const res = await validateClaim(
        args.claim as string,
        { sourceTypes: args.source_types as string[] | undefined, projects: args.projects as string[] | undefined }
      );
      return { content: [{ type: "text", text: res.stdout || res.stderr || "Success" }] };
    }
    case "brain_stats": {
      const stats = getStats();
      return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
    }
    case "list_projects": {
      const projects = getProjects();
      return { content: [{ type: "text", text: JSON.stringify(projects, null, 2) }] };
    }
    case "embed_brain": {
      const res = await embedBrain(request.params.arguments?.slug as string);
      return { content: [{ type: "text", text: `Success: Embedded ${res.count} chunks.` }] };
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
