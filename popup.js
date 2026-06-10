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
  $('fieldCancelBtn').addEventListener('click', closeFieldForm);
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  });
}

document.addEventListener('DOMContentLoaded', () => {
  wireEvents();
  init();
});
