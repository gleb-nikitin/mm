import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { 
  initDb, hybridSearch, queryBrain, validateClaim, addToBrain, embedBrain, getStats 
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
        description: "Search the persistent knowledge base. Returns ranked results with scores.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search term." },
            limit: { type: "number", description: "Max results." }
          },
          required: ["query"],
        },
      },
      {
        name: "query_brain",
        description: "Ask a question. Returns synthesized answer with citations.",
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
        description: "Add raw content. Handles content-hash deduplication.",
        inputSchema: {
          type: "object",
          properties: {
            content: { type: "string", description: "The text." },
            title: { type: "string", description: "Optional title." }
          },
          required: ["content"],
        },
      },
      {
        name: "validate_claim",
        description: "Fact-check a claim. Returns verdict + citations.",
        inputSchema: {
          type: "object",
          properties: {
            claim: { type: "string", description: "The claim." }
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
      const results = await hybridSearch(
        request.params.arguments?.query as string,
        (request.params.arguments?.limit as number) || 10
      );
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
    case "query_brain": {
      const res = await queryBrain(request.params.arguments?.question as string);
      return { content: [{ type: "text", text: res.stdout || res.stderr || "Success" }] };
    }
    case "add_to_brain": {
      const res = addToBrain(
        request.params.arguments?.content as string,
        request.params.arguments?.title as string
      );
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    }
    case "validate_claim": {
      const res = await validateClaim(request.params.arguments?.claim as string);
      return { content: [{ type: "text", text: res.stdout || res.stderr || "Success" }] };
    }
    case "brain_stats": {
      const stats = getStats();
      return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
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
