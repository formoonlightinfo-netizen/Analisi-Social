import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { insertContent } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PROCESSED_DIR = path.join(ROOT, 'processed');
const THUMBNAILS_DIR = path.join(ROOT, 'public', 'thumbnails');

function makeContentId() {
  return `carosello-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Prepara un carosello (post con più immagini) appena caricato: sposta le
 * immagini in processed/<id>/ (restano lì per sempre, sono il contenuto
 * stesso — non vengono ripulite dopo l'analisi come i fotogrammi dei video),
 * crea la miniatura dalla prima immagine e una riga "pending_analysis" nel
 * database. Nessuna estrazione ffmpeg: le immagini caricate sono già i
 * "fotogrammi" da analizzare.
 * @param {{ path: string, originalname: string }[]} uploadedFiles - file temporanei salvati da multer, in ordine
 * @returns {Promise<{ id: string, imagesDir: string, imageCount: number }>}
 */
export async function prepareCarousel(uploadedFiles) {
  if (uploadedFiles.length === 0) {
    throw new Error('Nessuna immagine ricevuta.');
  }

  const id = makeContentId();
  const imagesDir = path.join(PROCESSED_DIR, id);
  fs.mkdirSync(imagesDir, { recursive: true });

  const imagePaths = uploadedFiles.map((file, index) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const dest = path.join(imagesDir, `slide-${String(index + 1).padStart(2, '0')}${ext}`);
    fs.renameSync(file.path, dest);
    return dest;
  });

  const thumbnailExt = path.extname(imagePaths[0]).toLowerCase() || '.jpg';
  fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
  fs.copyFileSync(imagePaths[0], path.join(THUMBNAILS_DIR, `${id}${thumbnailExt}`));

  insertContent({
    id,
    filename: `Carosello (${imagePaths.length} immagini)`,
    processed_path: imagesDir,
    duration_sec: null,
    status: 'pending_analysis',
    content_type: 'carousel',
    thumbnail_ext: thumbnailExt,
    hook_type: null,
    text_layering: null,
    image_text_coherence: null,
    coherence_score: null,
    format: 'slideshow',
    editing_style: null,
    pacing: null,
    analysis_notes: null,
    analysis_raw: null,
    analyzed_at: null,
  });

  return { id, imagesDir, imageCount: imagePaths.length };
}
