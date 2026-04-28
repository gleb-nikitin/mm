import { db } from '../core.ts';
import type { ParsedMessageFooter, Vendor } from './types.ts';

// Legacy ac prompt footers only carried chain/from/to. Because
// session_message_links is keyed by chain_msg_id, those legacy footers are
// parsed with confidence='none' and intentionally not inserted. We only write
// a row when the footer provides chain_msg_id or enough fields to derive the
// canonical `${chain}-${chain_seq}` id.

function parseFooterFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  const footerStart = text.lastIndexOf('\n---\n');
  const source = footerStart >= 0 ? text.slice(footerStart + 5) : text;
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!match) continue;
    fields.set(match[1]!.trim(), match[2]!.trim());
  }
  return fields;
}

function parseInteger(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

export function parsePromptFooter(text: string): ParsedMessageFooter {
  const fields = parseFooterFields(text);
  const chain = fields.get('chain') || null;
  const seq = parseInteger(fields.get('chain_seq'));
  const explicitMsgId = fields.get('chain_msg_id') || null;
  const chainMsgId = explicitMsgId ?? (chain && seq !== null ? `${chain}-${seq}` : null);
  return {
    chain,
    seq,
    from_id: fields.get('from') || null,
    to_id: fields.get('to') || null,
    chain_msg_id: chainMsgId,
    confidence: explicitMsgId ? 'exact' : chainMsgId ? 'footer' : 'none',
  };
}

export function recordMessageLink(args: {
  vendor: Vendor;
  session_id: string;
  participant_id?: string | null;
  source_path?: string | null;
  text: string;
}): ParsedMessageFooter {
  const footer = parsePromptFooter(args.text);
  if (!footer.chain_msg_id) return footer;

  db.prepare(
    `INSERT INTO session_message_links
       (chain_msg_id, chain, seq, from_id, to_id, vendor, session_id,
        participant_id, source_path, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(chain_msg_id) DO UPDATE SET
       chain = excluded.chain,
       seq = excluded.seq,
       from_id = excluded.from_id,
       to_id = excluded.to_id,
       vendor = excluded.vendor,
       session_id = excluded.session_id,
       participant_id = excluded.participant_id,
       source_path = excluded.source_path,
       confidence = excluded.confidence`
  ).run(
    footer.chain_msg_id,
    footer.chain,
    footer.seq,
    footer.from_id,
    footer.to_id,
    args.vendor,
    args.session_id,
    args.participant_id ?? null,
    args.source_path ?? null,
    footer.confidence,
  );
  return footer;
}
