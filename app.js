'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CARD_W = 85.6; // mm, ISO/IEC 7810 ID-1 (credit-card size)
const CARD_H = 54;
const MM_TO_PX = 96 / 25.4;
const PAPER = {
  letter: { w: 215.9, h: 279.4, css: 'letter' },
  a4: { w: 210, h: 297, css: 'A4' }
};
const DEFAULT_LOGO = 'assets/geodis-logo.png';
const STORAGE_KEY = 'idcard-studio:v1';

const SAMPLE_PEOPLE = [
  'full_name',
  'Jordan Lee',
  'Priya Patel',
  'Marcus Chen',
  'Sofia Rossi',
  'Omar Haddad',
  "Emily O'Brien",
  'María García-López',
  'Aisha Khan',
  'Daniel Kim',
  'Jamie Lee'
].join('\n');

// Header names we recognise, after normalising (lowercase, punctuation → space).
const HEADER_ALIASES = {
  name: ['full name', 'fullname', 'name', 'employee name', 'employee', 'associate name', 'associate'],
  first: ['first name', 'firstname', 'first', 'given name'],
  last: ['last name', 'lastname', 'last', 'surname', 'family name'],
  id: ['user id', 'userid', 'id', 'employee id', 'badge', 'badge id', 'badge number', 'login', 'username']
};

// Inputs whose values are saved and trigger a re-render.
const SETTING_IDS = [
  'csvInput', 'idMaxLen', 'companyName', 'companySubtitle', 'accentColor',
  'showIdText', 'pageSize', 'orientation', 'pagePadding', 'gridGap', 'cutMarks'
];

const $ = (id) => document.getElementById(id);
const refs = Object.fromEntries(
  [...SETTING_IDS, 'csvFile', 'dropzone', 'logoUpload', 'logoClear', 'accentHex', 'fitInfo',
    'summary', 'printBtn', 'exportBtn', 'sampleBtn', 'resetBtn', 'rosterBody', 'rosterCount',
    'preview', 'previewWrap', 'pageRule', 'formatsBtn', 'formats'].map((id) => [id, $(id)])
);

const state = {
  logo: DEFAULT_LOGO, // URL/data URL, or null for "no logo"
  people: []
};

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------
function readNumber(el, fallback) {
  const n = parseFloat(el.value);
  if (!Number.isFinite(n)) return fallback;
  const min = el.min === '' ? -Infinity : Number(el.min);
  const max = el.max === '' ? Infinity : Number(el.max);
  return Math.min(max, Math.max(min, n));
}

function getSettings() {
  return {
    maxLen: Math.round(readNumber(refs.idMaxLen, 12)),
    margin: readNumber(refs.pagePadding, 8),
    gap: readNumber(refs.gridGap, 4),
    paper: PAPER[refs.pageSize.value] || PAPER.letter,
    landscape: refs.orientation.value === 'landscape'
  };
}

function saveSettings() {
  const data = { logo: state.logo };
  SETTING_IDS.forEach((id) => {
    const el = refs[id];
    data[id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage full (large logo) or unavailable — retry without the logo.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, logo: DEFAULT_LOGO }));
    } catch { /* ignore */ }
  }
}

function loadSettings() {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch { /* ignore */ }

  if (!data) {
    refs.csvInput.value = SAMPLE_PEOPLE;
    return;
  }
  SETTING_IDS.forEach((id) => {
    if (!(id in data)) return;
    const el = refs[id];
    if (el.type === 'checkbox') el.checked = Boolean(data[id]);
    else el.value = data[id];
  });
  if ('logo' in data) state.logo = data.logo;
}

// ---------------------------------------------------------------------------
// User IDs
// ---------------------------------------------------------------------------
// Strip accents and anything that isn't A–Z / 0–9, then uppercase.
function sanitizeId(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
}

// "Anne Jotheeswaran" -> "AJOTHEESWARAN" (untruncated; caller applies max length)
function generateId(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return sanitizeId(parts[0]);
  return sanitizeId(parts[0]).slice(0, 1) + sanitizeId(parts[parts.length - 1]);
}

// ---------------------------------------------------------------------------
// CSV / pasted text parsing
// ---------------------------------------------------------------------------
// Picks the delimiter from the first line: tab (pasted from Excel/Sheets),
// semicolon (European Excel), otherwise comma.
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  if (firstLine.includes('\t')) return '\t';
  const semis = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return semis > commas ? ';' : ',';
}

// RFC 4180-style parser: handles quoted fields, escaped quotes ("") and
// line breaks inside quotes.
function parseRows(text, delim) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === delim) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell.trim());
  rows.push(row);
  return rows.filter((r) => r.some((c) => c !== ''));
}

function headerRole(cell) {
  const key = cell.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  return Object.keys(HEADER_ALIASES).find((role) => HEADER_ALIASES[role].includes(key)) || null;
}

// Turns raw text into [{ name, rawId, line }].
function parseInput(text) {
  const clean = String(text || '').replace(/^﻿/, ''); // strip Excel BOM
  if (!clean.trim()) return [];
  const rows = parseRows(clean, detectDelimiter(clean));
  if (!rows.length) return [];

  const roles = rows[0].map(headerRole);
  const hasHeader = roles.some(Boolean);
  const col = {};
  if (hasHeader) roles.forEach((role, i) => { if (role && !(role in col)) col[role] = i; });

  const out = [];
  rows.slice(hasHeader ? 1 : 0).forEach((cols, idx) => {
    const line = idx + (hasHeader ? 2 : 1);
    let name = '';
    let rawId = '';

    if (hasHeader) {
      const pick = (role) => (role in col ? cols[col[role]] || '' : '');
      name = pick('name') || [pick('first'), pick('last')].filter(Boolean).join(' ');
      rawId = pick('id');
    } else if (cols.length === 1) {
      name = cols[0];
    } else if (/\s/.test(cols[0])) {
      // "Full Name,ID"
      [name, rawId] = cols;
    } else if (/\s/.test(cols[1])) {
      // "ID,Full Name"
      [rawId, name] = cols;
    } else if (cols.length >= 3) {
      // "First,Last,ID"
      name = `${cols[0]} ${cols[1]}`;
      rawId = cols[2];
    } else if (/\d/.test(cols[1]) && !/\d/.test(cols[0])) {
      // "Cher,CHER01"
      [name, rawId] = cols;
    } else {
      // "First,Last"
      name = `${cols[0]} ${cols[1]}`;
    }

    name = name.replace(/\s+/g, ' ').trim();
    if (name || rawId) out.push({ name, rawId: rawId.trim(), line });
  });
  return out;
}

// Assigns final IDs and collects per-person notes.
// - IDs supplied in the data are kept as-is (they're real system IDs), but
//   duplicates among them are flagged as errors.
// - Generated IDs never collide with supplied or earlier generated IDs, and
//   numeric suffixes stay within the max length.
function buildPeople(rows, maxLen) {
  const supplied = new Map();
  rows.forEach((r) => {
    const id = sanitizeId(r.rawId);
    if (id) supplied.set(id, (supplied.get(id) || 0) + 1);
  });

  const taken = new Set(supplied.keys());
  return rows.map((r) => {
    const notes = [];
    let level = 'ok';
    const warn = (msg) => { notes.push(msg); if (level === 'ok') level = 'warn'; };
    const fail = (msg) => { notes.push(msg); level = 'error'; };
    let userId = sanitizeId(r.rawId);

    if (!r.name) fail('Missing name');

    if (userId) {
      if (userId !== r.rawId.toUpperCase()) warn(`ID cleaned from "${r.rawId}"`);
      if (supplied.get(userId) > 1) fail('Duplicate ID in your data');
    } else if (r.name) {
      const full = generateId(r.name);
      if (!full) {
        fail('Couldn’t generate an ID — add a user_id column');
      } else {
        let base = full.slice(0, maxLen);
        if (full.length > maxLen) warn(`Shortened to ${maxLen} characters`);
        userId = base;
        for (let n = 2; taken.has(userId); n += 1) {
          const suffix = String(n);
          userId = base.slice(0, maxLen - suffix.length) + suffix;
        }
        if (userId !== base) warn(`${base} already used`);
        taken.add(userId);
      }
    }

    return { name: r.name, userId, line: r.line, notes, level };
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function readableTextOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? '#111827' : '#ffffff';
}

function layoutFor(s) {
  const pageW = s.landscape ? s.paper.h : s.paper.w;
  const pageH = s.landscape ? s.paper.w : s.paper.h;
  const cols = Math.max(0, Math.floor((pageW - 2 * s.margin + s.gap) / (CARD_W + s.gap)));
  const rows = Math.max(0, Math.floor((pageH - 2 * s.margin + s.gap) / (CARD_H + s.gap)));
  return { pageW, pageH, cols, rows, perPage: cols * rows };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function createCard(person, opts) {
  const card = el('article', 'card');

  const header = el('header', 'card-header');
  if (state.logo) {
    const chip = el('div', 'card-logo');
    const img = el('img');
    img.src = state.logo;
    img.alt = '';
    img.onerror = () => chip.remove();
    chip.append(img);
    header.append(chip);
  }
  const copy = el('div', 'card-heading');
  if (opts.title) copy.append(el('div', 'card-title', opts.title));
  if (opts.subtitle) copy.append(el('div', 'card-subtitle', opts.subtitle));
  header.append(copy);

  const name = el('div', 'card-name', person.name);

  const code = el('div', 'card-code');
  const { svg, modules } = Code128.toSvg(person.userId);
  // Cap the narrowest bar at 0.5 mm so short IDs don't print comically wide.
  svg.style.width = `min(100%, ${(modules * 0.5).toFixed(2)}mm)`;
  code.append(svg);
  if (opts.showIdText) code.append(el('div', 'card-id', person.userId));

  card.append(header, name, code);
  return card;
}

// Shrinks long names until they fit their box (max two lines).
function fitNames(root) {
  root.querySelectorAll('.card-name').forEach((node) => {
    let size = 4.6;
    node.style.fontSize = `${size}mm`;
    while (size > 2.4 && (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)) {
      size -= 0.2;
      node.style.fontSize = `${size}mm`;
    }
  });
}

function renderRoster(people) {
  const body = refs.rosterBody;
  body.replaceChildren();
  people.forEach((p, i) => {
    const tr = el('tr', `level-${p.level}`);
    tr.append(
      el('td', 'num', String(i + 1)),
      el('td', null, p.name || '—'),
      el('td', 'mono', p.userId || '—'),
      el('td', 'notes', p.notes.join(' · '))
    );
    body.append(tr);
  });
  refs.rosterCount.textContent = people.length ? `(${people.length})` : '';
}

function setSummary(parts, tone) {
  refs.summary.replaceChildren(...parts.map((p) => (typeof p === 'string' ? document.createTextNode(p) : p)));
  refs.summary.dataset.tone = tone || '';
}

function fitPreview(pageW) {
  const avail = refs.previewWrap.clientWidth - 32;
  const zoom = Math.min(1, avail / (pageW * MM_TO_PX));
  refs.preview.style.zoom = zoom > 0 ? zoom.toFixed(3) : '1';
}

function render() {
  const s = getSettings();
  const layout = layoutFor(s);
  const accent = refs.accentColor.value;
  const root = document.documentElement.style;

  root.setProperty('--page-w', `${layout.pageW}mm`);
  root.setProperty('--page-h', `${layout.pageH}mm`);
  root.setProperty('--page-pad', `${s.margin}mm`);
  root.setProperty('--gap', `${s.gap}mm`);
  root.setProperty('--cols', String(Math.max(1, layout.cols)));
  root.setProperty('--accent', accent);
  root.setProperty('--on-accent', readableTextOn(accent));
  refs.accentHex.textContent = accent;
  refs.pageRule.textContent = `@page { size: ${s.paper.css} ${s.landscape ? 'landscape' : 'portrait'}; margin: 0; }`;
  document.body.classList.toggle('no-outlines', !refs.cutMarks.checked);

  state.people = buildPeople(parseInput(refs.csvInput.value), s.maxLen);
  // Rows with errors (no name, no ID, duplicate ID) are listed but not printed.
  const printable = state.people.filter((p) => p.level !== 'error');
  renderRoster(state.people);

  refs.preview.replaceChildren();
  refs.exportBtn.disabled = state.people.length === 0;
  saveSettings();

  if (!layout.perPage) {
    refs.fitInfo.textContent = 'Cards don’t fit — reduce the margin or gap.';
    refs.fitInfo.dataset.tone = 'error';
    setSummary(['Cards don’t fit on the page with these margins.'], 'error');
    refs.printBtn.disabled = true;
    return;
  }
  refs.fitInfo.textContent = `${layout.perPage} cards per page (${layout.cols} × ${layout.rows})`;
  refs.fitInfo.dataset.tone = '';

  const opts = {
    title: refs.companyName.value.trim(),
    subtitle: refs.companySubtitle.value.trim(),
    showIdText: refs.showIdText.checked
  };

  const frag = document.createDocumentFragment();
  for (let i = 0; i < printable.length; i += layout.perPage) {
    const page = el('div', 'page');
    printable.slice(i, i + layout.perPage).forEach((p) => page.append(createCard(p, opts)));
    frag.append(page);
  }
  refs.preview.append(frag);
  fitPreview(layout.pageW);
  fitNames(refs.preview);

  const pages = Math.ceil(printable.length / layout.perPage);
  const errors = state.people.filter((p) => p.level === 'error').length;
  const warnings = state.people.filter((p) => p.level === 'warn').length;
  refs.printBtn.disabled = printable.length === 0;
  refs.exportBtn.disabled = state.people.length === 0;

  if (!state.people.length) {
    setSummary(['Add some names to get started.'], '');
    return;
  }
  const parts = [el('strong', null, `${printable.length} card${printable.length === 1 ? '' : 's'}`),
    ` on ${pages} page${pages === 1 ? '' : 's'}`];
  if (errors) parts.push(el('span', 'badge error', `${errors} need${errors === 1 ? 's' : ''} fixing`));
  if (warnings) parts.push(el('span', 'badge warn', `${warnings} note${warnings === 1 ? '' : 's'}`));
  setSummary(parts, errors ? 'error' : '');
}

let renderTimer = 0;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 150);
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
function readFileAsText(file) {
  const reader = new FileReader();
  reader.onload = () => {
    refs.csvInput.value = String(reader.result || '');
    render();
  };
  reader.readAsText(file);
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  let v = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`; // stop spreadsheets running it as a formula
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
SETTING_IDS.forEach((id) => {
  refs[id].addEventListener(refs[id].type === 'checkbox' || refs[id].tagName === 'SELECT' ? 'change' : 'input', scheduleRender);
});

refs.csvFile.addEventListener('change', () => {
  const file = refs.csvFile.files?.[0];
  if (file) readFileAsText(file);
  refs.csvFile.value = ''; // allow re-selecting the same file after editing it
});

// Drag and drop onto the drop zone. Also stop the browser from navigating
// away (and losing the user's work) when a file is dropped anywhere else.
['dragover', 'drop'].forEach((type) => window.addEventListener(type, (e) => e.preventDefault()));
refs.dropzone.addEventListener('dragenter', () => refs.dropzone.classList.add('over'));
refs.dropzone.addEventListener('dragleave', () => refs.dropzone.classList.remove('over'));
refs.dropzone.addEventListener('drop', (e) => {
  refs.dropzone.classList.remove('over');
  const file = e.dataTransfer?.files?.[0];
  if (file) readFileAsText(file);
});

refs.logoUpload.addEventListener('change', () => {
  const file = refs.logoUpload.files?.[0];
  refs.logoUpload.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { state.logo = reader.result; render(); };
  reader.readAsDataURL(file);
});

refs.logoClear.addEventListener('click', () => { state.logo = null; render(); });

refs.formatsBtn.addEventListener('click', () => {
  const show = refs.formats.hidden;
  refs.formats.hidden = !show;
  refs.formatsBtn.textContent = show ? 'Hide formats' : 'Show formats';
  refs.formatsBtn.setAttribute('aria-expanded', String(show));
});

refs.printBtn.addEventListener('click', () => {
  clearTimeout(renderTimer);
  render();
  window.print();
});

refs.exportBtn.addEventListener('click', () => {
  const lines = ['full_name,user_id', ...state.people
    .filter((p) => p.name && p.userId)
    .map((p) => `${csvCell(p.name)},${csvCell(p.userId)}`)];
  download('id-cards.csv', `${lines.join('\r\n')}\r\n`, 'text/csv;charset=utf-8');
});

refs.sampleBtn.addEventListener('click', () => {
  download('id-cards-sample.csv', 'full_name,user_id\r\nJordan Lee,JLEE\r\nPriya Patel,\r\nMarcus Chen,MCHEN07\r\n', 'text/csv;charset=utf-8');
});

refs.resetBtn.addEventListener('click', () => {
  if (!window.confirm('Reset all settings and replace the name list with sample data?')) return;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  window.location.reload();
});

window.addEventListener('resize', () => fitPreview(layoutFor(getSettings()).pageW));
window.addEventListener('beforeprint', () => { refs.preview.style.zoom = '1'; });
window.addEventListener('afterprint', () => fitPreview(layoutFor(getSettings()).pageW));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
loadSettings();
render();
