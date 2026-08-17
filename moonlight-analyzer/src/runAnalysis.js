import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { saveAnalysis } from './saveAnalysis.js';
import { updateContentFields } from './db.js';
import { buildClaudeEnv } from './claudeEnv.js';

const execFileAsync = promisify(execFile);

const ANALYSIS_PROMPT = `Sei un analista esperto di contenuti video per social media (Instagram Reels e TikTok), specializzato in contenuti di coaching spirituale e arti occulte. Guarda con lo strumento Read, in ordine, tutti i fotogrammi .jpg presenti in questa cartella (sono estratti a circa 1 al secondo da uno stesso video già pubblicato, con testo/sottotitoli in overlay come appaiono nel post reale). Poi rispondi ESCLUSIVAMENTE con un oggetto JSON valido, senza altro testo prima o dopo, con questa struttura esatta:

{
  "hook_type": "loop_aperto" | "rivelazione_diretta" | "domanda" | "testimonianza" | "contro_affermazione" | "altro",
  "text_layering": "progressivo" | "tutto_insieme",
  "image_text_coherence": "descrizione di quanto l'inquadratura/ambientazione è coerente con il messaggio testuale",
  "coherence_score": <intero da 1 a 5, dove 5 = massima coerenza>,
  "format": "parlato_in_camera" | "voiceover_testo" | "montaggio_multiclip" | "slideshow" | "altro",
  "editing_style": {
    "ritmo_tagli": "descrizione del ritmo dei tagli",
    "zoom_transizioni": "uso di zoom, transizioni, effetti",
    "stile_testo_overlay": "font, animazione, posizione del testo overlay",
    "coerenza_editing_tono": "quanto lo stile di montaggio è coerente col tono del contenuto"
  },
  "pacing": "descrizione del ritmo generale e della durata percepita",
  "notes": "altre osservazioni utili su cosa funziona o non funziona"
}`;

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Nessun JSON valido nella risposta: ${text.slice(0, 300)}`);
  return JSON.parse(match[0]);
}

/**
 * Lancia una sessione headless e isolata di Claude Code (usa lo stesso
 * accesso di questa installazione di Claude Code — nessuna chiave API
 * separata, nessun costo aggiuntivo) che guarda i fotogrammi estratti e
 * produce l'analisi visiva, poi la salva nel database.
 * Pensata per girare in background: non blocca la richiesta che l'ha
 * avviata (vedi server.js).
 * @param {string} id - id del contenuto (già in stato pending_analysis)
 * @param {string} framesDir - cartella con i fotogrammi .jpg
 */
export async function runAnalysis(id, framesDir) {
  const env = buildClaudeEnv();

  try {
    const { stdout } = await execFileAsync(
      'claude',
      ['-p', ANALYSIS_PROMPT, '--output-format', 'json', '--allowedTools', 'Read'],
      { cwd: framesDir, env, timeout: 5 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 }
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
