import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getContentById, updateContentFields } from './db.js';
import { cleanupFrames } from './ffmpeg.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRAMES_DIR = path.join(__dirname, '..', 'frames');

const VALID_HOOK_TYPES = ['loop_aperto', 'rivelazione_diretta', 'domanda', 'testimonianza', 'contro_affermazione', 'altro'];
const VALID_TEXT_LAYERING = ['progressivo', 'tutto_insieme'];
const VALID_FORMATS = ['parlato_in_camera', 'voiceover_testo', 'montaggio_multiclip', 'slideshow', 'altro'];

/**
 * Salva l'analisi visiva (prodotta da Claude Code guardando i fotogrammi) per
 * un contenuto, e ripulisce i fotogrammi temporanei. Vedi CLAUDE.md per lo
 * schema atteso dell'oggetto `analysis`.
 * @param {string} id
 * @param {object} analysis
 */
export function saveAnalysis(id, analysis) {
  const content = getContentById(id);
  if (!content) throw new Error(`Contenuto "${id}" non trovato.`);

  if (analysis.hook_type && !VALID_HOOK_TYPES.includes(analysis.hook_type)) {
    throw new Error(`hook_type non valido: ${analysis.hook_type}`);
  }
  if (analysis.text_layering && !VALID_TEXT_LAYERING.includes(analysis.text_layering)) {
    throw new Error(`text_layering non valido: ${analysis.text_layering}`);
  }
  if (analysis.format && !VALID_FORMATS.includes(analysis.format)) {
    throw new Error(`format non valido: ${analysis.format}`);
  }

  updateContentFields(id, {
    status: 'analyzed',
    hook_type: analysis.hook_type ?? null,
    text_layering: analysis.text_layering ?? null,
    image_text_coherence: analysis.image_text_coherence ?? null,
    coherence_score: analysis.coherence_score ?? null,
    format: analysis.format ?? null,
    editing_style: analysis.editing_style ? JSON.stringify(analysis.editing_style) : null,
    pacing: analysis.pacing ?? null,
    analysis_notes: analysis.notes ?? null,
    analysis_raw: JSON.stringify(analysis),
    analyzed_at: new Date().toISOString(),
  });

  cleanupFrames(path.join(FRAMES_DIR, id));
}

// Uso da riga di comando (chiamato da Claude Code dopo aver guardato i fotogrammi):
//   node src/saveAnalysis.js <id> '<json compatto su una riga>'
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , id, jsonArg] = process.argv;
  if (!id || !jsonArg) {
    console.error('Uso: node src/saveAnalysis.js <id> \'<json>\'');
    process.exit(1);
  }
  try {
    const analysis = JSON.parse(jsonArg);
    saveAnalysis(id, analysis);
    console.log(`✔ Analisi salvata per ${id}`);
  } catch (err) {
    console.error(`✘ ${err.message}`);
    process.exit(1);
  }
}
