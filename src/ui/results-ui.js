export function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildHighlightedHTML(text, matches) {
  let html = '';
  let pos = 0;
  for (const m of matches) {
    html += escHtml(text.slice(pos, m.start));
    html += `<mark class="ah" data-cat="${escHtml(m.groupLabel)}">${escHtml(text.slice(m.start, m.end))}</mark>`;
    pos = m.end;
  }
  html += escHtml(text.slice(pos));
  return html;
}

export function buildTagsHTML(groups) {
  return groups.map(g => {
    const tip = g.matchedTerms.join(', ');
    return `<span class="tag found" title="matched: ${escHtml(tip)}">${escHtml(g.label)}</span>`;
  }).join('');
}
