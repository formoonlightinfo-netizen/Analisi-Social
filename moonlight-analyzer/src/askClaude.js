import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { listContents } from './db.js';
import { generateReport, engagementRate } from './report.js';
import { buildClaudeEnv } from './claudeEnv.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function formatMetric(m) {
  const eng = engagementRate(m);
  return `${m.platform}: ${m.likes ?? 0} like, ${m.comments ?? 0} commenti, ${m.shares ?? 0} condivisioni, reach ${m.reach ?? '—'}, follower acquisiti ${m.followers_gained ?? '—'}${eng != null ? `, engagement ${(eng * 100).toFixed(1)}%` : ''}`;
}

function buildArchiveSummary() {
  const contents = listContents().filter((c) => c.status === 'analyzed');
  if (contents.length === 0) {
    return 'L\'archivio è vuoto: nessun video ancora analizzato.';
  }

  const lines = [`Archivio: ${contents.length} contenuti analizzati.\n`];
  for (const c of contents) {
    const editing = c.editing_style ? JSON.parse(c.editing_style) : {};
    const metricsStr = c.metrics.length > 0 ? c.metrics.map(formatMetric).join(' | ') : 'nessuna metrica inserita';
    lines.push(
      `- Caption: "${c.caption || '(nessuna caption)'}" | categoria: ${c.category || '—'}\n` +
        `  hook: ${c.hook_type || '—'} | formato: ${c.format || '—'} | testo a strati: ${c.text_layering || '—'} | coerenza: ${c.coherence_score ?? '—'}/5 (${c.image_text_coherence || '—'})\n` +
        `  montaggio: ${editing.ritmo_tagli || '—'}; ${editing.zoom_transizioni || '—'}; testo overlay: ${editing.stile_testo_overlay || '—'}\n` +
        `  pacing: ${c.pacing || '—'} | note: ${c.analysis_notes || '—'}\n` +
        `  metriche: ${metricsStr}`
    );
  }

  const report = generateReport();
  lines.push('\nReport pattern aggregato (JSON):');
  lines.push(JSON.stringify(report));

  return lines.join('\n');
}

/**
 * Lancia una sessione headless e isolata di Claude Code che guarda tutto
 * l'archivio (caption, analisi visiva, metriche) e risponde a una domanda
 * libera di Helga — es. idee per nuovi contenuti basate sui pattern reali
 * che funzionano meglio. Stesso meccanismo gratuito di runAnalysis.js,
 * nessuna chiave API a pagamento.
 * @param {string} question
 * @returns {Promise<string>} risposta testuale
 */
export async function askClaude(question) {
  const summary = buildArchiveSummary();
  const prompt = `Sei un consulente esperto di content strategy per social media (Instagram/TikTok), specializzato in coaching spirituale e arti occulte. Di seguito trovi l'archivio dei contenuti già pubblicati da Helga (@moonlight.coach), con l'analisi visiva automatica e le metriche di performance per piattaforma.

${summary}

Domanda di Helga: ${question}

Rispondi in italiano, in modo concreto e specifico, basandoti sui pattern reali che emergono dai dati sopra (non consigli generici). Non usare strumenti per esplorare file esterni: tutte le informazioni necessarie sono già nel testo qui sopra.`;

  const env = buildClaudeEnv();

  const { stdout } = await execFileAsync(
    'claude',
    ['-p', prompt, '--output-format', 'json', '--allowedTools', ''],
    { cwd: ROOT, env, timeout: 5 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 }
  );
  const response = JSON.parse(stdout);
  if (response.is_error) {
    throw new Error(response.result || 'Errore sconosciuto da Claude Code.');
  }
  return response.result;
}
