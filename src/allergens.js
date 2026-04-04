export function T(term, enabled = true) { return { term, enabled }; }

export const DEFAULT_ALLERGEN_GROUPS = [
  { id: 'milk',      label: 'Milk & Dairy',   terms: ['milk','dairy','lactose','casein','whey','butter','cream','cheese','ghee','yogurt','yoghurt','lactalbumin','lactoglobulin','lactulose','nougat','curd','fromage','quark','kefir','buttermilk'].map(t => T(t)) },
  { id: 'egg',       label: 'Egg',            terms: ['egg','eggs','albumin','mayonnaise','mayo','meringue','ovalbumin','ovomucin','ovomucoid','lysozyme','globulin'].map(t => T(t)) },
  { id: 'peanut',    label: 'Peanut',         terms: ['peanut','peanuts','groundnut','groundnuts','arachis oil','arachis','monkey nut','beer nut','beer nuts','mixed nut'].map(t => T(t)) },
  { id: 'tree_nut',  label: 'Tree Nuts',      terms: ['almond','almonds','cashew','cashews','walnut','walnuts','pecan','pecans','pistachio','pistachios','hazelnut','hazelnuts','filbert','filberts','macadamia','brazil nut','brazil nuts','pine nut','pine nuts','pignoli','praline','marzipan','gianduja','nougat'].map(t => T(t)) },
  { id: 'wheat',     label: 'Wheat & Gluten', terms: ['wheat','gluten','wheat flour','enriched flour','bleached flour','unbleached flour','white flour','wheat starch','bulgur','durum','semolina','spelt','kamut','farro','triticale','einkorn','emmer','wheat germ','wheat bran','breadcrumb','bread crumb','rusk','seitan','vital wheat','wheat protein'].map(t => T(t)) },
  { id: 'soy',       label: 'Soy',            terms: ['soy','soya','soybean','soybeans','edamame','miso','tempeh','tofu','tamari','textured vegetable protein','tvp','natto','doenjang','yuba'].map(t => T(t)) },
  { id: 'fish',      label: 'Fish',           terms: ['fish','cod','salmon','tuna','halibut','trout','bass','flounder','haddock','anchovy','anchovies','tilapia','pollock','snapper','mahi','perch','pike','swordfish','herring','sardine','sardines','mackerel','catfish','carp','sole','turbot','worcestershire','fish sauce','surimi'].map(t => T(t)) },
  { id: 'shellfish', label: 'Shellfish',      terms: ['shellfish','shrimp','crab','lobster','crayfish','crawfish','prawn','prawns','barnacle','krill','langoustine','langoustines','scampi'].map(t => T(t)) },
  { id: 'mollusc',   label: 'Molluscs',       terms: ['mollusc','molluscs','mollusk','mollusks','squid','calamari','octopus','clam','clams','oyster','oysters','scallop','scallops','mussel','mussels','snail','escargot','abalone','cuttlefish','whelk','whelks','cockle','cockles'].map(t => T(t)) },
  { id: 'sesame',    label: 'Sesame',         terms: ['sesame','tahini','til','gingelly','benne','sesame oil','sesame seed','sesame seeds'].map(t => T(t)) },
  { id: 'mustard',   label: 'Mustard',        terms: ['mustard','mustard seed','mustard seeds','mustard leaves','mustard oil','mustard flour','mustard powder'].map(t => T(t)) },
  { id: 'celery',    label: 'Celery',         terms: ['celery','celeriac','celery seed','celery seeds','celery oil','celery salt','celery powder'].map(t => T(t)) },
  { id: 'lupin',     label: 'Lupin',          terms: ['lupin','lupine','lupin flour','lupin seed','lupin seeds','lupine flour','lupine bean','lupine beans'].map(t => T(t)) },
  { id: 'sulphite',  label: 'Sulphites',      terms: ['sulphite','sulfite','sulphites','sulfites','sulphur dioxide','sulfur dioxide','e220','e221','e222','e223','e224','e225','e226','e227','e228','so2'].map(t => T(t)) },
];

export const ALLERGEN_STORAGE_KEY = 'allergen_groups_v3';

export let allergens = [];

function migrateTerms(terms) {
  if (!Array.isArray(terms) || terms.length === 0) return [];
  return typeof terms[0] === 'string' ? terms.map(t => T(t)) : terms;
}

export function loadAllergens() {
  const saved = localStorage.getItem(ALLERGEN_STORAGE_KEY);
  if (saved) {
    try {
      allergens = JSON.parse(saved);
      allergens.forEach(a => { a.terms = migrateTerms(a.terms); });
      for (const def of DEFAULT_ALLERGEN_GROUPS) {
        if (!allergens.some(a => a.id === def.id)) {
          allergens.push({ ...def, enabled: true, custom: false });
        }
      }
    } catch { allergens = []; }
  }
  if (allergens.length === 0) {
    allergens = DEFAULT_ALLERGEN_GROUPS.map(g => ({ ...g, enabled: true, custom: false }));
  }
}

export function saveAllergens() {
  const toSave = allergens.map(({ _expanded, ...rest }) => rest);
  localStorage.setItem(ALLERGEN_STORAGE_KEY, JSON.stringify(toSave));
}

export function findAllergensDetailed(text, allergensList) {
  const lower = text.toLowerCase();
  const allMatches = [];
  for (const group of allergensList) {
    if (!group.enabled) continue;
    for (const termObj of group.terms) {
      if (!termObj.enabled) continue;
      const escaped = termObj.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${escaped}\\b`, 'g');
      let m;
      while ((m = re.exec(lower)) !== null) {
        allMatches.push({ start: m.index, end: m.index + m[0].length, term: termObj.term, groupLabel: group.label });
      }
    }
  }
  allMatches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const matches = [];
  let lastEnd = 0;
  for (const m of allMatches) {
    if (m.start >= lastEnd) { matches.push(m); lastEnd = m.end; }
  }
  const groupMap = new Map();
  for (const m of matches) {
    if (!groupMap.has(m.groupLabel)) groupMap.set(m.groupLabel, new Set());
    groupMap.get(m.groupLabel).add(m.term);
  }
  const groups = [...groupMap.entries()].map(([label, terms]) => ({ label, matchedTerms: [...terms] }));
  return { groups, matches };
}

export function findAllergens(text, allergensList) {
  return findAllergensDetailed(text, allergensList).groups.map(g => g.label);
}
