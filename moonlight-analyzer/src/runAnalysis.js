import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { saveAnalysis } from './saveAnalysis.js';
import { updateContentFields } from './db.js';
import { buildClaudeEnv } from './claudeEnv.js';

const execFileAsync = promisify(execFile);

const JSON_SCHEMA = `{
  "hook_type": "loop_aperto" | "rivelazione_diretta" | "domanda" | "testimonianza" | "contro_affermazione" | "altro",
  "text_layering": "progressivo" | "tutto_insieme",
  "image_text_coherence": "descrizione di quanto l'inquadratura/ambientazione è coerente con il messaggio testuale",
  "coherence_score": <intero da 1 a 5, dove 5 = massima coerenza>,
  "format": "parlato_in_camera" | "voiceover_testo" | "montaggio_multiclip" | "slideshow" | "altro",
  "editing_style": {
    "ritmo_tagli": "descrizione del ritmo dei tagli (o del ritmo di lettura tra le slide per un carosello)",
    "zoom_transizioni": "uso di zoom, transizioni, effetti (o transizioni/animazioni tra slide, 'nessuna' se non ci sono)",
    "stile_testo_overlay": "font, animazione, posizione del testo overlay",
    "coerenza_editing_tono": "quanto lo stile di montaggio/grafico è coerente col tono del contenuto"
  },
  "pacing": "descrizione del ritmo generale e della durata percepita",
  "notes": "altre osservazioni utili su cosa funziona o non funziona"
}`;

const VIDEO_PROMPT = `Sei un analista esperto di contenuti video per social media (Instagram Reels e TikTok), specializzato in contenuti di coaching spirituale e arti occulte. Guarda con lo strumento Read, in ordine, tutti i fotogrammi .jpg presenti in questa cartella (sono estratti a circa 1 al secondo da uno stesso video già pubblicato, con testo/sottotitoli in overlay come appaiono nel post reale). Poi rispondi ESCLUSIVAMENTE con un oggetto JSON valido, senza altro testo prima o dopo, con questa struttura esatta:

${JSON_SCHEMA}`;

const CAROUSEL_PROMPT = `Sei un analista esperto di contenuti social media (Instagram/TikTok carousel), specializzato in contenuti di coaching spirituale e arti occulte. Guarda con lo strumento Read, in ordine (slide-01, slide-02, ...), tutte le immagini presenti in questa cartella: sono le slide di uno stesso post carosello già pubblicato, con testo in overlay come appare nel post reale. Valuta la prima slide come "copertina/hook" del carosello, e le successive come lo sviluppo del contenuto. Poi rispondi ESCLUSIVAMENTE con un oggetto JSON valido, senza altro testo prima o dopo, con questa struttura esatta:

${JSON_SCHEMA}

Nota: "format" per un carosello è quasi sempre "slideshow" a meno che non sia chiaramente diverso.`;

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Nessun JSON valido nella risposta: ${text.slice(0, 300)}`);
  return JSON.parse(match[0]);
}

async function runHeadlessAnalysis(id, dir, prompt) {
  const env = buildClaudeEnv();

  try {
    const { stdout } = await execFileAsync(
      'claude',
      ['-p', prompt, '--output-format', 'json', '--allowedTools', 'Read'],
      { cwd: dir, env, timeout: 5 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 }
    );
    const response = JSON.parse(stdout);
    if (response.is_error) {
      throw new Error(response.result || 'Errore sconosciuto da Claude Code.');
    }
    const analysis = extractJson(response.result);
    saveAnalysis(id, analysis);
  } catch (err) {
    updateContentFields(id, { status: 'analysis_failed', analysis_notes: `Analisi fallita: ${err.message}` });
    throw err;
  }
}

/**
 * Lancia una sessione headless e isolata di Claude Code (usa lo stesso
 * accesso di questa installazione di Claude Code — nessuna chiave API
 * separata, nessun costo aggiuntivo) che guarda i fotogrammi estratti di un
 * video e produce l'analisi visiva, poi la salva nel database. Pensata per
 * girare in background: non blocca la richiesta che l'ha avviata.
 * @param {string} id - id del contenuto (già in stato pending_analysis)
 * @param {string} framesDir - cartella con i fotogrammi .jpg
 */
export function runAnalysis(id, framesDir) {
  return runHeadlessAnalysis(id, framesDir, VIDEO_PROMPT);
}

/**
 * Come runAnalysis, ma per un carosello: guarda le immagini delle slide
 * (permanenti in processed/<id>/, non fotogrammi temporanei) e produce
 * un'analisi con lo stesso schema, adattata al formato slideshow.
 * @param {string} id
 * @param {string} imagesDir - cartella con le immagini slide-01.jpg, slide-02.jpg, ...
 */
export function runCarouselAnalysis(id, imagesDir) {
  return runHeadlessAnalysis(id, imagesDir, CAROUSEL_PROMPT);
}
