import { addToBrain } from '../src/core.ts';
import * as fs from 'fs';
import * as path from 'path';

const manualPath = path.resolve('how-mm-works.md');
if (fs.existsSync(manualPath)) {
  const content = fs.readFileSync(manualPath, 'utf-8');
  const res = addToBrain(content, 'How Mnemonic51 Works', {
    sourceType: 'docs',
    project: 'mm'
  });
  console.log(`✅ ${res.status}: ${res.path}`);
} else {
  console.error('❌ manual file not found');
}
