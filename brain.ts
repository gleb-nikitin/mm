import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { Database } from 'bun:sqlite';
import { spawnSync, execFileSync } from 'child_process';
import * as os from 'os';
import yaml from 'js-yaml';

const program = new Command();
const dbFile = path.join('meta', 'brain.db');

// Initialize Database
const db = new Database(dbFile);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA foreign_keys = ON;');

function initDb() {
  db.run(`
    CREATE TABLE IF NOT EXISTS raw_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      content TEXT NOT NULL,
      source_path TEXT UNIQUE,
      hash TEXT,
      processed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS wiki_pages (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      tags TEXT,
      status TEXT,
      source_count INTEGER DEFAULT 0,
      summary TEXT,
      created_at DATETIME,
      updated_at DATETIME
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS wiki_aliases (
      alias TEXT PRIMARY KEY,
      slug TEXT,
      FOREIGN KEY(slug) REFERENCES wiki_pages(slug) ON DELETE CASCADE
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS wiki_links (
      source_slug TEXT,
      target_slug TEXT,
      PRIMARY KEY (source_slug, target_slug),
      FOREIGN KEY(source_slug) REFERENCES wiki_pages(slug) ON DELETE CASCADE,
      FOREIGN KEY(target_slug) REFERENCES wiki_pages(slug) ON DELETE CASCADE
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS operations_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      operation TEXT,
      details TEXT
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wiki_slug TEXT NOT NULL,
      claim_text TEXT NOT NULL,
      FOREIGN KEY(wiki_slug) REFERENCES wiki_pages(slug) ON DELETE CASCADE
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS claim_sources (
      claim_id INTEGER NOT NULL,
      raw_id INTEGER NOT NULL,
      PRIMARY KEY (claim_id, raw_id),
      FOREIGN KEY(claim_id) REFERENCES claims(id) ON DELETE CASCADE,
      FOREIGN KEY(raw_id) REFERENCES raw_entries(id) ON DELETE CASCADE
    );
  `);

  try {
    db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(slug, title, content, tags);`);
  } catch (e) {}
}

initDb();

// --- Internal Deterministic Logic ---

function getHash(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

function internalRebuildIndex() {
  console.log('🏗️ Syncing search and relational index...');
  
  // 1. Sync Raw Entries
  const rawFiles = fs.readdirSync('raw').filter(f => f.endsWith('.md'));
  const foundRawPaths = new Set<string>();
  
  for (const file of rawFiles) {
    const filePath = path.join('raw', file);
    foundRawPaths.add(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const titleMatch = content.match(/^# (.*)/);
    const title = titleMatch ? titleMatch[1] : file;
    const hash = getHash(content);

    db.prepare(`
      INSERT INTO raw_entries (title, content, source_path, hash)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(source_path) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        hash = excluded.hash
    `).run(title, content, filePath, hash);
  }

  // Sweep missing raw entries
  const allRaw = db.prepare('SELECT id, source_path FROM raw_entries').all() as any[];
  for (const r of allRaw) {
    if (!foundRawPaths.has(r.source_path)) {
      db.prepare('DELETE FROM raw_entries WHERE id = ?').run(r.id);
    }
  }

  // 2. Sync Wiki Pages
  const wikiFiles = fs.readdirSync('wiki').filter(f => f.endsWith('.md'));
  const foundSlugs = new Set<string>();
  const allLinks: { source: string, target: string }[] = [];

  // Clear transient junction tables
  db.run('DELETE FROM wiki_aliases');
  db.run('DELETE FROM wiki_links');
  db.run('DELETE FROM search_index');

  for (const file of wikiFiles) {
    const slug = file.replace('.md', '');
    foundSlugs.add(slug);
    const filePath = path.join('wiki', file);
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    
    try {
      const parts = fileContent.split('---');
      if (parts.length >= 3) {
        const frontmatter = yaml.load(parts[1]) as any;
        const body = parts.slice(2).join('---');
        
        const summaryMatch = body.match(/## Summary\n\n(.*?)\n/s);
        const summary = summaryMatch ? summaryMatch[1].trim() : '';

        db.prepare(`
          INSERT INTO wiki_pages (slug, title, tags, status, source_count, summary, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(slug) DO UPDATE SET
            title = excluded.title,
            tags = excluded.tags,
            status = excluded.status,
            source_count = excluded.source_count,
            summary = excluded.summary,
            updated_at = excluded.updated_at
        `).run(
          slug,
          String(frontmatter.title || slug),
          JSON.stringify(frontmatter.tags || []),
          String(frontmatter.status || 'active'),
          Number(frontmatter.source_count || 0),
          summary,
          String(frontmatter.created_at || new Date().toISOString()),
          String(frontmatter.updated_at || new Date().toISOString())
        );

        db.prepare('INSERT INTO search_index (slug, title, content, tags) VALUES (?, ?, ?, ?)').run(slug, frontmatter.title || slug, fileContent, (frontmatter.tags || []).join(', '));

        if (frontmatter.aliases) {
          for (const alias of frontmatter.aliases) {
            if (alias) db.prepare('INSERT OR IGNORE INTO wiki_aliases (alias, slug) VALUES (?, ?)').run(alias, slug);
          }
        }

        const links = body.match(/\[\[(.*?)\]\]/g);
        if (links) {
          for (const link of links) {
            const target = link.slice(2, -2).split('|')[0];
            allLinks.push({ source: slug, target });
          }
        }
      }
    } catch (e) {
      console.error(`❌ Failed to parse wiki page ${file}:`, e);
    }
  }

  // Sweep missing wiki pages (this WILL cascade to claims, which is correct if file is gone)
  const allPages = db.prepare('SELECT slug FROM wiki_pages').all() as any[];
  for (const p of allPages) {
    if (!foundSlugs.has(p.slug)) {
      db.prepare('DELETE FROM wiki_pages WHERE slug = ?').run(p.slug);
    }
  }

  // Restore links
  for (const { source, target } of allLinks) {
    try {
      db.prepare('INSERT OR IGNORE INTO wiki_links (source_slug, target_slug) VALUES (?, ?)').run(source, target);
    } catch (e) {
      console.warn(`⚠️ Could not index link [[${source}]] -> [[${target}]]: target missing.`);
    }
  }
  console.log(`✅ Sync complete: ${rawFiles.length} raw, ${wikiFiles.length} wiki entries.`);
}

function internalRebuildMarkdownIndex() {
  console.log('🏗️ Generating meta/index.md...');
  const pages = db.prepare('SELECT slug, title, tags, summary FROM wiki_pages ORDER BY title ASC').all() as any[];
  
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
    for (const p of pgs) {
      content += `- [[${p.slug}|${p.title}]]: ${p.summary || 'No summary available.'}\n`;
    }
    content += "\n";
  }

  fs.writeFileSync(path.join('meta', 'index.md'), content);
  console.log('✅ Generated meta/index.md');
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
  fs.writeFileSync(path.join('meta', 'timeline.md'), timelineContent);
  console.log('✅ Timeline generated in meta/timeline.md');
}

function runGemini(prompt: string, yolo: boolean = false) {
  const args = yolo ? ['--yolo', `-p=${prompt}`] : [`-p=${prompt}`];
  try {
    execFileSync('gemini', args, { stdio: 'inherit' });
    return { status: 0 };
  } catch (e: any) {
    return { status: (e as any).status || 1 };
  }
}

function slugify(text: string): string {
  return text.trim().replace(/\s+/g, '_');
}

// --- CLI Definitions ---

program
  .name('brain')
  .description('A persistent AI knowledge base for compounding context.')
  .version('0.3.3');

program
  .command('add')
  .description('Add a new raw snippet to the Brain')
  .argument('<content>', 'The content to add')
  .option('-t, --title <title>', 'A title for this snippet')
  .action((content, options) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${timestamp}.md`;
    const filePath = path.join('raw', filename);
    const title = options.title || `Entry ${timestamp}`;
    const hash = getHash(content);
    const fileContent = `# ${title}\n\nAdded: ${new Date().toLocaleString()}\n\n---\n\n${content}`;
    fs.writeFileSync(filePath, fileContent);
    try {
      db.prepare('INSERT INTO raw_entries (title, content, source_path, hash) VALUES (?, ?, ?, ?)')
        .run(title, content, filePath, hash);
      console.log(`✅ Saved to ${filePath} and indexed.`);
    } catch (e: any) {
      console.log(`⚠️ Entry already exists.`);
    }
  });

program
  .command('queue')
  .description('List unprocessed raw entries')
  .action(() => {
    const unprocessed = db.prepare('SELECT id, title, created_at FROM raw_entries WHERE processed = 0').all();
    if (unprocessed.length === 0) console.log('✨ No unprocessed entries.'); else console.table(unprocessed);
  });

program
  .command('search')
  .description('Search the Brain (Wiki and Raw)')
  .argument('<query>', 'Search term')
  .action((query) => {
    console.log(`🔍 Searching for: "${query}"...`);
    const results = db.prepare('SELECT slug, title FROM search_index WHERE search_index MATCH ?').all(`"${query}"`) as any[];
    if (results.length > 0) {
      console.log('\n--- Search Results ---');
      results.forEach(r => console.log(`[[${r.slug}|${r.title}]]`));
    } else {
      console.log('No matches found.');
    }
  });

program
  .command('read')
  .description('Read a wiki page by slug')
  .argument('<slug>', 'The slug of the page')
  .action((slug) => {
    const filePath = path.join('wiki', `${slug}.md`);
    if (fs.existsSync(filePath)) console.log(fs.readFileSync(filePath, 'utf-8'));
    else console.error(`❌ Page not found: ${slug}`);
  });

program
  .command('process')
  .description('Process unprocessed raw entries using the ingest skill')
  .action(async () => {
    const unprocessed = db.prepare('SELECT * FROM raw_entries WHERE processed = 0').all() as any[];
    if (unprocessed.length === 0) { console.log('✨ No new raw entries to process.'); return; }
    const ingestSkill = fs.readFileSync(path.join('meta', 'skills', 'ingest.md'), 'utf-8');
    const schema = fs.readFileSync(path.join('meta', 'schema.md'), 'utf-8');

    for (const entry of unprocessed) {
      console.log(`🧠 Processing: ${entry.title}`);
      const initialClaims = db.prepare('SELECT COUNT(*) as count FROM claim_sources WHERE raw_id = ?').get(entry.id) as any;
      const prompt = `${ingestSkill}\n\n# CONTEXT\n\n## SCHEMA\n${schema}\n\n## RAW ENTRY\nID: ${entry.id}\nFile: ${entry.source_path}\nContent:\n${entry.content}\n\n# INSTRUCTIONS\nYou are an AI Librarian. Use the 'bun brain.ts' CLI tools to search, read, create, or update wiki pages.\nAlways record provenance using 'bun brain.ts claim-add <slug> <claim> <raw_id>'.\nWhen finished, I will automatically refresh the index and timeline.`;
      
      const result = runGemini(prompt, true);
      
      if (result.status === 0) {
        const finalClaims = db.prepare('SELECT COUNT(*) as count FROM claim_sources WHERE raw_id = ?').get(entry.id) as any;
        if (finalClaims.count > initialClaims.count) {
          db.prepare('UPDATE raw_entries SET processed = 1 WHERE id = ?').run(entry.id);
          console.log(`✅ Processed ${entry.title} (${finalClaims.count - initialClaims.count} claims added)`);
        } else {
          console.warn(`⚠️ Warning: No claims added. Marking processed anyway.`);
          db.prepare('UPDATE raw_entries SET processed = 1 WHERE id = ?').run(entry.id);
        }
        console.log('🔄 Refreshing metadata...');
        internalRebuildIndex();
        internalRebuildMarkdownIndex();
        internalRebuildTimeline();
        const logMsg = `Processed raw entry ${entry.id} ("${entry.title}")`;
        db.prepare('INSERT INTO operations_log (operation, details) VALUES (?, ?)').run('process', logMsg);
        fs.appendFileSync(path.join('meta', 'log.md'), `- ${new Date().toISOString().split('T')[0]}: ${logMsg}\n`);
      } else {
        console.error(`❌ Failed to process ${entry.title}`);
      }
    }
  });

program
  .command('lint')
  .description('Audit the brain for health and structural issues')
  .action(async () => {
    console.log('🧹 Linting the Brain...');
    const wikiFiles = fs.readdirSync('wiki').filter(f => f.endsWith('.md'));
    const wikiContents = wikiFiles.map(f => `File: ${f}\n---\n${fs.readFileSync(path.join('wiki', f), 'utf-8')}\n---`).join('\n\n');
    const lintSkill = fs.readFileSync(path.join('meta', 'skills', 'lint.md'), 'utf-8');
    const schema = fs.readFileSync(path.join('meta', 'schema.md'), 'utf-8');
    const prompt = `${lintSkill}\n\n# CONTEXT\n\n## SCHEMA\n${schema}\n\n## WIKI CONTENT\n${wikiContents}\n\n# INSTRUCTIONS\nProduce a structured report on the health of the wiki. Do NOT modify files.`;
    runGemini(prompt);
  });

program
  .command('query')
  .description('Answer a question by searching the brain first')
  .argument('<question>', 'The user question')
  .action(async (question) => {
    console.log(`🧠 Querying the Brain: "${question}"...`);
    const searchResults = db.prepare('SELECT slug, title FROM search_index WHERE search_index MATCH ? LIMIT 10').all(`"${question}"`) as any[];
    let context = "";
    if (searchResults.length > 0) {
      for (const res of searchResults) {
        const filePath = path.join('wiki', `${res.slug}.md`);
        if (fs.existsSync(filePath)) context += `### [[${res.slug}|${res.title}]]\n${fs.readFileSync(filePath, 'utf-8')}\n---\n`;
      }
    }
    const querySkill = fs.readFileSync(path.join('meta', 'skills', 'query.md'), 'utf-8');
    const schema = fs.readFileSync(path.join('meta', 'schema.md'), 'utf-8');
    const prompt = `${querySkill}\n\n# CONTEXT\n\n## SCHEMA\n${schema}\n\n${context}\n\n# USER QUESTION\n${question}\n\n# INSTRUCTIONS\nAnswer from brain context.`;
    runGemini(prompt);
  });

program
  .command('maintain')
  .description('Perform routine brain maintenance')
  .action(async () => {
    console.log('🔧 Starting Brain Maintenance...');
    const wikiFiles = fs.readdirSync('wiki').filter(f => f.endsWith('.md'));
    const wikiContents = wikiFiles.map(f => `File: ${f}\n---\n${fs.readFileSync(path.join('wiki', f), 'utf-8')}\n---`).join('\n\n');
    const log = fs.readFileSync(path.join('meta', 'log.md'), 'utf-8');
    const schema = fs.readFileSync(path.join('meta', 'schema.md'), 'utf-8');
    const maintainSkill = fs.readFileSync(path.join('meta', 'skills', 'maintain.md'), 'utf-8');
    const prompt = `${maintainSkill}\n\n# CONTEXT\n\n## SCHEMA\n${schema}\n\n## RECENT LOG\n${log}\n\n## WIKI CONTENT\n${wikiContents}\n\n# INSTRUCTIONS\nPerform maintenance.`;
    
    const result = runGemini(prompt, true);
    if (result.status === 0) {
      console.log('✅ Maintenance complete. Refreshing metadata...');
      internalRebuildIndex();
      internalRebuildMarkdownIndex();
      internalRebuildTimeline();
      const logMsg = `Performed routine brain maintenance`;
      db.prepare('INSERT INTO operations_log (operation, details) VALUES (?, ?)').run('maintain', logMsg);
      fs.appendFileSync(path.join('meta', 'log.md'), `- ${new Date().toISOString().split('T')[0]}: ${logMsg}\n`);
    } else {
      console.error(`❌ Maintenance pass failed.`);
    }
  });

program
  .command('claim-add')
  .description('Record a claim and its source')
  .argument('<slug>', 'Wiki slug')
  .argument('<claim>', 'Claim text')
  .argument('<raw_id>', 'Raw entry ID')
  .action((slug, claim, raw_id) => {
    const pageExists = db.prepare('SELECT 1 FROM wiki_pages WHERE slug = ?').get(slug);
    if (!pageExists) { console.error(`❌ Page not found: ${slug}`); process.exit(1); }
    const rawExists = db.prepare('SELECT 1 FROM raw_entries WHERE id = ?').get(raw_id);
    if (!rawExists) { console.error(`❌ Raw entry not found: ${raw_id}`); process.exit(1); }
    try {
      const res = db.prepare('INSERT INTO claims (wiki_slug, claim_text) VALUES (?, ?)').run(slug, claim);
      const claim_id = res.lastInsertRowid;
      db.prepare('INSERT INTO claim_sources (claim_id, raw_id) VALUES (?, ?)').run(claim_id, raw_id);
      console.log(`✅ Recorded claim for ${slug}`);
    } catch (e: any) {
      console.error(`❌ Failed to record claim: ${e.message}`);
      process.exit(1);
    }
  });

// --- Subcommands ---

const page = program.command('page').description('Wiki page operations');
page
  .command('create')
  .argument('<slug>', 'Slug')
  .argument('<title>', 'Title')
  .option('-c, --content <content>', 'Content', '')
  .option('-t, --tags <tags>', 'Tags', '')
  .option('-a, --aliases <aliases>', 'Aliases', '')
  .action((slug, title, options) => {
    const filePath = path.join('wiki', `${slug}.md`);
    if (fs.existsSync(filePath)) { console.error(`❌ Page exists`); process.exit(1); }
    const tags = options.tags ? options.tags.split(',').map((t: string) => t.trim()) : [];
    const aliases = options.aliases ? options.aliases.split(',').map((a: string) => a.trim()) : [];
    const createdAt = new Date().toISOString();
    const frontmatter = ['---', `title: ${title}`, `slug: ${slug}`, `aliases: [${aliases.join(', ')}]`, `tags: [${tags.join(', ')}]`, 'status: active', `created_at: ${createdAt}`, `updated_at: ${createdAt}`, 'source_count: 1', '---', '', `# ${title}`, '', options.content].join('\n');
    fs.writeFileSync(filePath, frontmatter);
    console.log(`✅ Created ${slug}`);
  });

page
  .command('update')
  .argument('<slug>', 'Slug')
  .argument('<content>', 'Content')
  .option('-t, --title <title>', 'Title')
  .action((slug, content, options) => {
    const filePath = path.join('wiki', `${slug}.md`);
    if (!fs.existsSync(filePath)) { console.error(`❌ Not found`); process.exit(1); }
    fs.writeFileSync(filePath, content);
    console.log(`✅ Updated ${slug}`);
  });

const indexCmd = program.command('index').description('Index operations');
indexCmd.command('rebuild').action(() => internalRebuildIndex());
indexCmd.command('rebuild-markdown').action(() => internalRebuildMarkdownIndex());

const timelineCmd = program.command('timeline').description('Timeline operations');
timelineCmd.command('rebuild').action(() => internalRebuildTimeline());

const linksCmd = program.command('links').description('Link operations');
linksCmd.command('check').action(() => {
    console.log('🔗 Checking links...');
    const l = db.prepare('SELECT source_slug, target_slug FROM wiki_links').all() as any[];
    let broken = 0;
    for (const link of l) {
      if (!db.prepare('SELECT 1 FROM wiki_pages WHERE slug = ?').get(link.target_slug)) {
        console.warn(`⚠️ Broken: [[${link.source_slug}]] -> [[${link.target_slug}]]`);
        broken++;
      }
    }
    if (broken === 0) console.log('✅ Healthy.'); else console.log(`❌ Found ${broken} broken.`);
});

program.parse();
