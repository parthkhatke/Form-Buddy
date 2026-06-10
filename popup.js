// Form Buddy - popup script (Phase 1: profile form + storage)

const FIXED_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'city'];

let customFields = [];
let editingId = null;
let autoSaveTimer = null;
let bannerTimer = null;

const $ = (id) => document.getElementById(id);

/* ---------- status banner ---------- */

function showBanner(message, type) {
  const banner = $('banner');
  banner.textContent = message;
  banner.className = 'banner ' + type + ' show';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => banner.classList.remove('show'), 3000);
}

/* ---------- profile (fixed fields) ---------- */

function readProfileInputs() {
  const profile = {};
  for (const field of FIXED_FIELDS) {
    profile[field] = $(field).value.trim();
  }
  return profile;
}

async function saveProfile(showMessage) {
  const profile = readProfileInputs();
  await chrome.storage.local.set({ profile });
  updateBadge();
  if (showMessage) showBanner('Profile saved ✓', 'success');
}

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => saveProfile(false), 800);
}

function updateBadge() {
  const complete = $('firstName').value.trim() !== '' && $('email').value.trim() !== '';
  $('completeBadge').classList.toggle('show', complete);
}

/* ---------- custom fields ---------- */

async function saveCustomFields() {
  await chrome.storage.local.set({ customFields });
}

function renderCustomFields() {
  const list = $('customList');
  list.textContent = '';

  if (customFields.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No custom fields yet. Add one for anything you type often.';
    list.appendChild(empty);
    return;
  }

  for (const field of customFields) {
    const row = document.createElement('div');
    row.className = 'custom-row';

    const main = document.createElement('div');
    main.className = 'custom-row-main';

    const label = document.createElement('div');
    label.className = 'custom-row-label';
    label.textContent = field.label;

    const value = document.createElement('div');
    value.className = 'custom-row-value';
    value.textContent = field.value;

    const keywords = document.createElement('div');
    keywords.className = 'custom-row-keywords';
    keywords.textContent = field.keywords.join(', ');

    main.appendChild(label);
    main.appendChild(value);
    main.appendChild(keywords);

    const editBtn = document.createElement('button');
    editBtn.className = 'row-btn';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openFieldForm(field));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'row-btn danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteCustomField(field.id));

    row.appendChild(main);
    row.appendChild(editBtn);
    row.appendChild(deleteBtn);
    list.appendChild(row);
  }
}

function openFieldForm(field) {
  editingId = field ? field.id : null;
  $('fieldFormTitle').textContent = field ? 'Edit field' : 'Add field';
  $('fieldLabel').value = field ? field.label : '';
  $('fieldValue').value = field ? field.value : '';
  $('fieldKeywords').value = field ? field.keywords.join(', ') : '';
  $('fieldForm').classList.add('show');
  $('fieldLabel').focus();
}

function closeFieldForm() {
  editingId = null;
  $('fieldForm').classList.remove('show');
}

async function saveFieldForm() {
  const label = $('fieldLabel').value.trim();
  if (label === '') {
    showBanner('Label is required', 'error');
    return;
  }
  const value = $('fieldValue').value.trim();
  const keywords = $('fieldKeywords').value
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k !== '');

  if (editingId !== null) {
    const existing = customFields.find((f) => f.id === editingId);
    existing.label = label;
    existing.value = value;
    existing.keywords = keywords;
  } else {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
    customFields.push({ id, label, value, keywords });
  }

  await saveCustomFields();
  renderCustomFields();
  closeFieldForm();
  showBanner('Field saved ✓', 'success');
}

async function deleteCustomField(id) {
  customFields = customFields.filter((f) => f.id !== id);
  await saveCustomFields();
  renderCustomFields();
  showBanner('Field deleted', 'success');
}

/* ---------- autofill ---------- */

let autofillBusy = false;

async function updateStats(filledCount) {
  const data = await chrome.storage.local.get('stats');
  const today = new Date().toDateString();
  let stats = data.stats || { fieldsToday: 0, formsToday: 0, lastDate: '' };
  if (stats.lastDate !== today) {
    stats = { fieldsToday: 0, formsToday: 0, lastDate: today };
  }
  stats.fieldsToday += filledCount;
  if (filledCount > 0) stats.formsToday += 1;
  await chrome.storage.local.set({ stats });
}

async function runAutofill() {
  if (autofillBusy) return;
  autofillBusy = true;
  const btn = $('autofillBtn');
  btn.disabled = true;
  btn.textContent = 'Filling...';
  try {
    const groups = { fixed: $('groupFixed').checked, custom: $('groupCustom').checked };
    const data = await chrome.storage.local.get(['profile', 'customFields']);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'fill',
      profile: data.profile || {},
      customFields: data.customFields || [],
      groups,
    });
    const count = (response && response.filled) || 0;
    showBanner(count > 0 ? 'Filled ' + count + ' fields ✓' : 'Filled 0 fields', 'success');
    await updateStats(count);
    await renderStats();
    if (count > 0) {
      await addHistoryEntry(tab, count);
      await renderHistory();
    }
  } catch (e) {
    showBanner('Could not reach this page. Reload the tab and try again.', 'error');
  } finally {
    autofillBusy = false;
    btn.disabled = false;
    btn.textContent = 'Autofill Page';
  }
}

// reset stale counters in storage on popup open, then display
async function renderStats() {
  const data = await chrome.storage.local.get('stats');
  const today = new Date().toDateString();
  let stats = data.stats || { fieldsToday: 0, formsToday: 0, lastDate: '' };
  if (stats.lastDate !== today) {
    stats = { fieldsToday: 0, formsToday: 0, lastDate: today };
    await chrome.storage.local.set({ stats });
  }
  $('statFields').textContent = stats.fieldsToday;
  $('statForms').textContent = stats.formsToday;
}

/* ---------- history ---------- */

function hostKeyFromUrl(url) {
  try {
    return new URL(url).hostname || 'local-file';
  } catch (e) {
    return 'local-file';
  }
}

function timeAgo(time) {
  const diff = Date.now() - time;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}

async function addHistoryEntry(tab, count) {
  const data = await chrome.storage.local.get('history');
  const history = data.history || [];
  history.unshift({
    hostname: hostKeyFromUrl(tab.url),
    title: tab.title || '',
    url: tab.url || '',
    count,
    time: Date.now(),
  });
  await chrome.storage.local.set({ history: history.slice(0, 50) });
}

// clears the site's learned memory and its history rows
async function clearSite(hostname) {
  const data = await chrome.storage.local.get(['siteMemory', 'history']);
  const siteMemory = data.siteMemory || {};
  delete siteMemory[hostname];
  const history = (data.history || []).filter((h) => h.hostname !== hostname);
  await chrome.storage.local.set({ siteMemory, history });
  await renderHistory();
  showBanner('Cleared ' + hostname, 'success');
}

async function renderHistory() {
  const data = await chrome.storage.local.get('history');
  const history = data.history || [];
  const list = $('historyList');
  list.textContent = '';

  if (history.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'placeholder-panel';
    empty.textContent = 'No fills yet. Hit Autofill Page on any web form.';
    list.appendChild(empty);
    return;
  }

  for (const entry of history) {
    const row = document.createElement('div');
    row.className = 'history-row';

    const initials = document.createElement('div');
    initials.className = 'history-initials';
    initials.textContent = entry.hostname.replace(/^www\./, '').slice(0, 2);

    const main = document.createElement('div');
    main.className = 'history-main';
    const host = document.createElement('div');
    host.className = 'history-host';
    host.textContent = entry.hostname;
    const meta = document.createElement('div');
    meta.className = 'history-meta';
    meta.textContent = timeAgo(entry.time);
    main.appendChild(host);
    main.appendChild(meta);

    const count = document.createElement('span');
    count.className = 'history-count';
    count.textContent = entry.count + ' fields';

    const clearBtn = document.createElement('button');
    clearBtn.className = 'row-btn danger';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', () => clearSite(entry.hostname));

    row.appendChild(initials);
    row.appendChild(main);
    row.appendChild(count);
    row.appendChild(clearBtn);
    list.appendChild(row);
  }
}

/* ---------- export / import ---------- */

async function exportProfile() {
  const data = await chrome.storage.local.get(['profile', 'customFields']);
  const json = JSON.stringify({
    profile: data.profile || {},
    customFields: data.customFields || [],
  }, null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'formbuddy-profile.json';
  a.click();
  URL.revokeObjectURL(url);
  showBanner('Profile exported ✓', 'success');
}

// returns a clean { profile, customFields } or null when the file is not usable
function parseImportedProfile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return null;
  }
  if (!data || typeof data.profile !== 'object' || data.profile === null || !Array.isArray(data.customFields)) {
    return null;
  }
  const profile = {};
  for (const field of FIXED_FIELDS) {
    profile[field] = typeof data.profile[field] === 'string' ? data.profile[field] : '';
  }
  const fields = data.customFields
    .filter((f) => f && typeof f.label === 'string' && f.label !== '')
    .map((f) => ({
      id: typeof f.id === 'string' && f.id !== ''
        ? f.id
        : Date.now().toString(36) + Math.random().toString(36).slice(2, 4),
      label: f.label,
      value: typeof f.value === 'string' ? f.value : '',
      keywords: Array.isArray(f.keywords)
        ? f.keywords.filter((k) => typeof k === 'string').map((k) => k.trim().toLowerCase()).filter((k) => k !== '')
        : [],
    }));
  return { profile, customFields: fields };
}

async function importProfileText(text) {
  const parsed = parseImportedProfile(text);
  if (parsed === null) {
    showBanner('Invalid file', 'error');
    return false;
  }
  await chrome.storage.local.set(parsed);
  await init();
  showBanner('Profile imported ✓', 'success');
  return true;
}

/* ---------- tabs ---------- */

function activateTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === name);
  });
  document.querySelectorAll('.panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === 'panel-' + name);
  });
}

/* ---------- init ---------- */

async function init() {
  const data = await chrome.storage.local.get(['profile', 'customFields']);
  const profile = data.profile || {};
  customFields = data.customFields || [];

  for (const field of FIXED_FIELDS) {
    $(field).value = profile[field] || '';
  }
  renderCustomFields();
  updateBadge();
  await renderStats();
  await renderHistory();
}

function wireEvents() {
  for (const field of FIXED_FIELDS) {
    $(field).addEventListener('input', () => {
      scheduleAutoSave();
      updateBadge();
    });
  }
  $('saveBtn').addEventListener('click', () => saveProfile(true));
  $('addFieldBtn').addEventListener('click', () => openFieldForm(null));
  $('fieldSaveBtn').addEventListener('click', saveFieldForm);
  $('autofillBtn').addEventListener('click', runAutofill);
  $('exportBtn').addEventListener('click', exportProfile);
  $('importBtn').addEventListener('click', () => $('importInput').click());
  $('importInput').addEventListener('change', async () => {
    const file = $('importInput').files[0];
    if (!file) return;
    await importProfileText(await file.text());
    $('importInput').value = '';
  });
  $('fieldCancelBtn').addEventListener('click', closeFieldForm);
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  });
}

document.addEventListener('DOMContentLoaded', () => {
  wireEvents();
  init();
});
