export function clearStepLog(stepLogEl) {
  stepLogEl.innerHTML = '';
  stepLogEl.classList.remove('visible');
}

export function addStepEntry(stepLogEl, modelId, label) {
  const entry = document.createElement('div');
  entry.className = 'step-entry running';
  entry.innerHTML = `
    <div class="step-header">
      <span class="step-model">${label}: <span class="step-model-name">${modelId}</span></span>
      <span class="step-meta"><span class="step-time">running…</span></span>
    </div>`;
  stepLogEl.appendChild(entry);
  stepLogEl.classList.add('visible');
  return entry;
}

export function updateStepEntry(entry, data) {
  const { elapsed, cost, found, text, matches, error, actualModel, buildHighlightedHTML } = data;

  entry.classList.remove('running');
  if (actualModel) {
    entry.querySelector('.step-model-name').textContent = actualModel;
  }

  const meta = entry.querySelector('.step-meta');
  const parts = [`${elapsed}s`];
  if (cost !== null && cost !== undefined && cost > 0) {
    parts.push(`$${cost < 0.001 ? cost.toFixed(6) : cost.toFixed(4)}`);
  }
  meta.innerHTML = parts.map(p => `<span>${p}</span>`).join('');

  if (error) {
    entry.classList.add('error');
    const errEl = document.createElement('div');
    errEl.className = 'step-allergens';
    errEl.innerHTML = `<span class="tag found" style="border-color:#888;color:#888;background:rgba(136,136,136,0.15)">Error: ${error}</span>`;
    entry.appendChild(errEl);
    return;
  }

  if (found && found.length > 0) {
    entry.classList.add('found');
    const allergenDiv = document.createElement('div');
    allergenDiv.className = 'step-allergens';
    allergenDiv.innerHTML = found.map(a => `<span class="tag found">${a}</span>`).join('');
    entry.appendChild(allergenDiv);
  } else {
    entry.classList.add('clear');
    const allergenDiv = document.createElement('div');
    allergenDiv.className = 'step-allergens';
    allergenDiv.innerHTML = '<span class="tag clear">No allergens</span>';
    entry.appendChild(allergenDiv);
  }

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'step-toggle';
  toggleBtn.textContent = 'Show recognized text';
  const textDiv = document.createElement('div');
  textDiv.className = 'step-text ocr-text';
  const { escHtml } = { escHtml: (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') };
  textDiv.innerHTML = matches ? buildHighlightedHTML(text, matches) : escHtml(text);
  toggleBtn.addEventListener('click', () => {
    const open = textDiv.classList.toggle('visible');
    toggleBtn.textContent = open ? 'Hide recognized text' : 'Show recognized text';
  });
  entry.appendChild(toggleBtn);
  entry.appendChild(textDiv);
}
