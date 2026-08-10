import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';

const SYSTEM_PROMPT = `Sei un analista esperto di contenuti video per social media (Instagram Reels e TikTok), specializzato in contenuti di coaching spirituale e arti occulte. Ricevi una sequenza di fotogrammi estratti a intervalli regolari da un video già pubblicato (con testo/sottotitoli in overlay come appaiono nel post reale). Analizza il video e rispondi ESCLUSIVAMENTE con un oggetto JSON valido, senza testo aggiuntivo prima o dopo, con questa struttura esatta:

{
  "hook_type": "loop_aperto" | "rivelazione_diretta" | "domanda" | "testimonianza" | "contro_affermazione" | "altro",
  "hook_description": "breve descrizione di come si presenta l'hook nei primi fotogrammi",
  "text_layering": "progressivo" | "tutto_insieme",
  "image_text_coherence": "descrizione di quanto l'inquadratura/ambientazione è coerente con il messaggio testuale (es. incoerenza tra tema e contesto visivo)",
  "coherence_score": <intero da 1 a 5, dove 5 = massima coerenza tra immagine e messaggio>,
  "format": "parlato_in_camera" | "voiceover_testo" | "montaggio_multiclip" | "slideshow" | "altro",
  "editing_style": {
    "ritmo_tagli": "descrizione del ritmo dei tagli (lento/medio/veloce, frequenza)",
    "zoom_transizioni": "uso di zoom, transizioni, effetti",
    "stile_testo_overlay": "font, animazione, posizione del testo in overlay",
    "coerenza_editing_tono": "quanto lo stile di montaggio è coerente col tono del contenuto"
  },
  "pacing": "descrizione del ritmo generale e della durata percepita",
  "notes": "eventuali altre osservazioni rilevanti per capire cosa funziona o non funziona nel contenuto"
}`;

function frameToImageBlock(framePath) {
  const data = fs.readFileSync(framePath).toString('base64');
  return {
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data },
  };
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Risposta del modello non contiene JSON valido: ${text.slice(0, 200)}`);
  return JSON.parse(match[0]);
}

/**
 * Analizza un video a partire dai suoi fotogrammi estratti, tramite Claude.
 * @param {string[]} framePaths - path assoluti dei fotogrammi, in ordine temporale
 * @param {{ durationSec?: number, caption?: string }} context
 * @returns {Promise<object>} analisi strutturata
 */
export async function analyzeFrames(framePaths, context = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY non impostata. Copia .env.example in .env e inserisci la tua chiave (vedi README).'
    );
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const contextLines = [];
  if (context.durationSec) contextLines.push(`Durata video: ${context.durationSec.toFixed(1)} secondi.`);
  if (context.caption) contextLines.push(`Caption pubblicata: "${context.caption}"`);

  const userContent = [
    {
      type: 'text',
      text: [
        `Ecco ${framePaths.length} fotogrammi estratti a circa 1 al secondo, in ordine cronologico, dallo stesso video.`,
        ...contextLines,
        'Analizza il video secondo lo schema JSON richiesto.',
      ].join('\n'),
    },
    ...framePaths.map(frameToImageBlock),
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Nessuna risposta testuale dal modello.');

  return extractJson(textBlock.text);
}
