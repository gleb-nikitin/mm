/*
  Cron: 0 2 * * * cd /path/to/mm && bun run brain dream >> meta/dream.log 2>&1
*/

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import {
  db, PATHS, initDb, getHash, slugify, hybridSearch, getStats,
  queryBrain, validateClaim, addToBrain, embedBrain, runGemini, cosine_sim
} from './core.ts';

const program = new Command();

initDb();

// --- Internal Deterministic Logic ---

function internalRecordClaim(slug: string, claim: string, raw_id: number) {
  const pageExists = db.prepare('SELECT 1 FROM wiki_pages WHERE slug = ?').get(slug);
  if (!pageExists) throw new Error(`Page not found: ${slug}`);
  const res = db.prepare('INSERT INTO claims (wiki_slug, claim_text) VALUES (?, ?)').run(slug, claim);
  const claim_id = res.lastInsertRowid;
  db.prepare('INSERT INTO claim_sources (claim_id, raw_id) VALUES (?, ?)').run(claim_id, raw_id);
  db.prepare(`UPDATE wiki_pages SET source_count = (SELECT COUNT(DISTINCT raw_id) FROM claim_sources WHERE claim_id IN (SELECT id FROM claims WHERE wiki_slug = ?)) WHERE slug = ?`).run(slug, slug);
}

function internalRebuildIndex() {
  console.log('🏗️ Syncing index...');
  const rawFiles = fs.readdirSync(PATHS.raw).filter(f => f.endsWith('.md'));
  const foundRawPaths = new Set<string>();
  for (const file of rawFiles) {
    const filePath = path.join(PATHS.raw, file);
    foundRawPaths.add(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const titleMatch = content.match(/^# (.*)/);
    const title = titleMatch ? titleMatch[1] : file;
    const hash = getHash(content);
    db.prepare(`INSERT INTO raw_entries (title, content, source_path, hash) VALUES (?, ?, ?, ?) ON CONFLICT(source_path) DO UPDATE SET title = excluded.title, content = excluded.content, hash = excluded.hash`).run(title, content, filePath, hash);
  }
  const allRaw = db.prepare('SELECT id, source_path FROM raw_entries').all() as any[];
  for (const r of allRaw) if (!foundRawPaths.has(r.source_path)) db.prepare('DELETE FROM raw_entries WHERE id = ?').run(r.id);

  const wikiFiles = fs.readdirSync(PATHS.wiki).filter(f => f.endsWith('.md'));
  const foundSlugs = new Set<string>();
  const allLinks: { source: string, target: string }[] = [];
  db.run('DELETE FROM wiki_aliases'); db.run('DELETE FROM wiki_links'); db.run('DELETE FROM search_index');
  for (const file of wikiFiles) {
    const slug = file.replace('.md', '');
    foundSlugs.add(slug);
    const fileContent = fs.readFileSync(path.join(PATHS.wiki, file), 'utf-8');
    try {
      const parts = fileContent.split('---');
      if (parts.length >= 3) {
        const frontmatter = yaml.load(parts[1]) as any;
        const body = parts.slice(2).join('---');
        const summaryMatch = body.match(/## Summary\n\n(.*?)\n/s);
        const summary = summaryMatch ? summaryMatch[1].trim() : '';
        db.prepare(`INSERT INTO wiki_pages (slug, title, tags, status, source_count, summary, type, confidence, mentions, tier, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET title = excluded.title, tags = excluded.tags, status = excluded.status, source_count = excluded.source_count, summary = excluded.summary, type = excluded.type, confidence = excluded.confidence, mentions = excluded.mentions, tier = excluded.tier, updated_at = excluded.updated_at`).run(slug, String(frontmatter.title || slug), JSON.stringify(frontmatter.tags || []), String(frontmatter.status || 'active'), Number(frontmatter.source_count || 0), summary, String(frontmatter.type || 'concept'), Number(frontmatter.confidence || 0.5), Number(frontmatter.mentions || 1), Number(frontmatter.tier || 3), String(frontmatter.created_at || new Date().toISOString()), String(frontmatter.updated_at || new Date().toISOString()));
        db.prepare('INSERT INTO search_index (slug, title, content, tags) VALUES (?, ?, ?, ?)').run(slug, frontmatter.title || slug, fileContent, (frontmatter.tags || []).join(', '));
        if (frontmatter.aliases) for (const alias of frontmatter.aliases) if (alias) db.prepare('INSERT OR IGNORE INTO wiki_aliases (alias, slug) VALUES (?, ?)').run(alias, slug);
        const links = body.match(/\[\[(.*?)\]\]/g);
        if (links) for (const link of links) { const target = link.slice(2, -2).split('|')[0]; allLinks.push({ source: slug, target }); }
      }
    } catch (e) { console.error(`❌ Parse error ${file}:`, e); }
  }
  const allPages = db.prepare('SELECT slug FROM wiki_pages').all() as any[];
  for (const p of allPages) if (!foundSlugs.has(p.slug)) db.prepare('DELETE FROM wiki_pages WHERE slug = ?').run(p.slug);
  for (const { source, target } of allLinks) { try { db.prepare('INSERT OR IGNORE INTO wiki_links (source_slug, target_slug) VALUES (?, ?)').run(source, target); } catch (e) {} }
}

function internalRebuildMarkdownIndex() {
  console.log('🏗️ Generating meta/index.md...');
  const pages = db.prepare('SELECT slug, title, tags, summary, type, confidence, tier FROM wiki_pages ORDER BY title ASC').all() as any[];
  let content = "# Index\n\n";
  const byTag: Record<string, any[]> = {};
  for (const p of pages) {
    const tags = JSON.parse(p.tags);
    const tag = tags[0] || 'uncategorized';
    if (!byTag[tag]) byTag[tag] = [];
    byTag[tag].push(p);
  }
  for (const [tag, pgs] of Object.entries(byTag)) {
    content += `## ${tag.charAt(0).toUpperCase() + tag.slice(1)}\n\n`;
    for (const p of pgs) content += `- [[${p.slug}|${p.title}]]: ${p.summary || 'No summary available.'} [${p.type}, ${p.confidence}, T${p.tier}]\n`;
    content += "\n";
  }
  fs.writeFileSync(path.join(PATHS.meta, 'index.md'), content);
}

function internalRebuildTimeline() {
  console.log('📅 Generating timeline.md...');
  const rawEntries = db.prepare('SELECT title, created_at FROM raw_entries ORDER BY created_at DESC').all() as any[];
  let timelineContent = "# Brain Timeline\n\n"; let currentMonth = "";
  for (const entry of rawEntries) {
    const date = new Date(entry.created_at); const month = date.toLocaleString('default', { month: 'long', year: 'numeric' });
    if (month !== currentMonth) { currentMonth = month; timelineContent += `\n## ${currentMonth}\n\n`; }
    timelineContent += `- **${date.toLocaleDateString()}**: [RAW] ${entry.title}\n`;
  }
  fs.writeFileSync(path.join(PATHS.meta, 'timeline.md'), timelineContent);
}

// --- CLI Definitions ---

program.name('brain').version('0.7.2');

program.command('add').argument('<content>', 'Raw content').option('-t, --title <title>', 'Title').action((content, options) => {
  const res = addToBrain(content, options.title);
  if (res.status === 'duplicate') console.log(`⚠️ Duplicate content detected.`);
  else console.log(`✅ Saved ${res.path}`);
});

program.command('save').argument('<insight>', 'Freeform insight').option('-t, --title <title>', 'Title').action((insight, options) => {
  const res = addToBrain(insight, options.title);
  if (res.status === 'duplicate') console.log(`⚠️ Duplicate content detected.`);
  else {
    console.log(`✅ Saved ${res.path}`);
    const results = db.prepare('SELECT slug, title FROM search_index WHERE search_index MATCH ? LIMIT 3').all(`"${insight}"`) as any[];
    if (results.length > 0) { console.log('\nSuggested pages:'); results.forEach(r => console.log(`- [[${r.slug}|${r.title}]]`)); }
  }
});

program.command('queue').action(() => {
  const unprocessed = db.prepare('SELECT id, title, created_at FROM raw_entries WHERE processed = 0').all();
  if (unprocessed.length === 0) console.log('✨ Empty.'); else console.table(unprocessed);
});

program.command('search').argument('<query>', 'Search term').action(async (query) => {
  const stats = getStats();
  if (stats.embeddedChunks > 0) {
    const results = await hybridSearch(query);
    if (results.length > 0) results.forEach(r => console.log(`[${r.source.toUpperCase()}] ${r.slug ? `[[${r.slug}|${r.title}]]` : r.title} (score: ${r.score.toFixed(3)})`));
    else console.log('No matches.');
  } else {
    const results = db.prepare('SELECT slug, title FROM search_index WHERE search_index MATCH ?').all(`"${query}"`) as any[];
    if (results.length > 0) results.forEach(r => console.log(`[[${r.slug}|${r.title}]]`)); else console.log('No matches.');
  }
});

program.command('read').argument('<slug>', 'Slug').action((slug) => {
  const filePath = path.join(PATHS.wiki, `${slug}.md`);
  if (fs.existsSync(filePath)) console.log(fs.readFileSync(filePath, 'utf-8')); else console.error(`❌ 404: ${slug}`);
});

program.command('query').argument('<question>', 'The question').option('--save', 'Save as analysis page').action(async (question, options) => {
  console.log(`🧠 Querying: "${question}"...`);
  const result = await queryBrain(question);
  process.stdout.write(result.stdout || result.stderr || "");
  if (options.save && result.status === 0) {
    const slug = `analysis_${slugify(question)}`;
    const body = `---\ntitle: Synthesis: ${question}\nslug: ${slug}\ntags: [analysis]\ntype: analysis\nconfidence: 0.7\nmentions: 1\ntier: 2\nstatus: active\ncreated_at: ${new Date().toISOString()}\nupdated_at: ${new Date().toISOString()}\nsource_count: 0\n---\n\n# Analysis: ${question}\n\n## Summary\n${result.stdout}\n\n## Cross-References\n\n---\n<!-- TIMELINE: append-only below this line -->\n- **${new Date().toISOString().split('T')[0]}**: Generated synthesis via query.\n`;
    fs.writeFileSync(path.join(PATHS.wiki, `${slug}.md`), body);
    console.log(`\n✅ Saved to wiki/${slug}.md`);
    internalRebuildIndex();
  }
});

program.command('process').action(async () => {
  const unprocessed = db.prepare('SELECT * FROM raw_entries WHERE processed = 0').all() as any[];
  if (unprocessed.length === 0) { console.log('✨ Empty.'); return; }
  const ingestSkill = fs.readFileSync(path.join(PATHS.meta, 'skills', 'ingest.md'), 'utf-8');
  const schema = fs.readFileSync(path.join(PATHS.meta, 'schema.md'), 'utf-8');
  for (const entry of unprocessed) {
    console.log(`🧠 Processing: ${entry.title}`);
    const initialClaims = db.prepare('SELECT COUNT(*) as count FROM claim_sources WHERE raw_id = ?').get(entry.id) as any;
    const initialWikiMtime = fs.readdirSync(PATHS.wiki).reduce((max, f) => Math.max(max, fs.statSync(path.join(PATHS.wiki, f)).mtimeMs), 0);
    const prompt = `${ingestSkill}\n\n# CONTEXT\n\n## SCHEMA\n${schema}\n\n## RAW ENTRY\nID: ${entry.id}\nFile: ${entry.source_path}\nContent:\n${entry.content}\n\n# INSTRUCTIONS\nYou are an AI Librarian. Use 'bun run brain page create/update' with --source ${entry.id} and --claim \"...\".`;
    const result = await runGemini(prompt, true);
    if (result.status === 0) {
      const finalClaims = db.prepare('SELECT COUNT(*) as count FROM claim_sources WHERE raw_id = ?').get(entry.id) as any;
      const finalWikiMtime = fs.readdirSync(PATHS.wiki).reduce((max, f) => Math.max(max, fs.statSync(path.join(PATHS.wiki, f)).mtimeMs), 0);
      const claimsAdded = finalClaims.count > initialClaims.count;
      const wikiChanged = finalWikiMtime > initialWikiMtime;
      if (wikiChanged && !claimsAdded) { console.error(`❌ ERR: Wiki mod without provenance.`); internalRebuildIndex(); }
      else {
        db.prepare('UPDATE raw_entries SET processed = 1 WHERE id = ?').run(entry.id);
        internalRebuildIndex(); internalRebuildMarkdownIndex(); internalRebuildTimeline();
        const logMsg = `Processed raw entry ${entry.id}`;
        db.prepare('INSERT INTO operations_log (operation, details) VALUES (?, ?)').run('process', logMsg);
      }
    }
  }
});

program.command('lint').option('--fix', 'Safe fixes only').action((options) => {
  console.log('🧹 Linting Brain...');
  const wikiFiles = fs.readdirSync(PATHS.wiki).filter(f => f.endsWith('.md'));
  const findings: string[] = []; const aliasesFound = new Map<string, string[]>();
  const links = db.prepare('SELECT source_slug, target_slug FROM wiki_links').all() as any[];
  for (const link of links) if (!db.prepare('SELECT 1 FROM wiki_pages WHERE slug = ?').get(link.target_slug)) findings.push(`- **Broken Link**: [[${link.source_slug}]] -> [[${link.target_slug}]]`);
  for (const file of wikiFiles) {
    const content = fs.readFileSync(path.join(PATHS.wiki, file), 'utf-8');
    const slug = file.replace('.md', '');
    if (!content.includes('---')) findings.push(`- **Missing Header**: [[${slug}]]`);
    if (!content.includes('## Summary')) findings.push(`- **Missing Truth**: [[${slug}]]`);
    if (!content.includes('<!-- TIMELINE: append-only below this line -->')) {
      if (options.fix) { fs.appendFileSync(path.join(PATHS.wiki, file), '\n---\n<!-- TIMELINE: append-only below this line -->\n'); console.log(`✅ Fixed separator in ${file}`); }
      else findings.push(`- **Missing Timeline Separator**: [[${slug}]]`);
    }
    const parts = content.split('---');
    if (parts.length >= 3) {
      try {
        const fm = yaml.load(parts[1]) as any;
        if (fm && fm.aliases) for (const a of fm.aliases) { if (!aliasesFound.has(a)) aliasesFound.set(a, []); aliasesFound.get(a)!.push(slug); }
        const req = ['title', 'slug', 'aliases', 'tags', 'type', 'confidence', 'mentions', 'tier', 'status', 'created_at', 'updated_at', 'source_count'];
        const missing = req.filter(f => fm[f] === undefined);
        if (missing.length > 0) findings.push(`- **Missing Frontmatter**: [[${slug}]] missing ${missing.join(', ')}`);
        if (typeof fm.confidence !== 'number' || fm.confidence < 0 || fm.confidence > 1) findings.push(`- **Malformed Frontmatter**: [[${slug}]] invalid confidence (${fm.confidence})`);
        if (![1, 2, 3].includes(fm.tier)) findings.push(`- **Malformed Frontmatter**: [[${slug}]] invalid tier (${fm.tier})`);
        if (!['active', 'stale', 'archived'].includes(fm.status)) findings.push(`- **Malformed Frontmatter**: [[${slug}]] invalid status (${fm.status})`);
        if (!['entity', 'concept', 'source', 'analysis'].includes(fm.type)) findings.push(`- **Malformed Frontmatter**: [[${slug}]] invalid type (${fm.type})`);
        if (isNaN(Date.parse(fm.created_at))) findings.push(`- **Malformed Frontmatter**: [[${slug}]] invalid created_at`);
        if (isNaN(Date.parse(fm.updated_at))) findings.push(`- **Malformed Frontmatter**: [[${slug}]] invalid updated_at`);
        if (typeof fm.mentions !== 'number') findings.push(`- **Malformed Frontmatter**: [[${slug}]] mentions must be number`);
        if (typeof fm.source_count !== 'number') findings.push(`- **Malformed Frontmatter**: [[${slug}]] source_count must be number`);
        if (!Array.isArray(fm.aliases)) findings.push(`- **Malformed Frontmatter**: [[${slug}]] aliases must be array`);
        if (!Array.isArray(fm.tags)) findings.push(`- **Malformed Frontmatter**: [[${slug}]] tags must be array`);
      } catch (e) {}
    }
  }
  for (const [alias, slugs] of aliasesFound.entries()) if (slugs.length > 1) findings.push(`- **Alias Collision**: "${alias}" claimed by ${slugs.map(s => `[[${s}]]`).join(', ')}`);
  const orphans = db.prepare(`SELECT slug FROM wiki_pages WHERE slug NOT IN (SELECT target_slug FROM wiki_links) AND julianday(created_at) < julianday('now', '-7 days')`).all() as any[];
  orphans.forEach(o => findings.push(`- **Orphan Page**: [[${o.slug}]]`));
  const noProv = db.prepare('SELECT slug FROM wiki_pages WHERE source_count = 0 AND type != "analysis"').all() as any[];
  noProv.forEach(p => findings.push(`- **No Provenance**: [[${p.slug}]]`));
  const stale = db.prepare(`SELECT slug, title, updated_at FROM wiki_pages WHERE julianday(updated_at) < julianday('now', '-30 days')`).all() as any[];
  for (const s of stale) {
     const recent = db.prepare(`SELECT 1 FROM raw_entries WHERE julianday(created_at) > julianday(?) AND (content LIKE ? OR content LIKE ?)`).get(s.updated_at, `%${s.title}%`, `%${s.slug}%`);
     if (recent) findings.push(`- **Stale Page**: [[${s.slug}]] (mentioned in recent raw)`);
  }
  const report = `# Lint Report\n\nGenerated: ${new Date().toLocaleString()}\n\n${findings.length > 0 ? findings.join('\n') : '✨ No issues found.'}\n`;
  fs.writeFileSync(path.join(PATHS.meta, 'lint-report.md'), report); console.log(report);
});

program.command('doctor').action(async () => {
  console.log('🩺 Running doctor...'); const report: string[] = ['# Brain Doctor Report\n', `Generated: ${new Date().toLocaleString()}\n`];
  const integrity = db.prepare('PRAGMA integrity_check').get() as any;
  report.push(`## DB Integrity\n- Status: ${integrity.integrity_check === 'ok' ? '✅ OK' : '❌ ' + integrity.integrity_check}`);
  try { db.prepare("INSERT INTO search_index(search_index) VALUES('integrity-check')").run(); report.push(`- FTS5: ✅ OK`); } catch(e: any) { report.push(`- FTS5: ❌ ${e.message}`); }
  const stats = getStats();
  report.push(`\n## Embeddings\n- Coverage: ${stats.embeddedChunks} / ${stats.totalChunks} chunks`);
  report.push(`\n## Stats\n- Pages: ${stats.pages}\n- Raw Entries: ${stats.raws}\n- Links: ${stats.links}\n- Claims: ${stats.claims}\n- Avg Source Count: ${stats.avgSource}\n- Chunk Count: ${stats.totalChunks}`);
  const start = Date.now(); const hasEmbeddings = stats.embeddedChunks > 0; let sType = 'FTS-only';
  try { if (hasEmbeddings) { await hybridSearch('test', 1); sType = 'Hybrid'; } else db.prepare(`SELECT slug FROM search_index WHERE search_index MATCH 'test' LIMIT 1`).all(); } catch(e) {}
  report.push(`\n## Latency\n- Test Search (${sType}): ${Date.now() - start}ms`);
  report.push(`\n## Schema\n- Version: ${stats.version}`);
  const reportStr = report.join('\n'); fs.writeFileSync(path.join(PATHS.meta, 'doctor-report.md'), reportStr); console.log(reportStr);
});

program.command('validate').argument('<claim>', 'Claim').action(async (claim) => {
  console.log(`🧠 Validating: "${claim}"...`);
  const result = await validateClaim(claim);
  process.stdout.write(result.stdout || result.stderr || "");
});

program.command('dream').action(async () => {
  console.log('🌌 Dreaming...'); const report: string[] = ['# Dream Report\n', `Generated: ${new Date().toLocaleString()}\n`]; const logs: string[] = [];
  const promotionCandidates = db.prepare('SELECT slug FROM wiki_pages WHERE mentions >= 3 AND tier = 3').all() as any[];
  for (const p of promotionCandidates) {
    const filePath = path.join(PATHS.wiki, `${p.slug}.md`);
    if (fs.existsSync(filePath)) {
      let content = fs.readFileSync(filePath, 'utf-8'); content = content.replace(/tier:\s*3/, 'tier: 2');
      fs.writeFileSync(filePath, content); db.prepare('UPDATE wiki_pages SET tier = 2 WHERE slug = ?').run(p.slug);
      report.push(`- Promoted [[${p.slug}]] to Tier 2`); logs.push(`Promoted [[${p.slug}]] to tier 2`);
    }
  }
  const stale = db.prepare(`SELECT slug, title, updated_at FROM wiki_pages WHERE julianday(updated_at) < julianday('now', '-30 days')`).all() as any[];
  const staleCandidates = [];
  for (const s of stale) {
     const recent = db.prepare(`SELECT 1 FROM raw_entries WHERE julianday(created_at) > julianday(?) AND (content LIKE ? OR content LIKE ?)`).get(s.updated_at, `%${s.title}%`, `%${s.slug}%`);
     if (recent) staleCandidates.push(s.slug);
  }
  if (staleCandidates.length > 0) { report.push('\n## Stale Candidates'); staleCandidates.forEach(s => report.push(`- [[${s}]]`)); }
  const raws = db.prepare('SELECT content FROM raw_entries').all() as any[]; const words = new Map<string, number>();
  for (const r of raws) {
     const matches = r.content.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g); 
     if (matches) for (const m of matches) words.set(m, (words.get(m) || 0) + 1);
  }
  const gaps = Array.from(words.entries()).filter(([word, count]) => count >= 3 && !db.prepare('SELECT 1 FROM wiki_pages WHERE title = ? OR slug = ?').get(word, slugify(word))).map(([word]) => word);
  if (gaps.length > 0) { report.push('\n## Gap Detection'); gaps.forEach(g => report.push(`- Suggested missing page: [[${g}]]`)); }
  const repairs = []; const broken = db.prepare('SELECT source_slug, target_slug FROM wiki_links WHERE target_slug NOT IN (SELECT slug FROM wiki_pages)').all() as any[];
  const allSlugs = db.prepare('SELECT slug FROM wiki_pages').all().map((r: any) => r.slug);
  const getDist = (a: string, b: string) => {
    const m = Array(b.length+1).fill(null).map(()=>Array(a.length+1).fill(null));
    for (let i=0; i<=a.length; i++) m[0][i]=i; for (let j=0; j<=b.length; j++) m[j][0]=j;
    for (let j=1; j<=b.length; j++) for (let i=1; i<=a.length; i++) { const ind = a[i-1]===b[j-1]?0:1; m[j][i]=Math.min(m[j][i-1]+1, m[j-1][i]+1, m[j-1][i-1]+ind); }
    return m[b.length][a.length];
  };
  for (const bl of broken) {
    let bestDist = Infinity; let bestSlugs: string[] = [];
    for (const s of allSlugs) { const d = getDist(bl.target_slug.toLowerCase(), s.toLowerCase()); if (d < bestDist) { bestDist = d; bestSlugs = [s]; } else if (d === bestDist) { bestSlugs.push(s); } }
    if (bestDist <= 3 && bestSlugs.length === 1) repairs.push({ source: bl.source_slug, oldT: bl.target_slug, newT: bestSlugs[0] });
  }
  for (const r of repairs) {
    const fp = path.join(PATHS.wiki, `${r.source}.md`);
    if (fs.existsSync(fp)) { let c = fs.readFileSync(fp, 'utf-8'); c = c.replace(new RegExp(`\\[\\[${r.oldT}\\|?.*?\\]\\]`, 'g'), `[[${r.newT}|${r.newT}]]`); fs.writeFileSync(fp, c); report.push(`- Repaired [[${r.oldT}]] -> [[${r.newT}]] in [[${r.source}]]`); logs.push(`Fixed link ${r.oldT} -> ${r.newT} in ${r.source}`); }
  }
  let hasChunks = (db.prepare('SELECT COUNT(*) as count FROM chunks WHERE embedding IS NOT NULL').get() as any).count > 0;
  if (hasChunks) {
    const truth = db.prepare(`SELECT page_slug, embedding FROM chunks WHERE chunk_type = 'wiki_truth' AND embedding IS NOT NULL`).all() as any[];
    const merges = [];
    for (let i=0; i<truth.length; i++) for (let j=i+1; j<truth.length; j++) {
      if (truth[i].page_slug !== truth[j].page_slug) {
        const s = cosine_sim(truth[i].embedding, truth[j].embedding);
        if (s > 0.95) merges.push({ a: truth[i].page_slug, b: truth[j].page_slug, s });
      }
    }
    if (merges.length > 0) { report.push('\n## Merge Candidates'); merges.forEach(m => report.push(`- [[${m.a}]] and [[${m.b}]] (sim: ${m.s.toFixed(2)})`)); }
  }
  internalRebuildIndex(); internalRebuildMarkdownIndex(); internalRebuildTimeline();
  if (logs.length > 0) { const logPath = path.join(PATHS.meta, 'log.md'); const ds = new Date().toISOString().split('T')[0]; for (const l of logs) { fs.appendFileSync(logPath, `- ${ds}: ${l}\n`); db.prepare('INSERT INTO operations_log (operation, details) VALUES (?, ?)').run('dream', l); } }
  fs.writeFileSync(path.join(PATHS.meta, 'dream-report.md'), report.join('\n')); console.log('✅ Dream complete.');
});

program.command('embed').description('Embed brain content').option('--all', 'Re-embed everything').argument('[slug]', 'Specific page to embed').action(async (slug, options) => {
  console.log('🧠 Generating Embeddings...');
  const ollamaCheck = await fetch('http://localhost:11434/api/tags').catch(() => null);
  if (!ollamaCheck || !ollamaCheck.ok) { console.error('❌ Ollama not running at localhost:11434'); process.exit(1); }
  if (options.all) { db.run('DELETE FROM chunks'); } 
  else if (slug) db.prepare('DELETE FROM chunks WHERE page_slug = ? AND owner_type = "wiki"').run(slug);
  const res = await embedBrain(slug);
  console.log(`\n✅ Embedded ${res.count} chunks.`);
});

const page = program.command('page');
page.command('create').argument('<slug>', 'Slug').argument('<title>', 'Title').option('-c, --content <content>', 'Truth', '').option('-t, --tags <tags>', 'Tags', '').option('-a, --aliases <aliases>', 'Aliases', '').option('-y, --type <type>', 'Type', 'concept').option('-f, --confidence <confidence>', 'Confidence', '0.5').option('-m, --mentions <mentions>', 'Mentions', '1').option('-r, --tier <tier>', 'Tier', '3').option('-s, --source <raw_id>', 'Raw source').option('-k, --claim <claim>', 'Claim').action((slug, title, options) => {
  const filePath = path.join(PATHS.wiki, `${slug}.md`);
  if (fs.existsSync(filePath)) { console.error(`❌ Exists`); process.exit(1); }
  const tags = options.tags ? options.tags.split(',').map((t: string) => t.trim()) : [];
  const aliases = options.aliases ? options.aliases.split(',').map((a: string) => a.trim()) : [];
  const body = ['---', yaml.dump({ title, slug, aliases, tags, type: options.type, confidence: Number(options.confidence), mentions: Number(options.mentions), tier: Number(options.tier), status: 'active', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), source_count: options.source ? 1 : 0 }).trim(), '---', '', `# ${title}`, '', '## Summary', options.content, '', '## Cross-References', '', '---', '<!-- TIMELINE: append-only below this line -->'].join('\n');
  fs.writeFileSync(filePath, body);
  if (options.source && options.claim) { internalRebuildIndex(); internalRecordClaim(slug, options.claim, Number(options.source)); }
  console.log(`✅ Created ${slug}`);
});

page.command('update').argument('<slug>', 'Slug').argument('<content>', 'Content').option('-t, --title <title>', 'Title').option('-s, --source <raw_id>', 'Raw source').option('-k, --claim <claim>', 'Claim').option('--section <section>', 'Section', 'truth').action((slug, content, options) => {
  const filePath = path.join(PATHS.wiki, `${slug}.md`);
  if (!fs.existsSync(filePath)) { console.error(`❌ Not found`); process.exit(1); }
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const parts = fileContent.split('<!-- TIMELINE: append-only below this line -->');
  const headerAndTruth = parts[0];
  const existingTimeline = parts[1] || '';
  if (options.section === 'truth') {
    if (content.includes('<!-- TIMELINE: append-only below this line -->')) {
      const newTimeline = content.split('<!-- TIMELINE: append-only below this line -->')[1];
      if (existingTimeline.trim() && !newTimeline.includes(existingTimeline.trim())) { console.error(`❌ ERR: Timeline wiped.`); process.exit(1); }
      fs.writeFileSync(filePath, content);
    } else {
      const summarySplit = headerAndTruth.split('## Summary');
      const start = summarySplit[0];
      const rest = summarySplit.slice(1).join('## Summary');
      const afterSummary = rest.includes('## Cross-References') ? '## Cross-References' + rest.split('## Cross-References').slice(1).join('## Cross-References') : '## Cross-References';
      fs.writeFileSync(filePath, start + '## Summary\n' + content + '\n\n' + afterSummary + '\n---\n<!-- TIMELINE: append-only below this line -->' + existingTimeline);
    }
  } else {
    fs.writeFileSync(filePath, headerAndTruth + '<!-- TIMELINE: append-only below this line -->' + existingTimeline + '\n' + content);
  }
  if (options.source && options.claim) internalRecordClaim(slug, options.claim, Number(options.source));
  console.log(`✅ Updated ${slug}`);
});

const indexCmd = program.command('index');
indexCmd.command('rebuild').action(() => internalRebuildIndex());
indexCmd.command('rebuild-markdown').action(() => internalRebuildMarkdownIndex());

const timelineCmd = program.command('timeline');
timelineCmd.command('rebuild').action(() => internalRebuildTimeline());

program.parse();
