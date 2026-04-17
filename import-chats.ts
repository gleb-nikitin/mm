import * as fs from 'fs';
import * as path from 'path';
import { Database } from 'bun:sqlite';

const dbFile = path.join('meta', 'brain.db');
const db = new Database(dbFile);

async function importChat(filePath: string, chatName: string) {
  console.log(`📥 Importing chat: ${chatName}`);
  const content = fs.readFileSync(filePath, 'utf-8');
  
  // Split by "## " which indicates a date section in this format
  const sections = content.split(/\n## /);
  
  for (const section of sections) {
    if (section.trim().startsWith('# Telegram Chat History')) continue;
    
    const lines = section.split('\n');
    const date = lines[0].trim();
    const body = lines.slice(1).join('\n').trim();
    
    if (!body) continue;

    const title = `Chat: ${chatName} (${date})`;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rawFilename = `${timestamp}-chat.md`;
    const rawPath = path.join('raw', rawFilename);
    
    const fileContent = `# ${title}\n\nSource: ${chatName}\nDate: ${date}\n\n---\n\n${body}`;
    
    fs.writeFileSync(rawPath, fileContent);
    
    db.prepare('INSERT INTO entries (type, title, content, source_path) VALUES (?, ?, ?, ?)')
      .run('raw', title, body, rawPath);
    
    console.log(`  ✅ Added entry for ${date}`);
  }
}

const chatPath = "/Users/glebnikitin/disk/human/telegram/chats/та-самая-тани/messages.md";
if (fs.existsSync(chatPath)) {
  await importChat(chatPath, "Та самая Тани");
} else {
  console.error("Chat file not found!");
}
