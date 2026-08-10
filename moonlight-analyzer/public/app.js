const state = {
  contents: [],
  selectedId: null,
  sortMode: 'date',
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
  voiceover_testo: 'Voiceover + testo',
  montaggio_multiclip: 'Montaggio multi-clip',
  slideshow: 'Slideshow',
  altro: 'Altro',
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

async function loadContents() {
  state.contents = await api('/api/contents');
  renderList();
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
  listEl.innerHTML = '';
  if (list.length === 0) {
    listEl.innerHTML = '<li class="placeholder">Nessun contenuto ancora. Trascina un video in incoming/ e premi "Scansiona".</li>';
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
    li.innerHTML = `
      <div class="filename">${content.caption?.slice(0, 60) || content.filename}</div>
      <div class="meta">${hookBadge}${gapBadge}</div>
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
    <h2>${content.filename}</h2>
    ${gap ? `<p><span class="badge gap-${gap.level}">Divario piattaforme: ${gap.level} (${pct(gap.relative_gap)}) — meglio su ${gap.better_platform}</span></p>` : ''}

    <div class="field-block">
      <label>Caption (condivisa)</label>
      <textarea id="captionInput">${content.caption || ''}</textarea>
    </div>
    <div class="field-block">
      <label>Categoria / argomento</label>
      <input id="categoryInput" value="${content.category || ''}" />
    </div>
    <div class="save-row"><button id="saveCaptionBtn" class="primary">Salva caption/categoria</button></div>

    <div class="analysis-card">
      <h3>Analisi visiva automatica</h3>
      <div class="analysis-row"><span class="k">Durata</span><span class="v">${content.duration_sec ? content.duration_sec.toFixed(1) + 's' : '—'}</span></div>
      <div class="analysis-row"><span class="k">Hook</span><span class="v">${HOOK_LABELS[content.hook_type] || content.hook_type || '—'}</span></div>
      <div class="analysis-row"><span class="k">Testo a strati</span><span class="v">${content.text_layering || '—'}</span></div>
      <div class="analysis-row"><span class="k">Coerenza immagine/testo</span><span class="v">${content.image_text_coherence || '—'} (${content.coherence_score ?? '—'}/5)</span></div>
      <div class="analysis-row"><span class="k">Formato</span><span class="v">${FORMAT_LABELS[content.format] || content.format || '—'}</span></div>
      <div class="analysis-row"><span class="k">Ritmo tagli</span><span class="v">${editing.ritmo_tagli || '—'}</span></div>
      <div class="analysis-row"><span class="k">Zoom/transizioni</span><span class="v">${editing.zoom_transizioni || '—'}</span></div>
      <div class="analysis-row"><span class="k">Stile testo overlay</span><span class="v">${editing.stile_testo_overlay || '—'}</span></div>
      <div class="analysis-row"><span class="k">Coerenza editing/tono</span><span class="v">${editing.coerenza_editing_tono || '—'}</span></div>
      <div class="analysis-row"><span class="k">Pacing</span><span class="v">${content.pacing || '—'}</span></div>
      <div class="analysis-row"><span class="k">Note</span><span class="v">${content.analysis_notes || '—'}</span></div>
    </div>

    <div class="grid-2">
      ${['instagram', 'tiktok'].map((platform) => platformForm(content, platform)).join('')}
    </div>
  `;

  document.getElementById('saveCaptionBtn').addEventListener('click', () => saveCaption(content.id));
  for (const platform of ['instagram', 'tiktok']) {
    document.getElementById(`save-${platform}`).addEventListener('click', () => saveMetrics(content.id, platform));
  }
}

function platformForm(content, platform) {
  const m = content.metrics.find((x) => x.platform === platform);
  const label = platform === 'instagram' ? 'Instagram' : 'TikTok';
  const savesLabel = platform === 'instagram' ? 'Salvataggi' : 'Preferiti';
  const reachLabel = platform === 'instagram' ? 'Reach' : 'Visualizzazioni';
  return `
    <div class="platform-card">
      <h3>${label}</h3>
      <div class="engagement">${m ? pct(m.engagement) : '—'}</div>
      <div class="field-block"><label>Link</label><input id="${platform}-url" value="${metricValue(content, platform, 'url')}" /></div>
      <div class="field-block"><label>Data pubblicazione</label><input id="${platform}-published_at" type="date" value="${metricValue(content, platform, 'published_at') || ''}" /></div>
      <div class="field-block"><label>Like</label><input id="${platform}-likes" type="number" min="0" value="${metricValue(content, platform, 'likes')}" /></div>
      <div class="field-block"><label>Commenti</label><input id="${platform}-comments" type="number" min="0" value="${metricValue(content, platform, 'comments')}" /></div>
      <div class="field-block"><label>Condivisioni</label><input id="${platform}-shares" type="number" min="0" value="${metricValue(content, platform, 'shares')}" /></div>
      <div class="field-block"><label>${savesLabel}</label><input id="${platform}-saves" type="number" min="0" value="${metricValue(content, platform, 'saves')}" /></div>
      ${platform === 'instagram' ? `<div class="field-block"><label>Repost</label><input id="instagram-reposts" type="number" min="0" value="${metricValue(content, platform, 'reposts')}" /></div>` : ''}
      <div class="field-block"><label>${reachLabel}</label><input id="${platform}-reach" type="number" min="0" value="${metricValue(content, platform, 'reach')}" /></div>
      <div class="save-row"><button id="save-${platform}" class="primary">Salva ${label}</button></div>
    </div>
  `;
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
      },
    });
    toast(`Metriche ${platform} salvate.`);
    await loadContents();
    await selectContent(id);
  } catch (err) {
    toast(err.message, true);
  }
}

document.getElementById('scanBtn').addEventListener('click', async () => {
  try {
    const result = await api('/api/scan', { method: 'POST' });
    const msg = `Elaborati: ${result.processed.length}` + (result.errors.length ? `, errori: ${result.errors.length}` : '');
    toast(msg, result.errors.length > 0);
    await loadContents();
  } catch (err) {
    toast(err.message, true);
  }
});

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

loadContents();
