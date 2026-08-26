const state = {
  contents: [],
  selectedId: null,
  sortMode: 'date',
  uploadMode: 'video',
};

const listEl = document.getElementById('contentList');
const detailEl = document.getElementById('detailPanel');
const sortSelect = document.getElementById('sortSelect');
const toastEl = document.getElementById('toast');

const HOOK_LABELS = {
  loop_aperto: 'Loop aperto',
  rivelazione_diretta: 'Rivelazione diretta',
  domanda: 'Domanda',
  testimonianza: 'Testimonianza',
  contro_affermazione: 'Contro-affermazione',
  altro: 'Altro',
};
const FORMAT_LABELS = {
  parlato_in_camera: 'Parlato in camera',
  parlato_in_camera_testo: 'Parlato in camera + testo',
  voiceover_testo: 'Voiceover + testo',
  testo: 'Testo',
  broll: 'B-Roll',
  broll_testo: 'B-Roll + testo',
  broll_voiceover: 'B-Roll + voiceover',
  broll_testo_voiceover: 'B-Roll + testo + voiceover',
  montaggio_multiclip: 'Montaggio multi-clip',
  slideshow: 'Slideshow',
  altro: 'Altro',
};
const STATUS_BADGES = {
  pending_analysis: '<span class="badge gap-analyzing">in coda</span>',
  analyzing: '<span class="badge gap-analyzing">🔄 analisi in corso</span>',
  analysis_failed: '<span class="badge gap-failed">⚠ analisi fallita</span>',
};

function toast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.className = `toast ${isError ? 'error' : ''}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.add('hidden'), 4000);
}

function pct(value) {
  if (value == null) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

// created_at è salvato da SQLite come "YYYY-MM-DD HH:MM:SS" in UTC, senza
// indicazione esplicita di fuso — va normalizzato prima di farlo leggere a
// Date(), altrimenti alcuni browser lo interpretano come ora locale.
function minutesSince(dateString) {
  if (!dateString) return 0;
  const then = new Date(dateString.replace(' ', 'T') + 'Z').getTime();
  if (Number.isNaN(then)) return 0;
  return (Date.now() - then) / 60000;
}

function aggregateEngagement(content) {
  const values = content.metrics.map((m) => m.engagement).filter((v) => v != null);
  if (values.length === 0) return -1;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

async function api(path, options) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
  return data;
}

async function uploadVideo(file) {
  const formData = new FormData();
  formData.append('video', file);
  const res = await fetch('/api/upload', { method: 'POST', body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
  return data;
}

async function uploadCarousel(files) {
  const formData = new FormData();
  for (const file of files) formData.append('images', file);
  const res = await fetch('/api/upload-carousel', { method: 'POST', body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
  return data;
}

let pollTimer = null;
function ensurePolling() {
  const hasPending = state.contents.some((c) => c.status === 'analyzing' || c.status === 'pending_analysis');
  if (!hasPending) {
    clearTimeout(pollTimer);
    pollTimer = null;
    return;
  }
  if (pollTimer) return;
  pollTimer = setTimeout(async () => {
    pollTimer = null;
    const selectedBefore = state.contents.find((c) => c.id === state.selectedId);
    const wasTransient = selectedBefore && (selectedBefore.status === 'analyzing' || selectedBefore.status === 'pending_analysis');
    await loadContents();
    // Non tocchiamo il pannello di dettaglio se l'utente lo ha aperto e non
    // sta cambiando stato in questo momento: eviterebbe di cancellare
    // caption/metriche/nome che sta scrivendo. Lo aggiorniamo solo se il
    // contenuto selezionato era "in analisi" (per mostrare il risultato
    // appena pronto).
    if (state.selectedId && wasTransient) {
      const stillThere = state.contents.find((c) => c.id === state.selectedId);
      if (stillThere) await selectContent(state.selectedId);
    }
  }, 4000);
}

const persistWarningEl = document.getElementById('persistWarning');
async function checkPersistStatus() {
  try {
    const status = await api('/api/persist-status');
    persistWarningEl.classList.toggle('hidden', status.ok);
  } catch {
    // se il controllo stesso fallisce (es. rete assente) non nascondiamo
    // un avviso già mostrato, ma non ne mostriamo uno nuovo per questo
  }
}

let lastContentsSnapshot = null;
async function loadContents() {
  const fetched = await api('/api/contents');
  state.contents = fetched;
  // renderList() ricostruisce da zero tutti gli <li> della lista. Chiamarlo
  // ad ogni loadContents() (compreso il refresh automatico quando l'app
  // torna in primo piano) rimpiazzava gli elementi anche quando i dati non
  // erano cambiati — su mobile un tap che cade proprio mentre gli elementi
  // vengono ricreati va perso, dando l'impressione che cliccare un
  // contenuto non faccia nulla. Aggiorniamo la lista solo se è cambiata
  // davvero.
  const snapshot = JSON.stringify(fetched);
  if (snapshot !== lastContentsSnapshot) {
    lastContentsSnapshot = snapshot;
    renderList();
  }
  ensurePolling();
  checkPersistStatus();
}

function sortedContents() {
  const list = [...state.contents];
  if (state.sortMode === 'engagement') {
    list.sort((a, b) => aggregateEngagement(b) - aggregateEngagement(a));
  } else if (state.sortMode === 'gap') {
    list.sort((a, b) => (b.gap?.relative_gap ?? -1) - (a.gap?.relative_gap ?? -1));
  } else {
    list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  return list;
}

function renderList() {
  const list = sortedContents();
  document.getElementById('archiveCount').textContent = `${state.contents.length} contenuti`;
  listEl.innerHTML = '';
  if (list.length === 0) {
    listEl.innerHTML = '<li class="placeholder">Nessun contenuto ancora. Carica un video o un carosello qui sopra per iniziare.</li>';
    return;
  }
  for (const content of list) {
    const li = document.createElement('li');
    li.className = `content-item ${content.id === state.selectedId ? 'active' : ''}`;
    const gapBadge = content.gap
      ? `<span class="badge gap-${content.gap.level}">divario ${content.gap.level}</span>`
      : '';
    const hookBadge = content.hook_type
      ? `<span class="badge neutral">${HOOK_LABELS[content.hook_type] || content.hook_type}</span>`
      : '';
    const typeBadge = content.content_type === 'carousel'
      ? '<span class="badge type-carousel">🖼️ Carosello</span>'
      : '';
    const statusBadge = STATUS_BADGES[content.status] || '';
    li.innerHTML = `
      <div class="content-item-row">
        <img class="thumb" src="/thumbnails/${content.id}${content.thumbnail_ext || '.jpg'}" alt="" onerror="this.style.visibility='hidden'" />
        <div class="content-item-info">
          <div class="filename">${content.caption?.slice(0, 60) || content.filename}</div>
          <div class="meta">${statusBadge}${typeBadge}${hookBadge}${gapBadge}</div>
        </div>
      </div>
    `;
    li.addEventListener('click', () => selectContent(content.id));
    listEl.appendChild(li);
  }
}

async function selectContent(id) {
  state.selectedId = id;
  renderList();
  const content = await api(`/api/contents/${id}`);
  renderDetail(content);
}

function metricValue(content, platform, field) {
  const m = content.metrics.find((x) => x.platform === platform);
  return m ? m[field] ?? '' : '';
}

function renderDetail(content) {
  const editing = content.editing_style ? JSON.parse(content.editing_style) : {};
  const gap = content.gap;

  detailEl.innerHTML = `
    <div class="detail-header">
      <img class="detail-thumb" src="/thumbnails/${content.id}${content.thumbnail_ext || '.jpg'}" alt="" onerror="this.style.display='none'" />
      <h2>${content.filename}</h2>
      <button id="deleteBtn" class="danger icon-btn">Elimina</button>
    </div>
    <div class="rename-row">
      <input id="filenameInput" value="${content.filename}" />
      <button id="renameBtn">Rinomina</button>
    </div>
    ${gap ? `<p><span class="badge gap-${gap.level}">Divario piattaforme: ${gap.level} (${pct(gap.relative_gap)}) — meglio su ${gap.better_platform}</span></p>` : ''}

    <p class="section-title">Caption &amp; categoria</p>
    <div class="field-block">
      <label>Caption (condivisa)</label>
      <textarea id="captionInput">${content.caption || ''}</textarea>
    </div>
    <div class="field-block">
      <label>Categoria / argomento</label>
      <input id="categoryInput" value="${content.category || ''}" />
    </div>
    <div class="save-row"><button id="saveCaptionBtn" class="primary">Salva caption/categoria</button></div>

    ${content.status === 'pending_analysis' || content.status === 'analyzing' ? `
    <div class="analysis-card">
      <h3>Analisi visiva</h3>
      <p class="placeholder">${content.status === 'analyzing' ? '🔄 Analisi in corso... di solito richiede 1-3 minuti, questa pagina si aggiorna da sola.' : 'In coda per l\'analisi.'}</p>
      ${minutesSince(content.created_at) >= 6 ? `
      <p class="placeholder">Sta impiegando più del solito — se pensi sia bloccata, puoi riprovare:</p>
      <div class="save-row"><button id="retryBtn" class="primary">Riprova analisi</button></div>
      ` : ''}
    </div>
    ` : content.status === 'analysis_failed' ? `
    <div class="analysis-card">
      <h3>Analisi visiva</h3>
      <p class="placeholder">⚠ Analisi non riuscita: ${content.analysis_notes || 'errore sconosciuto'}</p>
      <div class="save-row"><button id="retryBtn" class="primary">Riprova analisi</button></div>
    </div>
    ` : `
    <div class="analysis-card">
      <h3>Analisi visiva <span class="analysis-hint">(rilevata automaticamente — correggi qui se qualcosa è sbagliato)</span></h3>
      <div class="analysis-grid">
        ${content.content_type !== 'carousel' ? `
        <div class="field-block"><label>Durata (secondi)</label><input id="an-duration_sec" type="number" step="0.1" min="0" value="${content.duration_sec ?? ''}" /></div>
        ` : ''}
        <div class="field-block"><label>Formato</label><input id="an-format" value="${FORMAT_LABELS[content.format] || content.format || ''}" /></div>
        <div class="field-block">
          <label>Hook</label>
          <select id="an-hook_type">${Object.entries(HOOK_LABELS).map(([k, v]) => `<option value="${k}" ${content.hook_type === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        </div>
        <div class="field-block"><label>Testo a strati</label><input id="an-text_layering" value="${content.text_layering || ''}" /></div>
        <div class="field-block"><label>Coerenza immagine/testo (punteggio 1-5)</label><input id="an-coherence_score" type="number" min="1" max="5" value="${content.coherence_score ?? ''}" /></div>
        <div class="field-block span-2"><label>Descrizione coerenza immagine/testo</label><textarea id="an-image_text_coherence">${content.image_text_coherence || ''}</textarea></div>
        <div class="field-block"><label>Ritmo tagli</label><input id="an-ritmo_tagli" value="${editing.ritmo_tagli || ''}" /></div>
        <div class="field-block"><label>Zoom/transizioni</label><input id="an-zoom_transizioni" value="${editing.zoom_transizioni || ''}" /></div>
        <div class="field-block"><label>Stile testo overlay</label><input id="an-stile_testo_overlay" value="${editing.stile_testo_overlay || ''}" /></div>
        <div class="field-block"><label>Coerenza editing/tono</label><input id="an-coerenza_editing_tono" value="${editing.coerenza_editing_tono || ''}" /></div>
        <div class="field-block span-2"><label>Pacing</label><textarea id="an-pacing">${content.pacing || ''}</textarea></div>
        <div class="field-block span-2"><label>Note</label><textarea id="an-analysis_notes">${content.analysis_notes || ''}</textarea></div>
      </div>
      <div class="save-row"><button id="saveAnalysisBtn" class="primary">Salva analisi</button></div>
    </div>
    `}

    <p class="section-title">Metriche per piattaforma</p>
    <div class="grid-2">
      ${['instagram', 'tiktok'].map((platform) => platformForm(content, platform)).join('')}
    </div>
  `;

  document.getElementById('renameBtn').addEventListener('click', () => renameContent(content.id));
  document.getElementById('deleteBtn').addEventListener('click', () => deleteContentConfirm(content.id, content.filename));
  document.getElementById('saveCaptionBtn').addEventListener('click', () => saveCaption(content.id));
  for (const platform of ['instagram', 'tiktok']) {
    document.getElementById(`save-${platform}`)?.addEventListener('click', () => saveMetrics(content.id, platform));
  }
  document.getElementById('retryBtn')?.addEventListener('click', () => retryAnalysis(content.id));
  document.getElementById('saveAnalysisBtn')?.addEventListener('click', () => saveAnalysis(content.id));
}

async function saveAnalysis(id) {
  const val = (fieldId) => document.getElementById(fieldId)?.value;
  const body = {
    format: val('an-format'),
    hook_type: val('an-hook_type'),
    text_layering: val('an-text_layering'),
    coherence_score: val('an-coherence_score'),
    image_text_coherence: val('an-image_text_coherence'),
    pacing: val('an-pacing'),
    analysis_notes: val('an-analysis_notes'),
    editing_style: {
      ritmo_tagli: val('an-ritmo_tagli'),
      zoom_transizioni: val('an-zoom_transizioni'),
      stile_testo_overlay: val('an-stile_testo_overlay'),
      coerenza_editing_tono: val('an-coerenza_editing_tono'),
    },
  };
  const durationVal = val('an-duration_sec');
  if (durationVal !== undefined) body.duration_sec = durationVal;
  try {
    await api(`/api/contents/${id}`, { method: 'PATCH', body });
    toast('Analisi aggiornata.');
    await loadContents();
    await selectContent(id);
  } catch (err) {
    toast(err.message, true);
  }
}

async function deleteContentConfirm(id, filename) {
  if (!confirm(`Eliminare definitivamente "${filename}"? Non si può annullare.`)) return;
  try {
    await api(`/api/contents/${id}`, { method: 'DELETE' });
    toast('Contenuto eliminato.');
    state.selectedId = null;
    detailEl.innerHTML = '<p class="placeholder">Seleziona un contenuto dalla lista per vedere i dettagli.</p>';
    await loadContents();
  } catch (err) {
    toast(err.message, true);
  }
}

async function retryAnalysis(id) {
  try {
    await api(`/api/contents/${id}/reanalyze`, { method: 'POST' });
    toast('Nuovo tentativo di analisi avviato.');
    await loadContents();
    await selectContent(id);
  } catch (err) {
    toast(err.message, true);
  }
}

function platformForm(content, platform) {
  const m = content.metrics.find((x) => x.platform === platform);
  const label = platform === 'instagram' ? 'Instagram' : 'TikTok';
  const savesLabel = platform === 'instagram' ? 'Salvataggi' : 'Preferiti';
  const reachLabel = 'Visualizzazioni';
  return `
    <div class="platform-card">
      <h3>${label}</h3>
      <div class="engagement">${m ? pct(m.engagement) : '—'}</div>
      <div class="field-block"><label>Link</label><input id="${platform}-url" value="${metricValue(content, platform, 'url')}" /></div>
      <div class="field-block"><label>Data pubblicazione</label><input id="${platform}-published_at" type="text" placeholder="GG/MM/AAAA" value="${metricValue(content, platform, 'published_at') || ''}" /></div>
      <div class="field-block"><label>Like</label><input id="${platform}-likes" type="number" min="0" value="${metricValue(content, platform, 'likes')}" /></div>
      <div class="field-block"><label>Commenti</label><input id="${platform}-comments" type="number" min="0" value="${metricValue(content, platform, 'comments')}" /></div>
      <div class="field-block"><label>Condivisioni</label><input id="${platform}-shares" type="number" min="0" value="${metricValue(content, platform, 'shares')}" /></div>
      <div class="field-block"><label>${savesLabel}</label><input id="${platform}-saves" type="number" min="0" value="${metricValue(content, platform, 'saves')}" /></div>
      ${platform === 'instagram' ? `<div class="field-block"><label>Repost</label><input id="instagram-reposts" type="number" min="0" value="${metricValue(content, platform, 'reposts')}" /></div>` : ''}
      <div class="field-block"><label>${reachLabel}</label><input id="${platform}-reach" type="number" min="0" value="${metricValue(content, platform, 'reach')}" /></div>
      <div class="field-block"><label>Follower acquisiti</label><input id="${platform}-followers_gained" type="number" min="0" value="${metricValue(content, platform, 'followers_gained')}" /></div>
      <div class="save-row"><button id="save-${platform}" class="primary">Salva ${label}</button></div>
    </div>
  `;
}

async function renameContent(id) {
  const newFilename = document.getElementById('filenameInput').value.trim();
  if (!newFilename) {
    toast('Il nome non può essere vuoto.', true);
    return;
  }
  try {
    await api(`/api/contents/${id}/rename`, { method: 'POST', body: { filename: newFilename } });
    toast('File rinominato.');
    await loadContents();
    await selectContent(id);
  } catch (err) {
    toast(err.message, true);
  }
}

async function saveCaption(id) {
  try {
    await api(`/api/contents/${id}`, {
      method: 'PATCH',
      body: {
        caption: document.getElementById('captionInput').value,
        category: document.getElementById('categoryInput').value,
      },
    });
    toast('Caption e categoria salvate.');
    await loadContents();
    await selectContent(id);
  } catch (err) {
    toast(err.message, true);
  }
}

async function saveMetrics(id, platform) {
  const field = (name) => document.getElementById(`${platform}-${name}`).value;
  try {
    await api(`/api/contents/${id}/metrics`, {
      method: 'POST',
      body: {
        platform,
        url: field('url'),
        published_at: field('published_at'),
        likes: field('likes'),
        comments: field('comments'),
        shares: field('shares'),
        saves: field('saves'),
        reposts: platform === 'instagram' ? field('reposts') : null,
        reach: field('reach'),
        followers_gained: field('followers_gained'),
      },
    });
    toast(`Metriche ${platform} salvate.`);
    await loadContents();
    await selectContent(id);
  } catch (err) {
    toast(err.message, true);
  }
}

const dropzone = document.getElementById('dropzone');
const videoInput = document.getElementById('videoInput');
const uploadProgress = document.getElementById('uploadProgress');
const uploadProgressText = document.getElementById('uploadProgressText');
const modeVideoBtn = document.getElementById('modeVideoBtn');
const modeCarouselBtn = document.getElementById('modeCarouselBtn');
const dzTitle = document.getElementById('dzTitle');
const dzHint = document.getElementById('dzHint');

function setUploadMode(mode) {
  state.uploadMode = mode;
  modeVideoBtn.classList.toggle('active', mode === 'video');
  modeCarouselBtn.classList.toggle('active', mode === 'carousel');
  if (mode === 'video') {
    videoInput.accept = 'video/mp4,.mp4';
    videoInput.multiple = false;
    dzTitle.textContent = 'Carica un video';
    dzHint.innerHTML = 'Trascinalo qui o <button id="browseBtn" class="link-btn">scegli il file</button> — l\'analisi parte da sola';
  } else {
    videoInput.accept = 'image/jpeg,image/png,.jpg,.jpeg,.png';
    videoInput.multiple = true;
    dzTitle.textContent = 'Carica un carosello';
    dzHint.innerHTML = 'Trascina qui le immagini in ordine o <button id="browseBtn" class="link-btn">scegli i file</button> — l\'analisi parte da sola';
  }
  document.getElementById('browseBtn').addEventListener('click', () => videoInput.click());
}

modeVideoBtn.addEventListener('click', () => setUploadMode('video'));
modeCarouselBtn.addEventListener('click', () => setUploadMode('carousel'));
setUploadMode('video');

videoInput.addEventListener('change', () => {
  const files = Array.from(videoInput.files);
  if (files.length) handleUpload(files);
  videoInput.value = '';
});

['dragenter', 'dragover'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
  })
);
dropzone.addEventListener('drop', (e) => {
  const files = Array.from(e.dataTransfer.files);
  if (files.length) handleUpload(files);
});

async function handleUpload(files) {
  if (state.uploadMode === 'video') {
    const file = files[0];
    if (!/\.mp4$/i.test(file.name)) {
      toast('Sono accettati solo file .mp4.', true);
      return;
    }
    uploadProgress.classList.remove('hidden');
    uploadProgressText.textContent = `Caricamento di ${file.name}...`;
    try {
      await uploadVideo(file);
      uploadProgressText.textContent = 'Caricato — analisi avviata in background.';
      toast(`${file.name} caricato, analisi in corso.`);
      await loadContents();
    } catch (err) {
      toast(err.message, true);
    } finally {
      setTimeout(() => uploadProgress.classList.add('hidden'), 2000);
    }
  } else {
    if (files.some((f) => !/\.(jpe?g|png)$/i.test(f.name))) {
      toast('Sono accettate solo immagini .jpg/.jpeg/.png.', true);
      return;
    }
    uploadProgress.classList.remove('hidden');
    uploadProgressText.textContent = `Caricamento di ${files.length} immagini...`;
    try {
      await uploadCarousel(files);
      uploadProgressText.textContent = 'Caricato — analisi avviata in background.';
      toast(`Carosello caricato (${files.length} immagini), analisi in corso.`);
      await loadContents();
    } catch (err) {
      toast(err.message, true);
    } finally {
      setTimeout(() => uploadProgress.classList.add('hidden'), 2000);
    }
  }
}

sortSelect.addEventListener('change', () => {
  state.sortMode = sortSelect.value;
  renderList();
});

const reportOverlay = document.getElementById('reportOverlay');
const reportBody = document.getElementById('reportBody');

document.getElementById('reportBtn').addEventListener('click', async () => {
  try {
    const report = await api('/api/report');
    renderReport(report);
    reportOverlay.classList.remove('hidden');
  } catch (err) {
    toast(err.message, true);
  }
});
document.getElementById('closeReport').addEventListener('click', () => reportOverlay.classList.add('hidden'));

const askOverlay = document.getElementById('askOverlay');
const askInput = document.getElementById('askInput');
const askLoading = document.getElementById('askLoading');
const askAnswer = document.getElementById('askAnswer');
const askSubmitBtn = document.getElementById('askSubmitBtn');

document.getElementById('askBtn').addEventListener('click', () => {
  askOverlay.classList.remove('hidden');
});
document.getElementById('closeAsk').addEventListener('click', () => askOverlay.classList.add('hidden'));

askSubmitBtn.addEventListener('click', async () => {
  const question = askInput.value.trim();
  if (!question) {
    toast('Scrivi prima una domanda.', true);
    return;
  }
  askLoading.classList.remove('hidden');
  askAnswer.textContent = '';
  askSubmitBtn.disabled = true;
  try {
    const { answer } = await api('/api/ask', { method: 'POST', body: { question } });
    askAnswer.textContent = answer;
  } catch (err) {
    toast(err.message, true);
  } finally {
    askLoading.classList.add('hidden');
    askSubmitBtn.disabled = false;
  }
});

function groupTable(title, rows, keyLabel) {
  if (rows.length === 0) return `<h3>${title}</h3><p class="placeholder">Nessun dato sufficiente.</p>`;
  return `
    <h3>${title}</h3>
    <table>
      <thead><tr><th>${keyLabel}</th><th>Engagement medio</th><th>N. contenuti</th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr><td>${HOOK_LABELS[r.key] || FORMAT_LABELS[r.key] || r.key}</td><td>${pct(r.avg_engagement)}</td><td>${r.n}</td></tr>`).join('')}
      </tbody>
    </table>
  `;
}

function gapTable(title, rows) {
  if (rows.length === 0) return `<h3>${title}</h3><p class="placeholder">Nessun contenuto pubblicato su entrambe le piattaforme.</p>`;
  return `
    <h3>${title}</h3>
    <table>
      <thead><tr><th>Contenuto</th><th>IG</th><th>TikTok</th><th>Divario</th><th>Migliore</th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr><td>${r.filename}</td><td>${pct(r.engagement_instagram)}</td><td>${pct(r.engagement_tiktok)}</td><td>${pct(r.relative_gap)}</td><td>${r.better_platform}</td></tr>`).join('')}
      </tbody>
    </table>
  `;
}

function renderReport(report) {
  reportBody.innerHTML = `
    <p class="placeholder">Generato: ${new Date(report.generated_at).toLocaleString('it-IT')} — ${report.totals.contents} contenuti (${report.totals.with_metrics} con metriche, ${report.totals.cross_platform} su entrambe le piattaforme)</p>

    <h3>Confronto piattaforme (media generale)</h3>
    <table>
      <thead><tr><th>Piattaforma</th><th>Engagement medio</th></tr></thead>
      <tbody>
        <tr><td>Instagram</td><td>${pct(report.platform_comparison.avg_engagement_instagram)}</td></tr>
        <tr><td>TikTok</td><td>${pct(report.platform_comparison.avg_engagement_tiktok)}</td></tr>
      </tbody>
    </table>

    ${groupTable('Engagement per tipo di hook', report.engagement_by_hook_type, 'Hook')}
    ${groupTable('Engagement per stile testo', report.engagement_by_text_layering, 'Stile testo')}
    ${groupTable('Engagement per formato', report.engagement_by_format, 'Formato')}

    ${gapTable('Divario alto tra piattaforme', report.cross_platform_gap.high_gap_contents)}
    ${gapTable('Divario basso tra piattaforme (funziona ovunque)', report.cross_platform_gap.low_gap_contents)}
  `;
}

const listPanelEl = document.querySelector('.list-panel');
const archiveToggle = document.getElementById('archiveToggle');
if (localStorage.getItem('archiveCollapsed') === '1') listPanelEl.classList.add('collapsed');
archiveToggle.addEventListener('click', () => {
  const collapsed = listPanelEl.classList.toggle('collapsed');
  localStorage.setItem('archiveCollapsed', collapsed ? '1' : '0');
});

// Pulsante di aggiornamento manuale: il refresh automatico (sotto) non
// basta su alcuni telefoni dove l'app resta "congelata" senza che il
// browser avvisi mai la pagina — qui l'utente forza lui stesso una
// richiesta nuova al server, senza dover indovinare come far ripartire
// l'aggiornamento automatico.
const refreshBtn = document.getElementById('refreshBtn');
refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  lastContentsSnapshot = null; // forza il ridisegno anche se i dati sembrano uguali
  try {
    await loadContents();
    if (state.selectedId) await selectContent(state.selectedId);
    toast('Archivio aggiornato.');
  } catch (err) {
    toast(err.message, true);
  } finally {
    refreshBtn.disabled = false;
  }
});

// Un'app "aggiunta alla Home" su iPhone spesso resta congelata in
// background e, quando la riapri, non rifà mai una richiesta al server —
// mostra semplicemente la schermata rimasta da prima, con dati vecchi. Qui
// forziamo un ricaricamento ogni volta che l'app torna visibile o viene
// ripristinata dalla cache di navigazione (bfcache) invece di essere
// ricaricata davvero.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadContents();
});
window.addEventListener('pageshow', (e) => {
  if (e.persisted) loadContents();
});

loadContents();
// Indipendente dal polling dei contenuti (che si ferma quando non c'è
// nessuna analisi in corso): senza questo, il banner di avviso salvataggio
// poteva restare non aggiornato per ore se non capitavano nuove modifiche.
setInterval(checkPersistStatus, 60 * 1000);
