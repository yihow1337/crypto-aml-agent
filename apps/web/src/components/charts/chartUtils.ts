/** Escape untrusted text (address labels, tool output) before putting it in ECharts HTML tooltips. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Tooltip row keyed by a short line of the series colour; value leads, label follows. */
export function tipRow(color: string, label: string, value: string): string {
  return (
    `<div style="display:flex;align-items:center;gap:8px;line-height:1.7">` +
    `<span style="display:inline-block;width:10px;height:2px;border-radius:1px;background:${color}"></span>` +
    `<b style="font-weight:600">${esc(value)}</b>` +
    `<span style="color:#b4c0d3">${esc(label)}</span></div>`
  );
}

export function tipTitle(text: string): string {
  return `<div style="color:#b4c0d3;font-size:11px;margin-bottom:2px">${esc(text)}</div>`;
}

export function tipLine(label: string, value: string, mono = false): string {
  return (
    `<div style="line-height:1.7"><span style="color:#8b98b0">${esc(label)}</span> ` +
    `<span style="${mono ? 'font-family:var(--font-mono),monospace;' : ''}">${esc(value)}</span></div>`
  );
}
