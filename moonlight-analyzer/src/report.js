import { listContents } from './db.js';

const GAP_THRESHOLD = 0.4; // differenza relativa oltre la quale il divario è "alto"

export function engagementRate(metric) {
  if (!metric || !metric.reach || metric.reach <= 0) return null;
  const interactions = (metric.likes || 0) + (metric.comments || 0) + (metric.shares || 0) + (metric.saves || 0);
  return interactions / metric.reach;
}

function average(values) {
  const clean = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (clean.length === 0) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

/** Divario di rendimento tra Instagram e TikTok per un contenuto, se pubblicato su entrambi. */
export function platformGap(content) {
  const ig = content.metrics.find((m) => m.platform === 'instagram');
  const tt = content.metrics.find((m) => m.platform === 'tiktok');
  if (!ig || !tt) return null;

  const engIg = engagementRate(ig);
  const engTt = engagementRate(tt);
  if (engIg == null || engTt == null) return null;

  const maxEng = Math.max(engIg, engTt);
  const gap = Math.abs(engIg - engTt);
  const relativeGap = maxEng > 0 ? gap / maxEng : 0;

  return {
    engagement_instagram: engIg,
    engagement_tiktok: engTt,
    relative_gap: relativeGap,
    level: relativeGap > GAP_THRESHOLD ? 'alto' : 'basso',
    better_platform: engIg > engTt ? 'instagram' : engTt > engIg ? 'tiktok' : 'pari',
  };
}

function groupAverageEngagement(contents, keyFn) {
  const groups = new Map();
  for (const content of contents) {
    const key = keyFn(content);
    if (!key) continue;
    for (const metric of content.metrics) {
      const eng = engagementRate(metric);
      if (eng == null) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(eng);
    }
  }
  return [...groups.entries()]
    .map(([key, values]) => ({ key, avg_engagement: average(values), n: values.length }))
    .sort((a, b) => b.avg_engagement - a.avg_engagement);
}

export function generateReport() {
  const contents = listContents();
  const withMetrics = contents.filter((c) => c.metrics.length > 0);

  const byHookType = groupAverageEngagement(contents, (c) => c.hook_type);
  const byTextLayering = groupAverageEngagement(contents, (c) => c.text_layering);
  const byFormat = groupAverageEngagement(contents, (c) => c.format);

  const igEngagements = [];
  const ttEngagements = [];
  const gaps = [];
  for (const content of contents) {
    for (const metric of content.metrics) {
      const eng = engagementRate(metric);
      if (eng == null) continue;
      if (metric.platform === 'instagram') igEngagements.push(eng);
      if (metric.platform === 'tiktok') ttEngagements.push(eng);
    }
    const gap = platformGap(content);
    if (gap) gaps.push({ id: content.id, filename: content.filename, ...gap });
  }

  const highGap = gaps.filter((g) => g.level === 'alto').sort((a, b) => b.relative_gap - a.relative_gap);
  const lowGap = gaps.filter((g) => g.level === 'basso').sort((a, b) => a.relative_gap - b.relative_gap);

  return {
    generated_at: new Date().toISOString(),
    totals: {
      contents: contents.length,
      with_metrics: withMetrics.length,
      cross_platform: gaps.length,
    },
    engagement_by_hook_type: byHookType,
    engagement_by_text_layering: byTextLayering,
    engagement_by_format: byFormat,
    platform_comparison: {
      avg_engagement_instagram: average(igEngagements),
      avg_engagement_tiktok: average(ttEngagements),
    },
    cross_platform_gap: {
      threshold: GAP_THRESHOLD,
      high_gap_contents: highGap,
      low_gap_contents: lowGap,
    },
  };
}
