import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export async function getDurationSeconds(videoPath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    videoPath,
  ]);
  const duration = parseFloat(stdout.trim());
  return Number.isFinite(duration) ? duration : null;
}

/**
 * Estrae un fotogramma al secondo dal video in una cartella dedicata.
 * Ritorna la lista ordinata dei path dei frame estratti.
 */
export async function extractFrames(videoPath, outputDir, { fps = 1, maxFrames = 40 } = {}) {
  fs.mkdirSync(outputDir, { recursive: true });
  const pattern = path.join(outputDir, 'frame-%04d.jpg');

  await execFileAsync('ffmpeg', [
    '-y',
    '-i', videoPath,
    '-vf', `fps=${fps}`,
    '-frames:v', String(maxFrames),
    '-q:v', '3',
    pattern,
  ]);

  return fs
    .readdirSync(outputDir)
    .filter((f) => f.startsWith('frame-') && f.endsWith('.jpg'))
    .sort()
    .map((f) => path.join(outputDir, f));
}

export function cleanupFrames(outputDir) {
  fs.rmSync(outputDir, { recursive: true, force: true });
}
