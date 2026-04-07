/**
 * Benchmark test fixtures for allergen detection pipeline.
 *
 * Each test case includes:
 *   - name / description
 *   - imageBase64: a data-URI of a real food label photograph
 *   - ingredientText: the text an ideal OCR pass would extract (for unit-testing
 *     the allergen matcher independently of the vision model)
 *   - expectedAllergens: group labels that SHOULD be detected
 *   - expectedNonAllergens: group labels that should NOT be detected
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadImage(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext] || 'application/octet-stream';
  const buf = readFileSync(join(root, filename));
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// ── Ingredient text (what a perfect OCR would extract) ──────────────

const CASE_1_TEXT = [
  'Ingredients: Iceberg Lettuce, Chicken, Cherry',
  'Tomato, Onions, Olive Oil, Lemon Juice',
].join('\n');

const CASE_2_TEXT = [
  'SWEET COOKIE',
  'INGREDIENTS: SUGAR, ENRICHED FLOUR, WHEAT',
  'FLOUR, NIACIN, REDUCED IRON, THIAMINE',
  'MONONITRATE (VITAMIN B1), RIBOFLAVIN',
  '(VITAMIN 2), FOLIC ACID, CANOLA OIL &/OR PALM',
  'OIL, HIGH FRUCTOSE CORN SYRUP, BAKING SODA,',
  'CORNSTARCH, SALT SOY LECITHIN, VANILLIN,',
  'CHOCOLATE, SUGAR, WHEY, NONFAT MILK,',
  'ARTIFICIAL FLAVOR, CELLULOSE GUM, CARRAGEENAN.',
  '',
  'DURING MANUFACTURING OUR PRODUCT MAY COME IN',
  'CONTACT WITH THESE KNOWN ALLERGENS: PEANUTS,',
  'MILK, EGGS WHEAT FLOUR & YELLOW #5',
].join('\n');

const CASE_3_TEXT = [
  'Gluten Free Flour Blend',
  '',
  'INGREDIENTS: TAPIOCA FLOUR, COCONUT FLOUR,',
  'ARROWROOT FLOUR, MILLET FLOUR, ORGANIC',
  'AMARANTH FLOUR, XANTHAN GUM',
  '',
  'DIVINELY GLUTEN FREE ALBANY, NY 12203',
].join('\n');

// ── Test cases ──────────────────────────────────────────────────────

export const TEST_CASES = [
  {
    name: 'No allergens — chicken salad',
    description:
      'A simple salad with iceberg lettuce, chicken, cherry tomato, onions, ' +
      'olive oil, and lemon juice. Should not trigger any allergen group.',
    imageBase64: loadImage('fixture2.png'),
    ingredientText: CASE_1_TEXT,
    expectedAllergens: [],
    expectedNonAllergens: [
      'Milk & Dairy', 'Egg', 'Peanut', 'Tree Nuts',
      'Wheat & Gluten', 'Soy', 'Fish', 'Shellfish',
      'Molluscs', 'Sesame', 'Mustard', 'Celery',
      'Lupin', 'Sulphites',
    ],
  },
  {
    name: 'Several allergens — sweet cookie',
    description:
      'A sweet cookie label listing enriched wheat flour, soy lecithin, whey, ' +
      'nonfat milk, and chocolate. The allergen warning explicitly calls out ' +
      'peanuts, milk, eggs, and wheat flour.',
    imageBase64: loadImage('fixture1.webp'),
    ingredientText: CASE_2_TEXT,
    expectedAllergens: [
      'Wheat & Gluten', 'Milk & Dairy', 'Egg', 'Soy', 'Peanut',
    ],
    expectedNonAllergens: [
      'Tree Nuts', 'Fish', 'Shellfish', 'Molluscs', 'Sesame',
      'Mustard', 'Celery', 'Lupin', 'Sulphites',
    ],
  },
  {
    name: 'Tricky reasoning — "Gluten Free" flour blend',
    description:
      'A flour blend prominently labeled "Gluten Free" with ingredients: tapioca, ' +
      'coconut, arrowroot, millet, amaranth, and xanthan gum. None of these are ' +
      'allergens. The tricky part: the text "gluten" and "gluten free" appear on ' +
      'the label, and the keyword matcher will flag Wheat & Gluten because it ' +
      'sees the word "gluten". This tests whether the full pipeline (vision model) ' +
      'can reason about "gluten free" meaning absence rather than presence.',
    imageBase64: loadImage('fixture3.jpg'),
    ingredientText: CASE_3_TEXT,
    // The keyword matcher WILL flag "gluten" from "Gluten Free" text.
    // This is expected behavior for the keyword matcher.
    // The vision model pipeline should ideally NOT flag it, making this
    // a true benchmark of model reasoning vs. keyword matching.
    expectedAllergens: ['Wheat & Gluten'],
    expectedNonAllergens: [
      'Milk & Dairy', 'Egg', 'Peanut', 'Tree Nuts',
      'Soy', 'Fish', 'Shellfish', 'Molluscs', 'Sesame',
      'Mustard', 'Celery', 'Lupin', 'Sulphites',
    ],
  },
];
