import { escHtml, buildHighlightedHTML, buildTagsHTML } from './utils.js';
import { STORAGE_KEYS } from './state.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`PASS: ${message}`);
}

console.log('Testing utils.js...');

assert(escHtml('<script>') === '&lt;script&gt;', 'escHtml escapes HTML entities');
assert(escHtml('a & b < c > d') === 'a &amp; b &lt; c &gt; d', 'escHtml handles all entities');
assert(escHtml('') === '', 'escHtml handles empty string');
assert(escHtml('plain text') === 'plain text', 'escHtml passes through plain text');

const matches = [
  { start: 0, end: 4, term: 'milk', groupLabel: 'Milk & Dairy' },
  { start: 9, end: 13, term: 'egg', groupLabel: 'Egg' }
];
const highlighted = buildHighlightedHTML('milk and eggs', matches);
assert(highlighted.includes('<mark class="ah"'), 'buildHighlightedHTML creates marks');
assert(highlighted.includes('data-cat="Milk &amp; Dairy"'), 'buildHighlightedHTML escapes data-cat');
assert(highlighted.includes('milk') && highlighted.includes('eggs'), 'buildHighlightedHTML preserves text content');

const groups = [
  { label: 'Milk', matchedTerms: ['milk', 'dairy'] },
  { label: 'Eggs', matchedTerms: ['egg', 'eggs'] }
];
const tags = buildTagsHTML(groups);
assert(tags.includes('class="tag found"'), 'buildTagsHTML creates tag spans');
assert(tags.includes('title="matched: milk, dairy"'), 'buildTagsHTML escapes title attribute');
assert(tags.includes('Milk') && tags.includes('Eggs'), 'buildTagsHTML preserves labels');

console.log('\nTesting state.js...');
assert(STORAGE_KEYS.STORAGE_KEY === 'openrouter_api_key', 'STORAGE_KEYS.STORAGE_KEY exported correctly');
assert(STORAGE_KEYS.MODEL_STORAGE_KEY === 'openrouter_model', 'STORAGE_KEYS.MODEL_STORAGE_KEY exported correctly');
assert(STORAGE_KEYS.MODELS_CACHE_KEY === 'openrouter_models_cache', 'STORAGE_KEYS.MODELS_CACHE_KEY exported correctly');

console.log('\nAll tests passed!');
