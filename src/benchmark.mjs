#!/usr/bin/env node

/**
 * Benchmark runner for allergen detection pipeline.
 *
 * Fetches vision models from OpenRouter, runs each test case against each model,
 * measures timing and cost, scores allergen detection accuracy, and saves results.
 *
 * Usage:
 *   node src/benchmark.mjs                  # run all tiers
 *   node src/benchmark.mjs --tier free      # run only free-tier models
 *   node src/benchmark.mjs --tier low
 *   node src/benchmark.mjs --tier mid
 *   node src/benchmark.mjs --tier premium
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_CASES } from './benchmark-fixtures.mjs';
import { findAllergens, DEFAULT_ALLERGEN_GROUPS } from './allergens.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Load API key from .env ──────────────────────────────────────────

function loadApiKey() {
  try {
    const envContent = readFileSync(resolve(ROOT, '.env'), 'utf-8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^OPENROUTER_API_KEY\s*=\s*(.+)/);
      if (match) return match[1].trim();
    }
  } catch {}
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  throw new Error('No OPENROUTER_API_KEY found in .env or environment');
}

const API_KEY = loadApiKey();

const OCR_PROMPT =
  'Extract ALL text from this image exactly as written. This is a food ingredient label. Output ONLY the raw text, nothing else — no commentary, no formatting, no markdown. Preserve line breaks where they appear.';

// ── CLI args ────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const tierFlagIdx = args.indexOf('--tier');
const TIER_FILTER = tierFlagIdx !== -1 ? args[tierFlagIdx + 1] : null;
const VALID_TIERS = ['free', 'low', 'mid'] //, 'premium']; don't make expensive requests for no reason

if (TIER_FILTER && !VALID_TIERS.includes(TIER_FILTER)) {
  console.error(`Invalid tier "${TIER_FILTER}". Valid: ${VALID_TIERS.join(', ')}`);
  process.exit(1);
}

// ── Fetch vision models ─────────────────────────────────────────────

async function fetchVisionModels() {
  console.log('Fetching model list from OpenRouter...');
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`);
  const { data } = await res.json();

  // Filter to models that support image/vision input
  const visionModels = data.filter((m) => {
    const modalities = m.input_modalities || m.architecture?.input_modalities || [];
    return modalities.includes('image');
  });

  console.log(`Found ${visionModels.length} vision-capable models out of ${data.length} total`);
  return visionModels;
}

// ── Group models by price tier ──────────────────────────────────────

function groupByTier(models) {
  const tiers = { free: [], low: [], mid: [], premium: [] };

  for (const m of models) {
    const pricePerToken = parseFloat(m.pricing?.prompt || '0');
    const pricePerM = pricePerToken * 1_000_000;
    const entry = {
      id: m.id,
      name: m.name || m.id,
      pricePerMInput: pricePerM,
      pricePerMOutput: parseFloat(m.pricing?.completion || '0') * 1_000_000,
    };

    if (pricePerM === 0) tiers.free.push(entry);
    else if (pricePerM < 0.50) tiers.low.push(entry);
    else if (pricePerM <= 5) tiers.mid.push(entry);
    else tiers.premium.push(entry);
  }

  // Sort each tier by input price
  for (const tier of Object.values(tiers)) {
    tier.sort((a, b) => a.pricePerMInput - b.pricePerMInput);
  }

  return tiers;
}

// ── Call a single model (non-streaming) ─────────────────────────────

async function callModel(modelId, imageBase64) {
  const start = Date.now();

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: OCR_PROMPT },
            { type: 'image_url', image_url: { url: imageBase64 } },
          ],
        },
      ],
      max_tokens: 1024,
      temperature: 0,
    }),
  });

  const elapsed = Date.now() - start;

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body.error?.message || `HTTP ${res.status}`;
    return { error: msg, status: res.status, elapsed };
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  const generationId = data.id || null;
  const resolvedModel = data.model || modelId;

  return { text, generationId, resolvedModel, elapsed };
}

// ── Poll cost from generation API ───────────────────────────────────

async function pollCost(generationId) {
  if (!generationId) return null;

  // Wait a bit for cost data to be available
  const delays = [3000, 5000, 8000];
  for (const delay of delays) {
    await sleep(delay);
    try {
      const res = await fetch(
        `https://openrouter.ai/api/v1/generation?id=${generationId}`,
        { headers: { Authorization: `Bearer ${API_KEY}` } }
      );
      if (res.ok) {
        const data = await res.json();
        const cost = data?.data?.total_cost ?? null;
        if (cost !== null && cost > 0) return cost;
      }
    } catch {}
  }
  return null;
}

// ── Accuracy scoring ────────────────────────────────────────────────

function scoreAccuracy(detectedLabels, expectedAllergens, expectedNonAllergens) {
  const detected = new Set(detectedLabels);

  let truePositives = 0;
  let missedAllergens = [];
  for (const label of expectedAllergens) {
    if (detected.has(label)) truePositives++;
    else missedAllergens.push(label);
  }

  let falsePositives = [];
  for (const label of expectedNonAllergens) {
    if (detected.has(label)) falsePositives.push(label);
  }

  const recall = expectedAllergens.length > 0 ? truePositives / expectedAllergens.length : 1;
  const precision =
    detectedLabels.length > 0
      ? truePositives / detectedLabels.length
      : expectedAllergens.length === 0
        ? 1
        : 0;

  return {
    truePositives,
    totalExpected: expectedAllergens.length,
    missedAllergens,
    falsePositives,
    recall,
    precision,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function prepareAllergenGroups() {
  return DEFAULT_ALLERGEN_GROUPS.map((g) => ({ ...g, enabled: true }));
}

// ── Main benchmark loop ─────────────────────────────────────────────

async function main() {
  const visionModels = await fetchVisionModels();
  const tiers = groupByTier(visionModels);

  // Display tier summary
  console.log('\nModel tiers:');
  for (const [tier, models] of Object.entries(tiers)) {
    console.log(`  ${tier}: ${models.length} models`);
  }

  // Determine which tiers to run
  const tiersToRun = TIER_FILTER ? { [TIER_FILTER]: tiers[TIER_FILTER] || [] } : tiers;

  const allergenGroups = prepareAllergenGroups();
  const results = {
    timestamp: new Date().toISOString(),
    tierFilter: TIER_FILTER || 'all',
    testCases: TEST_CASES.map((tc) => ({ name: tc.name, expectedAllergens: tc.expectedAllergens })),
    models: {},
  };

  let totalRuns = 0;
  let totalErrors = 0;

  for (const [tierName, models] of Object.entries(tiersToRun)) {
    if (models.length === 0) {
      console.log(`\nSkipping tier "${tierName}" — no models`);
      continue;
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Tier: ${tierName} (${models.length} models)`);
    console.log('═'.repeat(60));

    for (const model of models) {
      console.log(`\n  Model: ${model.name} (${model.id})`);
      console.log(`  Price: $${model.pricePerMInput}/M input, $${model.pricePerMOutput}/M output`);

      const modelResult = {
        id: model.id,
        name: model.name,
        tier: tierName,
        pricePerMInput: model.pricePerMInput,
        pricePerMOutput: model.pricePerMOutput,
        cases: [],
      };

      for (const testCase of TEST_CASES) {
        totalRuns++;
        console.log(`    Case: "${testCase.name}"...`);

        const response = await callModel(model.id, testCase.imageBase64);

        if (response.error) {
          totalErrors++;
          const isRateLimit = response.status === 429;
          const isUnavailable = response.status === 503 || response.status === 502;

          console.log(`      ❌ Error: ${response.error}`);

          modelResult.cases.push({
            caseName: testCase.name,
            error: response.error,
            status: response.status,
            elapsed: response.elapsed,
            isRateLimit,
            isUnavailable,
          });

          // Back off on rate limit
          if (isRateLimit) {
            console.log('      Backing off 10s for rate limit...');
            await sleep(10000);
          }

          continue;
        }

        // Run allergen detection on extracted text
        const detectedLabels = findAllergens(response.text, allergenGroups);
        const accuracy = scoreAccuracy(
          detectedLabels,
          testCase.expectedAllergens,
          testCase.expectedNonAllergens
        );

        console.log(
          `      ✓ ${response.elapsed}ms | ` +
            `recall=${(accuracy.recall * 100).toFixed(0)}% ` +
            `precision=${(accuracy.precision * 100).toFixed(0)}% | ` +
            `detected: [${detectedLabels.join(', ')}]`
        );

        if (accuracy.missedAllergens.length > 0) {
          console.log(`      ⚠ Missed: [${accuracy.missedAllergens.join(', ')}]`);
        }
        if (accuracy.falsePositives.length > 0) {
          console.log(`      ⚠ False positives: [${accuracy.falsePositives.join(', ')}]`);
        }

        const caseResult = {
          caseName: testCase.name,
          extractedText: response.text,
          resolvedModel: response.resolvedModel,
          generationId: response.generationId,
          elapsed: response.elapsed,
          detectedAllergens: detectedLabels,
          accuracy,
          cost: null,
        };

        // Poll cost in background — collect later
        if (response.generationId) {
          caseResult._costPromise = pollCost(response.generationId).then((cost) => {
            caseResult.cost = cost;
            if (cost !== null) {
              console.log(`      💰 Cost: $${cost.toFixed(6)}`);
            }
          });
        }

        modelResult.cases.push(caseResult);

        // Rate limit delay between requests
        await sleep(1500);
      }

      results.models[model.id] = modelResult;
    }
  }

  // Wait for all pending cost polls to finish
  console.log('\nWaiting for cost data...');
  const costPromises = [];
  for (const modelResult of Object.values(results.models)) {
    for (const caseResult of modelResult.cases) {
      if (caseResult._costPromise) {
        costPromises.push(caseResult._costPromise);
        delete caseResult._costPromise;
      }
    }
  }
  await Promise.allSettled(costPromises);

  // Clean up internal fields before saving
  for (const modelResult of Object.values(results.models)) {
    for (const caseResult of modelResult.cases) {
      delete caseResult._costPromise;
    }
  }

  // Save results
  const outPath = resolve(ROOT, 'benchmark-results.json');
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to ${outPath}`);

  // Print summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log('SUMMARY');
  console.log('═'.repeat(60));
  console.log(`Total runs: ${totalRuns} | Errors: ${totalErrors}`);

  for (const [modelId, modelResult] of Object.entries(results.models)) {
    const successful = modelResult.cases.filter((c) => !c.error);
    if (successful.length === 0) continue;

    const avgRecall =
      successful.reduce((sum, c) => sum + c.accuracy.recall, 0) / successful.length;
    const avgPrecision =
      successful.reduce((sum, c) => sum + c.accuracy.precision, 0) / successful.length;
    const avgTime = successful.reduce((sum, c) => sum + c.elapsed, 0) / successful.length;
    const totalCost = successful.reduce((sum, c) => sum + (c.cost || 0), 0);

    console.log(
      `  ${modelResult.name}: ` +
        `recall=${(avgRecall * 100).toFixed(0)}% ` +
        `precision=${(avgPrecision * 100).toFixed(0)}% ` +
        `avg=${avgTime.toFixed(0)}ms ` +
        `cost=$${totalCost.toFixed(6)}`
    );
  }
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
