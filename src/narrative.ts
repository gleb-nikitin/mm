// Narrative filtering for virtual chunks.
//
// `filterMechanical` strips mechanical noise (tool envelopes, filler turns) while
// preserving prose and anything that looks like error signal. Runs on read; never
// mutates `raw_events.content`. Chunk offsets index raw text, so changes here do
// not retroactively shift spans — but they do change what a librarian sees on
// `brain chunk read`. Bump FILTER_VERSION when behavior changes.

export const FILTER_VERSION = 1;

const NOISE_TOOLS = new Set(['Bash', 'Read', 'Glob', 'Grep', 'LS', 'TodoWrite', 'TaskCreate']);
const COMPRESSIBLE_TOOLS = new Set(['Edit', 'Write']);
const ERROR_RE = /\b(error|Error|ERROR|failed|Failed|traceback|Traceback|exception|Exception)\b/;
const ROLE_RE = /^(User|Assistant|A|Human):\s*/;
const TOOL_HEADER_RE = /^\[tool:\s*(\w+)\]\s*$/;
const FILLER_RE = /^(Acknowledged|Sure|OK|Done|Thanks|Got it|Understood)\.?$/i;

export function filterMechanical(content: string): string {
  const lines = content.split('\n');
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
