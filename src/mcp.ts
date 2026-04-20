import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  initDb, hybridSearch, queryBrain, validateClaim, addToBrain, embedBrain, getStats, getProjects,
  renderActiveAgentsMarkdown,
  listArtifacts, listArtifactKeys, readChunk, queueChunks, db,
  searchArtifacts, getBrief, renderBrief,
} from './core.ts';

const server = new Server(
  {
    name: "brain-mcp",
    version: "0.9.0",
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
        name: "list_active_agents",
        description: "List currently-active agent sessions (Claude Code, Codex, Gemini CLI) with project, last-activity age, and the most recent user turn. Call when asked who's working, where, on what.",
        inputSchema: {
          type: "object",
          properties: {
            max_age_seconds: { type: "number", description: "Filter for activity within the last N seconds (default: 300)." }
          }
        },
      },
      {
        name: "get_brief",
        description: "Session-start preamble for a project: health, active agents (global), intents, open bugs, recent decisions, recurring frictions, corrections above threshold, recent todos. Deterministic markdown render from the artifact corpus — no LLM synthesis.",
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string", description: "Project slug (e.g. 'mm')." }
          },
          required: ["project"],
        },
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
      {
        name: "list_artifacts",
        description: "List v11 atomic artifacts (decisions, bugs, todos, intents, corrections, etc). Full JSON rows with data + provenance counts. Use artifact_keys for a cheaper projection when you only need keys.",
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string", description: "Project slug filter (e.g. 'mm')." },
            type:    { type: "string", description: "Type filter (e.g. 'decision', 'bug', 'todo', 'intent', 'correction')." },
            status:  { type: "string", description: "Status filter (active | retired | invalid | all). Default: active." },
            limit:   { type: "number", description: "Max results. Default 200." }
          }
        },
      },
      {
        name: "artifact_keys",
        description: "Compact projection of artifacts: one line per artifact as '#<id> <type> <idempotency_key> | <summary>'. Token-cheap view for scanning what the DB already knows before emitting new artifacts.",
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string", description: "Project slug filter." },
            type:    { type: "string" },
            status:  { type: "string", description: "Default: active." },
            limit:   { type: "number", description: "Default 500." }
          }
        },
      },
      {
        name: "list_chunks",
        description: "List narrative chunks (chunks_virtual). Each chunk is a turn-aligned ~12KB slice of a session. Use read_chunk to fetch content.",
        inputSchema: {
          type: "object",
          properties: {
            project:   { type: "string", description: "Project slug filter." },
            processed: { type: "string", description: "'pending' (default), 'processed', or 'all'." },
            limit:     { type: "number", description: "Default 200." }
          }
        },
      },
      {
        name: "read_chunk",
        description: "Read a narrative chunk. Returns filtered session content (noise-tool blocks stripped, error lines preserved) plus metadata (project, source_event_id, filter_version drift).",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "number", description: "chunks_virtual.id" }
          },
          required: ["id"],
        },
      },
      {
        name: "search_artifacts",
        description: "FTS over artifact data. Returns ranked artifact rows with a highlighted snippet. Use when you need to find specific decisions, bugs, or notes by keyword rather than browse by type.",
        inputSchema: {
          type: "object",
          properties: {
            query:   { type: "string", description: "Search terms (matched as a phrase)." },
            project: { type: "string", description: "Project slug filter." },
            type:    { type: "string", description: "Artifact type filter." },
            status:  { type: "string", description: "Status filter (active|retired|invalid|all). Default: active." },
            limit:   { type: "number", description: "Default 50." }
          },
          required: ["query"],
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
    case "list_active_agents": {
      const args = request.params.arguments || {};
      const md = renderActiveAgentsMarkdown((args.max_age_seconds as number) || 300);
      return { content: [{ type: "text", text: md }] };
    }
    case "get_brief": {
      const args = request.params.arguments || {};
      const project = args.project as string | undefined;
      if (!project) return { content: [{ type: "text", text: "Error: 'project' required." }], isError: true };
      const md = renderBrief(getBrief(project));
      return { content: [{ type: "text", text: md }] };
    }
    case "embed_brain": {
      const res = await embedBrain(request.params.arguments?.slug as string);
      return { content: [{ type: "text", text: `Success: Embedded ${res.count} chunks.` }] };
    }
    case "list_artifacts": {
      const args = request.params.arguments || {};
      const status = (args.status as string | undefined) ?? 'active';
      const rows = listArtifacts({
        project: (args.project as string | undefined) ?? null,
        type:    (args.type as string | undefined) ?? null,
        status:  status === 'all' ? null : status,
        limit:   (args.limit as number | undefined) ?? 200,
      });
      // Attach source_count — same shape as HTTP /artifacts so clients that hit both paths see consistent data.
      const srcMap = new Map<number, number>();
      if (rows.length > 0) {
        const ids = rows.map(r => r.id);
        const placeholders = ids.map(() => '?').join(',');
        const sources = db.prepare(`SELECT artifact_id, COUNT(*) as c FROM artifact_sources WHERE artifact_id IN (${placeholders}) GROUP BY artifact_id`).all(...ids) as any[];
        for (const s of sources) srcMap.set(s.artifact_id, s.c);
      }
      const enriched = rows.map(r => ({ ...r, source_count: srcMap.get(r.id) || 0 }));
      return { content: [{ type: "text", text: JSON.stringify(enriched, null, 2) }] };
    }
    case "artifact_keys": {
      const args = request.params.arguments || {};
      const status = (args.status as string | undefined) ?? 'active';
      const rows = listArtifactKeys({
        project: (args.project as string | undefined) ?? null,
        type:    (args.type as string | undefined) ?? null,
        status:  status === 'all' ? null : status,
        limit:   (args.limit as number | undefined) ?? 500,
      });
      const text = rows.length === 0
        ? '(none)'
        : rows.map(r => `#${r.id} ${r.type} ${r.idempotency_key} | ${r.summary}`).join('\n');
      return { content: [{ type: "text", text }] };
    }
    case "list_chunks": {
      const args = request.params.arguments || {};
      const processed = (args.processed as string | undefined) ?? 'pending';
      const project = (args.project as string | undefined) ?? null;
      const limit = (args.limit as number | undefined) ?? 200;
      // queueChunks covers 'pending'. Broader filters need a direct query.
      let rows: any[];
      if (processed === 'pending') {
        rows = queueChunks(project, limit);
      } else {
        const clauses: string[] = [];
        const params: any[] = [];
        if (processed === 'processed') { clauses.push('processed = 1'); }
        if (project) { clauses.push('project = ?'); params.push(project); }
        const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
        rows = db.prepare(
          `SELECT id, project, source_event_id, chunk_index, chunk_total, filter_version, processed, created_at
           FROM chunks_virtual ${where} ORDER BY id ASC LIMIT ?`
        ).all(...params, limit);
      }
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }
    case "read_chunk": {
      const args = request.params.arguments || {};
      const id = args.id as number;
      if (!id) return { content: [{ type: "text", text: "Error: 'id' required." }], isError: true };
      try {
        const chunk = readChunk(id);
        const body = `# Chunk #${chunk.id} (${chunk.chunk_index}/${chunk.chunk_total}) — event ${chunk.source_event_id}\n\nfilter_version: ${chunk.filter_version_stored} (current: ${chunk.filter_version_current})\n\n---\n\n${chunk.content}`;
        return { content: [{ type: "text", text: body }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message || e}` }], isError: true };
      }
    }
    case "search_artifacts": {
      const args = request.params.arguments || {};
      const query = args.query as string;
      if (!query) return { content: [{ type: "text", text: "Error: 'query' required." }], isError: true };
      const status = (args.status as string | undefined) ?? 'active';
      const results = searchArtifacts(query, {
        project: (args.project as string | undefined) ?? null,
        type:    (args.type as string | undefined) ?? null,
        status:  status === 'all' ? null : status,
        limit:   (args.limit as number | undefined) ?? 50,
      });
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
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
