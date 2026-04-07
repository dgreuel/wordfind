export function T(term, enabled = true) { return { term, enabled }; }

export function makeTermChip(group, termObj, hint) {
  const chip = document.createElement('label');
  chip.className = 'term-chip' + (termObj.enabled ? '' : ' term-disabled');

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = termObj.enabled;
  cb.addEventListener('change', (e) => {
    e.stopPropagation();
    termObj.enabled = cb.checked;
    chip.classList.toggle('term-disabled', !cb.checked);
    hint.textContent = group.terms.filter(t => t.enabled).map(t => t.term).join(', ') || '(all disabled)';
    onAllergenChange();
  });

  const span = document.createElement('span');
  span.textContent = termObj.term;

  const removeBtn = document.createElement('button');
  removeBtn.className = 'term-remove';
  removeBtn.textContent = '\u00d7';
  removeBtn.title = 'Remove term';
  removeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const idx = group.terms.indexOf(termObj);
    if (idx !== -1) group.terms.splice(idx, 1);
    chip.remove();
    hint.textContent = group.terms.filter(t => t.enabled).map(t => t.term).join(', ') || '(no terms)';
    onAllergenChange();
  });

  chip.appendChild(cb);
  chip.appendChild(span);
  chip.appendChild(removeBtn);
  return chip;
}

export function addCustomAllergen(name) {
  if (!name) return;
  const existing = allergens.find(a => a.label.toLowerCase() === name.toLowerCase());
  if (existing) {
    if (!existing.enabled) { existing.enabled = true; onAllergenChange(); renderAllergens(); }
    return;
  }
  allergens.push({ id: `custom_${Date.now()}`, label: name, terms: [], enabled: true, custom: true, _expanded: true });
  onAllergenChange();
  renderAllergens();
}

export function updateAllergenCount(allergenCountEl, btnToggleAllEl) {
  const active = allergens.filter(a => a.enabled).length;
  allergenCountEl.textContent = `${active} of ${allergens.length} active`;
  btnToggleAllEl.textContent = active > 0 ? 'Disable all' : 'Enable all';
}

export function renderAllergens(gridEl, allergenCountEl, btnToggleAllEl) {
  gridEl.innerHTML = '';
  for (let i = 0; i < allergens.length; i++) {
    const group = allergens[i];
    const isExpanded = !!group._expanded;

    const item = document.createElement('div');
    item.className = 'allergen-item'
      + (group.enabled ? '' : ' group-disabled')
      + (isExpanded ? ' expanded' : '');

    const header = document.createElement('div');
    header.className = 'allergen-header';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = group.enabled;
    cb.title = group.enabled ? 'Disable group' : 'Enable group';
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      group.enabled = cb.checked;
      item.classList.toggle('group-disabled', !group.enabled);
      onAllergenChange();
    });

    const body = document.createElement('div');
    body.className = 'item-body';

    const labelEl = document.createElement('span');
    labelEl.className = 'label';
    labelEl.textContent = group.label;

    const hint = document.createElement('span');
    hint.className = 'terms-hint';
    hint.textContent = group.terms.filter(t => t.enabled).map(t => t.term).join(', ') || '(all disabled)';

    body.appendChild(labelEl);
    body.appendChild(hint);

    const expandBtn = document.createElement('button');
    expandBtn.className = 'expand-btn';
    expandBtn.innerHTML = '&#9658;';
    expandBtn.title = 'Expand / collapse';
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      group._expanded = !group._expanded;
      item.classList.toggle('expanded', group._expanded);
    });

    header.addEventListener('click', () => {
      group._expanded = !group._expanded;
      item.classList.toggle('expanded', group._expanded);
    });

    header.appendChild(cb);
    header.appendChild(body);
    header.appendChild(expandBtn);

    if (group.custom) {
      const rmGroup = document.createElement('button');
      rmGroup.className = 'remove-group-btn';
      rmGroup.textContent = '\u00d7';
      rmGroup.title = 'Remove category';
      rmGroup.addEventListener('click', (e) => {
        e.stopPropagation();
        allergens.splice(i, 1);
        onAllergenChange();
        renderAllergens(gridEl, allergenCountEl, btnToggleAllEl);
      });
      header.appendChild(rmGroup);
    }

    item.appendChild(header);

    const bodyDiv = document.createElement('div');
    bodyDiv.className = 'allergen-body';

    const termsGrid = document.createElement('div');
    termsGrid.className = 'terms-grid';
    for (const termObj of group.terms) {
      termsGrid.appendChild(makeTermChip(group, termObj, hint));
    }
    bodyDiv.appendChild(termsGrid);

    const addTermRow = document.createElement('div');
    addTermRow.className = 'add-term-row';
    const termInput = document.createElement('input');
    termInput.type = 'text';
    termInput.placeholder = 'Add term…';
    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add';

    const doAddTerm = () => {
      const val = termInput.value.trim().toLowerCase();
      termInput.value = '';
      if (!val || group.terms.some(t => t.term === val)) return;
      const termObj = { term: val, enabled: true };
      group.terms.push(termObj);
      termsGrid.appendChild(makeTermChip(group, termObj, hint));
      hint.textContent = group.terms.filter(t => t.enabled).map(t => t.term).join(', ');
      onAllergenChange();
      termInput.focus();
    };
    addBtn.addEventListener('click', (e) => { e.stopPropagation(); doAddTerm(); });
    termInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.stopPropagation(); doAddTerm(); } });
    termInput.addEventListener('click', e => e.stopPropagation());

    addTermRow.appendChild(termInput);
    addTermRow.appendChild(addBtn);
    bodyDiv.appendChild(addTermRow);

    item.appendChild(bodyDiv);
    gridEl.appendChild(item);
  }
  updateAllergenCount(allergenCountEl, btnToggleAllEl);
}

export function initAllergens(gridEl, allergenCountEl, btnToggleAllEl, opts = {}) {
  if (opts.onChange) onAllergenChange = opts.onChange;
  if (opts.defaultGroups) DEFAULT_ALLERGEN_GROUPS = opts.defaultGroups;
  if (opts.storageKey) ALLERGEN_STORAGE_KEY = opts.storageKey;
  loadAllergens();
  renderAllergens(gridEl, allergenCountEl, btnToggleAllEl);
}

let allergens = [];

const ALLERGEN_STORAGE_KEY = 'allergen_groups_v3';

const DEFAULT_ALLERGEN_GROUPS = [
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

let onAllergenChange = () => {};

function migrateTerms(terms) {
  if (!Array.isArray(terms) || terms.length === 0) return [];
  return typeof terms[0] === 'string' ? terms.map(t => T(t)) : terms;
}

function loadAllergens() {
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
  onAllergenChange();
}

export function getAllergens() {
  return allergens;
}
