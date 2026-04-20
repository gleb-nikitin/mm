// Narrative filtering for virtual chunks.
//
// `filterMechanical` strips mechanical noise (tool envelopes, filler turns) while
// preserving prose and anything that looks like error signal. Runs on read; never
// mutates `raw_events.content`. Chunk offsets index raw text, so changes here do
// not retroactively shift spans — but they do change what a librarian sees on
// `brain chunk read`. Bump FILTER_VERSION when behavior changes.
//
// v2: recognize chain-message footers and emit `[chain-msg from=X to=Y]` synthetic
// markers additively (after the role marker, before the message body). Messages
// without a footer keep v1 behavior exactly.

export const FILTER_VERSION = 2;

const NOISE_TOOLS = new Set(['Bash', 'Read', 'Glob', 'Grep', 'LS', 'TodoWrite', 'TaskCreate']);
const COMPRESSIBLE_TOOLS = new Set(['Edit', 'Write']);
const ERROR_RE = /\b(error|Error|ERROR|failed|Failed|traceback|Traceback|exception|Exception)\b/;
const ROLE_RE = /^(User|Assistant|A|Human):\s*/;
const TOOL_HEADER_RE = /^\[tool:\s*(\w+)\]\s*$/;
const FILLER_RE = /^(Acknowledged|Sure|OK|Done|Thanks|Got it|Understood)\.?$/i;

// Chain footer block shape (end of a message):
//   ---
//   chain: <id>
//   from: <participant-id>
//   to: <participant-id>
//   [optional trailing footer fields like chain_history: ...]
const CHAIN_FOOTER_RE = /(?:^|\n)---\nchain:\s+(\S+)\nfrom:\s+(\S+)\nto:\s+(\S+)(?:\n[a-z_]+:[^\n]*)*\s*$/;

function detectChainFooter(block: string): { from: string; to: string } | null {
  const m = block.match(CHAIN_FOOTER_RE);
  if (!m) return null;
  return { from: m[2], to: m[3] };
}

export function filterMechanical(content: string): string {
  const lines = content.split('\n');

  // Pre-scan: for each role marker, determine whether the message that follows
  // (up to the next role marker or end of content) carries a chain footer.
  const chainMarkerByLine = new Map<number, { from: string; to: string }>();
  for (let i = 0; i < lines.length; i++) {
    if (!ROLE_RE.test(lines[i])) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (ROLE_RE.test(lines[j])) { end = j; break; }
    }
    const footer = detectChainFooter(lines.slice(i + 1, end).join('\n'));
    if (footer) chainMarkerByLine.set(i, footer);
  }

  const out: string[] = [];
  let dropMode = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // A6: error-signal lines are always preserved, regardless of mode. Do NOT
    // exit dropMode — surrounding tool noise should still be stripped.
    if (ERROR_RE.test(line)) {
      out.push(line);
      continue;
    }

    // Role marker ends any tool-drop region. Also trims low-content filler turns
    // ("Assistant: OK" followed by a new speaker).
    if (ROLE_RE.test(line)) {
      dropMode = false;
      const body = line.replace(ROLE_RE, '').trim();
      const next = lines[i + 1] ?? '';
      const isFillerTurn = body.length > 0 && FILLER_RE.test(body) && (!next.trim() || ROLE_RE.test(next));
      if (isFillerTurn) continue;
      out.push(line);
      const cm = chainMarkerByLine.get(i);
      if (cm) out.push(`[chain-msg from=${cm.from} to=${cm.to}]`);
      continue;
    }

    const toolMatch = line.match(TOOL_HEADER_RE);
    if (toolMatch) {
      const tool = toolMatch[1];
      if (NOISE_TOOLS.has(tool)) { dropMode = true; continue; }
      if (COMPRESSIBLE_TOOLS.has(tool)) {
        dropMode = false;
        out.push(`[code-change: ${tool}]`);
        continue;
      }
      if (tool === 'Agent') {
        dropMode = false;
        out.push('[agent-task]');
        continue;
      }
      dropMode = false;
      out.push(line);
      continue;
    }

    if (dropMode) continue;
    out.push(line);
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
