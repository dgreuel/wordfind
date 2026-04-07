#!/usr/bin/env node
/**
 * Benchmark analysis script.
 *
 * Reads benchmark-results.json (produced by benchmark.mjs), scores models on
 * accuracy / cost / speed, ranks them within pricing tiers, and outputs:
 *   1. A human-readable report to stdout
 *   2. A machine-readable benchmark-summary.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Load results ────────────────────────────────────────────────────

const resultsPath = resolve(ROOT, 'benchmark-results.json');
let results;
try {
  results = JSON.parse(readFileSync(resultsPath, 'utf-8'));
} catch (err) {
  console.error(`Failed to read ${resultsPath}: ${err.message}`);
  process.exit(1);
}

if (!results || typeof results !== 'object' || !results.models) {
  console.error('benchmark-results.json is missing or has no "models" key.');
  process.exit(1);
}

// ── Aggregate per model ─────────────────────────────────────────────

/**
 * Convert accuracy sub-object (recall + precision) to a 0–100 score.
 * Uses the harmonic mean (F1) of recall and precision.
 */
function accuracyScore(acc) {
  if (!acc) return 0;
  const r = acc.recall ?? 0;
  const p = acc.precision ?? 0;
  if (r + p === 0) return 0;
  return ((2 * r * p) / (r + p)) * 100;
}

const modelStats = [];

for (const [modelId, modelResult] of Object.entries(results.models)) {
  const scores = [];
  const costs = [];
  const speeds = [];
  let errors = 0;

  for (const c of modelResult.cases) {
    if (c.error) {
      errors++;
      continue;
    }
    scores.push(accuracyScore(c.accuracy));
    costs.push(c.cost ?? 0);
    speeds.push(c.elapsed ?? 0);
  }

  const total = modelResult.cases.length;
  const accuracy = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const avgCost = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;
  const avgSpeed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;

  modelStats.push({
    model: modelId,
    tier: modelResult.tier || 'unknown',
    accuracy: Math.round(accuracy * 100) / 100,
    avgCost: Math.round(avgCost * 1e6) / 1e6,
    avgSpeed: Math.round(avgSpeed),
    errors,
    totalCases: total,
    successfulCases: scores.length,
  });
}

// ── Tier grouping & ranking ─────────────────────────────────────────

const TIER_ORDER = ['free', 'low', 'mid', 'premium'];

/** Group by tier */
const tiers = {};
for (const tier of TIER_ORDER) tiers[tier] = [];
for (const s of modelStats) {
  const t = TIER_ORDER.includes(s.tier) ? s.tier : 'unknown';
  if (!tiers[t]) tiers[t] = [];
  tiers[t].push(s);
}

/**
 * Within each tier:
 * 1. Filter out models with accuracy < 80%
 * 2. Sort by composite: lower cost×speed product is better (among accurate models)
 *    Tie-break on higher accuracy.
 */
function rankTier(models) {
  const qualified = models.filter(m => m.accuracy >= 80 && m.successfulCases > 0);
  const unqualified = models.filter(m => m.accuracy < 80 || m.successfulCases === 0);

  // Normalise cost and speed for composite scoring.
  // Use rank-based scoring so outliers don't dominate.
  qualified.sort((a, b) => {
    // Primary: accuracy descending
    if (Math.abs(b.accuracy - a.accuracy) > 1) return b.accuracy - a.accuracy;
    // Secondary: cost ascending
    if (a.avgCost !== b.avgCost) return a.avgCost - b.avgCost;
    // Tertiary: speed ascending
    return a.avgSpeed - b.avgSpeed;
  });

  unqualified.sort((a, b) => b.accuracy - a.accuracy);

  return { qualified, unqualified };
}

// ── Output: human-readable report ───────────────────────────────────

const TIER_LABELS = { free: 'Free', low: 'Low-cost', mid: 'Mid-range', premium: 'Premium' };

function pad(str, len, right = false) {
  const s = String(str);
  return right ? s.padStart(len) : s.padEnd(len);
}

function formatCost(c) {
  if (c === 0) return '$0';
  if (c < 0.001) return `$${c.toFixed(6)}`;
  return `$${c.toFixed(4)}`;
}

function formatSpeed(ms) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║           ALLERGEN DETECTION MODEL BENCHMARK REPORT        ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');
const totalCases = modelStats.reduce((sum, m) => sum + m.totalCases, 0);
console.log(`Total models tested: ${modelStats.length}`);
console.log(`Total result entries: ${totalCases}`);
console.log('');

const tierRankings = {};
const recommendations = [];

for (const tier of TIER_ORDER) {
  const models = tiers[tier] || [];
  if (models.length === 0) continue;

  const { qualified, unqualified } = rankTier(models);
  tierRankings[tier] = { qualified, unqualified };

  const label = TIER_LABELS[tier] || tier;
  console.log(`┌─── ${label} Tier (${models.length} models) ${'─'.repeat(Math.max(0, 44 - label.length))}┐`);
  console.log('');

  if (qualified.length === 0) {
    console.log('  No models met the 80% accuracy threshold.');
  } else {
    // Table header
    const hdr = `  ${'#'.padEnd(3)} ${pad('Model', 40)} ${pad('Accuracy', 10, true)} ${pad('Avg Cost', 12, true)} ${pad('Avg Speed', 10, true)}`;
    console.log(hdr);
    console.log('  ' + '─'.repeat(hdr.length - 2));

    const top3 = qualified.slice(0, 3);
    for (let i = 0; i < qualified.length; i++) {
      const m = qualified[i];
      const marker = i < 3 ? ['★', '☆', '·'][i] : ' ';
      const line = `  ${marker} ${String(i + 1).padEnd(2)} ${pad(m.model.slice(0, 39), 40)} ${pad(m.accuracy.toFixed(1) + '%', 10, true)} ${pad(formatCost(m.avgCost), 12, true)} ${pad(formatSpeed(m.avgSpeed), 10, true)}`;
      console.log(line);
    }

    recommendations.push({
      tier,
      top3: top3.map(m => ({
        model: m.model,
        accuracy: m.accuracy,
        avgCost: m.avgCost,
        avgSpeed: m.avgSpeed,
      })),
    });
  }

  if (unqualified.length > 0) {
    console.log('');
    console.log(`  Below threshold (<80% accuracy): ${unqualified.map(m => m.model.split('/').pop()).join(', ')}`);
  }

  console.log('');
  console.log(`└${'─'.repeat(62)}┘`);
  console.log('');
}

// ── Final recommendation ────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║                  SMART ROUTING RECOMMENDATIONS             ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');

for (const rec of recommendations) {
  const label = TIER_LABELS[rec.tier] || rec.tier;
  if (rec.top3.length > 0) {
    const best = rec.top3[0];
    console.log(`  ${label}: ${best.model}`);
    console.log(`    → ${best.accuracy.toFixed(1)}% accuracy, ${formatCost(best.avgCost)}/call, ${formatSpeed(best.avgSpeed)}`);
  }
}

if (recommendations.length === 0) {
  console.log('  No models met the accuracy threshold in any tier.');
}

console.log('');

// ── Output: machine-readable summary ────────────────────────────────

const summary = {
  generatedAt: new Date().toISOString(),
  totalModels: modelStats.length,
  totalResults: totalCases,
  tiers: {},
};

for (const tier of TIER_ORDER) {
  const ranking = tierRankings[tier];
  if (!ranking) continue;
  summary.tiers[tier] = {
    totalModels: (tiers[tier] || []).length,
    qualifiedModels: ranking.qualified.length,
    top3: ranking.qualified.slice(0, 3).map(m => ({
      model: m.model,
      accuracy: m.accuracy,
      avgCost: m.avgCost,
      avgSpeed: m.avgSpeed,
      errors: m.errors,
    })),
    allRanked: ranking.qualified.map(m => ({
      model: m.model,
      accuracy: m.accuracy,
      avgCost: m.avgCost,
      avgSpeed: m.avgSpeed,
    })),
  };
}

const summaryPath = resolve(ROOT, 'benchmark-summary.json');
writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
console.log(`Machine-readable summary written to ${summaryPath}`);
