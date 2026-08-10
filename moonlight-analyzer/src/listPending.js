import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { listContents } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRAMES_DIR = path.join(__dirname, '..', 'frames');

const pending = listContents()
  .filter((c) => c.status === 'pending_analysis')
  .map((c) => {
    const framesDir = path.join(FRAMES_DIR, c.id);
    return {
      id: c.id,
      filename: c.filename,
      durationSec: c.duration_sec,
      framesDir,
      framesAvailable: fs.existsSync(framesDir),
    };
  });

console.log(JSON.stringify(pending, null, 2));
