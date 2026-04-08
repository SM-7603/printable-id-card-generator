// -----------------------------
// App state
// -----------------------------
// Stores values that change while the app is running but do not live directly
// inside the HTML inputs. Right now this is mainly the current logo image and
// the selected page size.
const state = {
  logoDataUrl: 'assets/geodis-logo.png',
  pageSize: 'letter'
};

// -----------------------------
// DOM references
// -----------------------------
// Cache the elements we use often so we do not keep querying the DOM.
const refs = {
  companyName: document.getElementById('companyName'),
  companySubtitle: document.getElementById('companySubtitle'),
  logoUpload: document.getElementById('logoUpload'),
  pageSize: document.getElementById('pageSize'),
  pagePadding: document.getElementById('pagePadding'),
  gridGap: document.getElementById('gridGap'),
  accentColor: document.getElementById('accentColor'),
  csvFile: document.getElementById('csvFile'),
  csvInput: document.getElementById('csvInput'),
  renderBtn: document.getElementById('renderBtn'),
  printBtn: document.getElementById('printBtn'),
  downloadCsvBtn: document.getElementById('downloadCsvBtn'),
  preview: document.getElementById('preview'),
  status: document.getElementById('status')
};

// Small helper for showing feedback beneath the buttons.
function setStatus(message) {
  refs.status.textContent = message;
}

// -----------------------------
// User ID helpers
// -----------------------------
// Removes accents, strips special characters, keeps letters and digits, then
// uppercases the final value so barcode output stays clean and consistent.
function sanitizeForId(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
}

// Default ID rule:
// "Anne Jotheeswaran" -> "AJOTHEESWARAN" (trimmed to 12 chars)
// "test test2" -> "TTEST2"
function buildUserId(fullName) {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return '';
  if (parts.length === 1) return sanitizeForId(parts[0]).slice(0, 12);

  const firstInitial = sanitizeForId(parts[0]).slice(0, 1);
  const lastName = sanitizeForId(parts[parts.length - 1]);
  return (firstInitial + lastName).slice(0, 12);
}

// -----------------------------
// CSV parsing
// -----------------------------
// Splits one CSV line while respecting quoted commas.
// Example: "John, Jr.",ABC123 should become two columns, not three.
function parseCsvLine(line) {
  const out = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  out.push(current.trim());
  return out.map((value) => value.replace(/^"|"$/g, '').trim());
}

// Converts a header row into an object for easy lookups.
// Example: ['user_id', 'full_name'] => { user_id: 0, full_name: 1 }
function getHeaderIndexMap(headerRow) {
  const map = {};
  headerRow.forEach((header, index) => {
    map[header.toLowerCase()] = index;
  });
  return map;
}

// Reads the textarea / uploaded CSV and turns it into a list of people.
// Supported formats:
// - full_name
// - first_name,last_name
// - full_name,user_id
// - user_id,full_name
function parsePeople(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);


  if (!lines.length) return [];

  const firstRow = parseCsvLine(lines[0]);
  const normalizedFirstRow = firstRow.map((value) => value.toLowerCase());
  const hasHeader = normalizedFirstRow.some((value) => [
    'full_name',
    'first_name',
    'last_name',
    'user_id'
  ].includes(value));

  const headerIndex = hasHeader ? getHeaderIndexMap(normalizedFirstRow) : null;
  const startIndex = hasHeader ? 1 : 0;
  const people = [];

  for (let i = startIndex; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    if (!cols.length) continue;

    let fullName = '';
    let userId = '';

    if (headerIndex) {
      // Header-driven parsing is the safest path because column order can vary.
      const firstName = cols[headerIndex.first_name] || '';
      const lastName = cols[headerIndex.last_name] || '';
      const fullNameField = cols[headerIndex.full_name] || '';
      const userIdField = cols[headerIndex.user_id] || '';

      fullName = fullNameField || [firstName, lastName].filter(Boolean).join(' ').trim();
      userId = sanitizeForId(userIdField) || buildUserId(fullName);
    } else if (cols.length === 1) {
      // Single-column input means each line is just a full name.
      fullName = cols[0];
      userId = buildUserId(fullName);
    } else if (cols.length >= 2) {
      // No header: make a reasonable guess.
      // If the first column contains spaces, it likely already is a full name.
      const looksLikeName = /\s/.test(cols[0]);
      if (looksLikeName) {
        fullName = cols[0];
        userId = sanitizeForId(cols[1]) || buildUserId(fullName);
      } else {
        fullName = [cols[0], cols[1]].join(' ').trim();
        userId = cols[2] ? sanitizeForId(cols[2]) : buildUserId(fullName);
      }
    }

    fullName = fullName.trim();
    if (!fullName) continue;

    people.push({
      name: fullName,
      userId: userId || buildUserId(fullName)
    });
  }

  return dedupeUserIds(people);
}

// If two people end up with the same generated ID, add a numeric suffix.
// Example: RKAUR, RKAUR2, RKAUR3...
function dedupeUserIds(people) {
  const seen = new Map();

  return people.map((person) => {
    const base = person.userId || buildUserId(person.name) || 'USER';
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);

    return {
      ...person,
      userId: count === 1 ? base : `${base}${count}`
    };
  });
}

// -----------------------------
// Layout + rendering helpers
// -----------------------------
// Pushes control values into CSS custom properties so the preview updates live.
function applyLayoutSettings() {
  const root = document.documentElement;
  const pageSize = refs.pageSize.value;
  state.pageSize = pageSize;

  if (pageSize === 'a4') {
    root.style.setProperty('--page-width', '210mm');
    root.style.setProperty('--page-height', '297mm');
  } else {
    root.style.setProperty('--page-width', '216mm');
    root.style.setProperty('--page-height', '279mm');
  }

  root.style.setProperty('--page-padding', `${Number(refs.pagePadding.value) || 10}mm`);
  root.style.setProperty('--grid-gap', `${Number(refs.gridGap.value) || 4}mm`);
  root.style.setProperty('--accent', refs.accentColor.value || '#2d11ea');
}

// Splits a long array into smaller chunks.
// Used to create one printable page per 10 cards.
function chunk(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

// Escapes text before inserting it into HTML.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Creates one card element and renders its barcode.
function createCard(person) {
  const card = document.createElement('section');
  card.className = 'card';

  const logoHtml = state.logoDataUrl
    ? `<img src="${state.logoDataUrl}" alt="Company logo" />`
    : `<div class="logo-fallback">${escapeHtml(refs.companyName.value || 'LOGO')}</div>`;

  card.innerHTML = `
    <div class="card-header">
      <div class="logo-box">${logoHtml}</div>
      <div class="header-copy">
        <div class="company-name">${escapeHtml(refs.companyName.value)}</div>
        <div class="company-subtitle">${escapeHtml(refs.companySubtitle.value)}</div>
      </div>
    </div>
    <div class="employee-name">${escapeHtml(person.name)}</div>
    <div class="barcode-wrap">
      <svg class="barcode"></svg>
    </div>
    <div class="user-id">${escapeHtml(person.userId)}</div>
  `;

  const svg = card.querySelector('.barcode');
  JsBarcode(svg, person.userId, {
    format: 'CODE128',
    width: 1.45,
    height: 42,
    displayValue: false,
    margin: 0,
    background: '#ffffff',
    lineColor: '#000000'
  });

  return card;
}

// Main render flow:
// 1) read inputs
// 2) parse people
// 3) create pages
// 4) create cards
// 5) update status text
function renderCards() {
  applyLayoutSettings();

  const people = parsePeople(refs.csvInput.value);
  refs.preview.innerHTML = '';

  if (!people.length) {
    setStatus('No valid people found. Paste a CSV or upload one first.');
    return;
  }

  const cardsPerPage = 10;
  const pages = chunk(people, cardsPerPage);

  pages.forEach((group) => {
    const page = document.createElement('div');
    page.className = 'page';
    group.forEach((person) => page.appendChild(createCard(person)));
    refs.preview.appendChild(page);
  });

  setStatus(`Rendered ${people.length} card${people.length === 1 ? '' : 's'} across ${pages.length} page${pages.length === 1 ? '' : 's'}.`);
}

// -----------------------------
// Event listeners
// -----------------------------
// When a new logo is uploaded, convert it to a data URL so it can be displayed
// immediately in the preview without needing a server.
refs.logoUpload.addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    state.logoDataUrl = reader.result;
    renderCards();
  };
  reader.readAsDataURL(file);
});

// Load an uploaded CSV into the textarea, then re-render.
refs.csvFile.addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    refs.csvInput.value = String(reader.result || '');
    renderCards();
  };
  reader.readAsText(file);
});

refs.renderBtn.addEventListener('click', renderCards);
refs.printBtn.addEventListener('click', () => window.print());

// Generates a tiny starter CSV so the user can see the expected format.
refs.downloadCsvBtn.addEventListener('click', () => {
  const csv = [
    'full_name,user_id',
    'Anne Jotheeswaran,AJOTHEESWARA',
    'Humza Kayani,HKAYANI',
    'Rajpreet Kaur,RKAUR19'
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'employee-cards-sample.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

// Any change to these inputs should immediately refresh the preview.
[
  refs.companyName,
  refs.companySubtitle,
  refs.pageSize,
  refs.pagePadding,
  refs.gridGap,
  refs.accentColor
].forEach((element) => {
  element.addEventListener('input', renderCards);
});

// Initial render on page load so the sample data is visible immediately.
renderCards();
