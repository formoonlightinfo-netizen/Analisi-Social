import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'contenuti.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS contents (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    processed_path TEXT,
    duration_sec REAL,
    caption TEXT DEFAULT '',
    category TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending_analysis',
    hook_type TEXT,
    text_layering TEXT,
    image_text_coherence TEXT,
    coherence_score INTEGER,
    format TEXT,
    editing_style TEXT,
    pacing TEXT,
    analysis_notes TEXT,
    analysis_raw TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    analyzed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS platform_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok')),
    url TEXT,
    published_at TEXT,
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,
    reposts INTEGER,
    reach INTEGER,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(content_id, platform)
  );
`);

// Migrazioni leggere: aggiunge colonne mancanti a database già esistenti
// (CREATE TABLE IF NOT EXISTS non tocca le tabelle già create in precedenza).
const contentsColumns = db.prepare("PRAGMA table_info(contents)").all().map((c) => c.name);
if (!contentsColumns.includes('content_type')) {
  db.exec("ALTER TABLE contents ADD COLUMN content_type TEXT NOT NULL DEFAULT 'video'");
}
if (!contentsColumns.includes('thumbnail_ext')) {
  db.exec("ALTER TABLE contents ADD COLUMN thumbnail_ext TEXT NOT NULL DEFAULT '.jpg'");
}

export function insertContent(content) {
  const stmt = db.prepare(`
    INSERT INTO contents (
      id, filename, processed_path, duration_sec, status, content_type, thumbnail_ext,
      hook_type, text_layering, image_text_coherence, coherence_score,
      format, editing_style, pacing, analysis_notes, analysis_raw, analyzed_at
    ) VALUES (
      @id, @filename, @processed_path, @duration_sec, @status, @content_type, @thumbnail_ext,
      @hook_type, @text_layering, @image_text_coherence, @coherence_score,
      @format, @editing_style, @pacing, @analysis_notes, @analysis_raw, @analyzed_at
    )
  `);
  stmt.run({ content_type: 'video', thumbnail_ext: '.jpg', ...content });
}

export function getContentById(id) {
  const content = db.prepare('SELECT * FROM contents WHERE id = ?').get(id);
  if (!content) return null;
  content.metrics = db
    .prepare('SELECT * FROM platform_metrics WHERE content_id = ?')
    .all(id);
  return content;
}

export function listContents() {
  const contents = db.prepare('SELECT * FROM contents ORDER BY created_at DESC').all();
  const metricsStmt = db.prepare('SELECT * FROM platform_metrics WHERE content_id = ?');
  for (const c of contents) {
    c.metrics = metricsStmt.all(c.id);
  }
  return contents;
}

export function updateContentFields(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE contents SET ${setClause} WHERE id = @id`).run({ ...fields, id });
}

export function upsertPlatformMetrics(contentId, platform, metrics) {
  const stmt = db.prepare(`
    INSERT INTO platform_metrics (
      content_id, platform, url, published_at, likes, comments, shares, saves, reposts, reach, updated_at
    ) VALUES (
      @content_id, @platform, @url, @published_at, @likes, @comments, @shares, @saves, @reposts, @reach, datetime('now')
    )
    ON CONFLICT(content_id, platform) DO UPDATE SET
      url = excluded.url,
      published_at = excluded.published_at,
      likes = excluded.likes,
      comments = excluded.comments,
      shares = excluded.shares,
      saves = excluded.saves,
      reposts = excluded.reposts,
      reach = excluded.reach,
      updated_at = datetime('now')
  `);
  stmt.run({
    content_id: contentId,
    platform,
    url: metrics.url ?? null,
    published_at: metrics.published_at ?? null,
    likes: metrics.likes ?? 0,
    comments: metrics.comments ?? 0,
    shares: metrics.shares ?? 0,
    saves: metrics.saves ?? 0,
    reposts: metrics.reposts ?? null,
    reach: metrics.reach ?? null,
  });
}

export function contentExistsByFilename(filename) {
  return db.prepare('SELECT id FROM contents WHERE filename = ?').get(filename);
}

export function deleteContent(id) {
  db.prepare('DELETE FROM contents WHERE id = ?').run(id);
}

export default db;
