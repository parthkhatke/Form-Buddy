// Form Buddy - content script (Phase 2: generic autofill engine)

const FIXED_KEYWORDS = {
  email: ['email', 'e-mail', 'mail'],
  firstName: ['first', 'fname', 'given', 'firstname'],
  lastName: ['last', 'lname', 'surname', 'lastname', 'family'],
  // no generic "number" keyword: it falsely claims passport/GST/card number fields
  phone: ['phone', 'mobile', 'tel', 'contact'],
  city: ['city', 'location', 'town'],
};

const SKIP_TYPES = ['file', 'hidden', 'password', 'submit', 'button', 'image', 'reset'];

// elements that already have a change listener attached for site memory recording
const recordingAttached = new WeakSet();

/* ---------- helpers ---------- */

function getHostKey() {
  return location.hostname || 'local-file';
}

function normalizeIdentifier(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
}

function getLabelText(el) {
  if (el.id) {
    try {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (label) return label.textContent.trim();
    } catch (e) { /* invalid id for selector, ignore */ }
  }
  const wrap = el.closest('label');
  if (wrap) return wrap.textContent.trim();
  return '';
}

function buildHaystack(el) {
  return [
    el.getAttribute('autocomplete') || '',
    el.name || '',
    el.id || '',
    el.getAttribute('placeholder') || '',
    getLabelText(el),
  ].join(' ').toLowerCase();
}

// Approach B identifier for a text/select field: first non-empty of
// name, id, placeholder, label text - normalised
function deriveIdentifier(el) {
  return normalizeIdentifier(el.name) ||
    normalizeIdentifier(el.id) ||
    normalizeIdentifier(el.getAttribute('placeholder')) ||
    normalizeIdentifier(getLabelText(el));
}

function isCreditCardField(el) {
  return ((el.getAttribute('autocomplete') || '').toLowerCase()).includes('cc-');
}

function shouldSkip(el) {
  if (el.disabled || el.readOnly) return true;
  if (isCreditCardField(el)) return true;
  const type = (el.type || '').toLowerCase();
  if (SKIP_TYPES.includes(type)) return true;
  return false;
}

// Custom fields are checked BEFORE the fixed keyword map: user-defined
// keywords are deliberate and must win over generic ones (the fixed
// "phone" keyword "number" would otherwise claim a "Passport Number" field).
function matchValue(haystack, profile, customFields, groups) {
  if (groups.custom) {
    for (const field of customFields) {
      if (!field.value) continue;
      for (const keyword of field.keywords) {
        if (keyword && haystack.includes(keyword)) return field.value;
      }
    }
  }
  if (groups.fixed) {
    for (const [profileKey, keywords] of Object.entries(FIXED_KEYWORDS)) {
      const value = profile[profileKey];
      if (!value) continue;
      for (const keyword of keywords) {
        if (haystack.includes(keyword)) return value;
      }
    }
  }
  return null;
}

/* ---------- filling primitives ---------- */

// React-safe: set value through the native setter, then fire synthetic events
function setNativeValue(el, value) {
  const proto = el instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function normalizeFuzzy(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// tiers: exact match > containment > all target words present ("30 days"
// matches "30 Days Notice"); best score wins
function fillSelect(el, value) {
  const target = normalizeFuzzy(value);
  if (target === '') return false;
  const targetTokens = target.split(' ');
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < el.options.length; i++) {
    const text = normalizeFuzzy(el.options[i].text);
    const optValue = normalizeFuzzy(el.options[i].value);
    let score = 0;
    if (text === target || optValue === target) score = 3;
    else if (text !== '' && (text.includes(target) || target.includes(text))) score = 2;
    else if (text !== '' && targetTokens.every((t) => text.includes(t))) score = 1;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  if (best === -1) return false;
  el.selectedIndex = best;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

/* ---------- shadow DOM + dynamic forms ---------- */

// collect form fields from the document AND any open shadow roots
function collectFields(root) {
  const out = [];
  const walk = (node) => {
    for (const el of node.querySelectorAll('input, textarea, select')) out.push(el);
    for (const el of node.querySelectorAll('*')) {
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(root);
  return out;
}

const tooltipShown = new WeakSet();

function showFileTooltip(el) {
  el.title = 'Upload file manually';
  if (tooltipShown.has(el)) return;
  tooltipShown.add(el);
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  const tip = document.createElement('div');
  tip.textContent = 'Upload file manually';
  tip.style.cssText = 'position:absolute;z-index:2147483647;background:#1c2624;color:#f2f6f5;' +
    'padding:4px 9px;border-radius:6px;font:12px/1.4 sans-serif;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.25);';
  tip.style.left = (rect.left + window.scrollX) + 'px';
  tip.style.top = (rect.bottom + window.scrollY + 4) + 'px';
  document.body.appendChild(tip);
  setTimeout(() => tip.remove(), 4000);
}

// SPA support: for 3 seconds after a fill, refill when new fields appear
let spaObserver = null;
let spaStopTimer = null;
let refillTimer = null;

function watchForLateFields(profile, customFields, groups) {
  if (spaObserver) spaObserver.disconnect();
  clearTimeout(spaStopTimer);
  clearTimeout(refillTimer);
  spaObserver = new MutationObserver((mutations) => {
    const hasNewField = mutations.some((m) => [...m.addedNodes].some((n) =>
      n.nodeType === 1 &&
      ((n.matches && n.matches('input, textarea, select')) ||
       (n.querySelector && n.querySelector('input, textarea, select')))));
    if (!hasNewField) return;
    clearTimeout(refillTimer);
    refillTimer = setTimeout(() => fillPage(profile, customFields, groups), 200);
  });
  spaObserver.observe(document.body, { childList: true, subtree: true });
  spaStopTimer = setTimeout(() => {
    spaObserver.disconnect();
    spaObserver = null;
  }, 3000);
}

/* ---------- radio groups and checkboxes ---------- */

// Identifier comes from the group's container (fieldset legend, wrapping
// label, nearest heading), not the individual input: Approach B.
function getGroupLabelText(el) {
  const fieldset = el.closest('fieldset');
  if (fieldset) {
    const legend = fieldset.querySelector('legend');
    if (legend && legend.textContent.trim()) return legend.textContent.trim();
  }
  let node = el.parentElement;
  for (let depth = 0; depth < 4 && node && node !== document.body; depth++) {
    const heading = node.querySelector('h1, h2, h3, h4, h5, h6');
    if (heading && heading.textContent.trim()) return heading.textContent.trim();
    node = node.parentElement;
  }
  return el.name || '';
}

function getOptionText(radio) {
  return getLabelText(radio) || radio.value || '';
}

// pick the option whose visible text best matches the wanted value
function findClosestOption(inputs, wanted) {
  const target = String(wanted).toLowerCase().trim();
  if (target === '') return null;
  let best = null;
  let bestScore = 0;
  for (const input of inputs) {
    const text = getOptionText(input).toLowerCase().trim();
    if (text === '') continue;
    let score = 0;
    if (text === target) score = 3;
    else if (text.includes(target) || target.includes(text)) score = 2;
    if (score > bestScore) { bestScore = score; best = input; }
  }
  return best;
}

function selectRadio(radio) {
  radio.click();
  radio.dispatchEvent(new Event('change', { bubbles: true }));
}

async function saveToSiteMemory(identifier, value) {
  if (!identifier) return;
  const data = await chrome.storage.local.get('siteMemory');
  const siteMemory = data.siteMemory || {};
  const host = getHostKey();
  if (!siteMemory[host]) siteMemory[host] = {};
  siteMemory[host][identifier] = value;
  await chrome.storage.local.set({ siteMemory });
}

// record user edits to text/textarea/select fields (change fires only
// when the value was actually modified and the field loses focus)
function attachFieldRecording(el, identifier) {
  if (!identifier || recordingAttached.has(el)) return;
  recordingAttached.add(el);
  el.addEventListener('change', () => {
    const value = el.tagName.toLowerCase() === 'select'
      ? (el.selectedOptions[0] ? el.selectedOptions[0].text.trim() : el.value)
      : el.value;
    saveToSiteMemory(identifier, value);
  });
}

function attachRadioRecording(radios, identifier) {
  for (const radio of radios) {
    if (recordingAttached.has(radio)) continue;
    recordingAttached.add(radio);
    radio.addEventListener('change', () => {
      if (radio.checked) saveToSiteMemory(identifier, getOptionText(radio));
    });
  }
}

function attachCheckboxRecording(checkbox, identifier) {
  if (recordingAttached.has(checkbox)) return;
  recordingAttached.add(checkbox);
  checkbox.addEventListener('change', () => {
    saveToSiteMemory(identifier, checkbox.checked ? 'yes' : 'no');
  });
}

function fillRadioGroups(radios, siteMem, customFields, groups) {
  let filled = 0;
  const byName = {};
  for (const radio of radios) {
    if (radio.disabled || isCreditCardField(radio)) continue;
    const key = radio.name || '__noname__' + Math.random();
    if (!byName[key]) byName[key] = [];
    byName[key].push(radio);
  }

  for (const group of Object.values(byName)) {
    const labelText = getGroupLabelText(group[0]);
    const identifier = normalizeIdentifier(labelText);
    const groupHaystack = (labelText + ' ' + (group[0].name || '')).toLowerCase();

    let wanted = null;
    if (identifier && siteMem[identifier] !== undefined) {
      wanted = siteMem[identifier];
    } else if (groups.custom) {
      for (const field of customFields) {
        if (!field.value) continue;
        if (field.keywords.some((k) => k && groupHaystack.includes(k))) {
          wanted = field.value;
          break;
        }
      }
    }

    if (wanted !== null) {
      const option = findClosestOption(group, wanted);
      if (option && !option.checked) {
        selectRadio(option);
        filled++;
      } else if (option && option.checked) {
        filled++;
      }
    }
    attachRadioRecording(group, identifier);
  }
  return filled;
}

function fillCheckbox(checkbox, siteMem, customFields, groups) {
  if (checkbox.disabled || isCreditCardField(checkbox)) return 0;
  const labelText = getLabelText(checkbox) || getGroupLabelText(checkbox);
  const identifier = normalizeIdentifier(labelText || checkbox.name || checkbox.id);
  const haystack = (labelText + ' ' + (checkbox.name || '') + ' ' + (checkbox.id || '')).toLowerCase();

  let filled = 0;
  let wanted = null;
  if (identifier && siteMem[identifier] !== undefined) {
    wanted = siteMem[identifier];
  } else if (groups.custom) {
    for (const field of customFields) {
      if (!field.value) continue;
      if (field.keywords.some((k) => k && haystack.includes(k))) {
        wanted = field.value;
        break;
      }
    }
  }

  if (wanted !== null) {
    const value = String(wanted).toLowerCase().trim();
    const shouldCheck = value === 'yes' || value === 'true' ||
      (value !== '' && labelText.toLowerCase().includes(value));
    if (shouldCheck && !checkbox.checked) {
      checkbox.click();
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      filled = 1;
    } else if (shouldCheck && checkbox.checked) {
      filled = 1;
    }
  }
  attachCheckboxRecording(checkbox, identifier);
  return filled;
}

/* ---------- main fill ---------- */

async function fillPage(profile, customFields, groups) {
  let filled = 0;
  const data = await chrome.storage.local.get('siteMemory');
  const siteMemory = data.siteMemory || {};
  const siteMem = siteMemory[getHostKey()] || {};

  const radios = [];
  const elements = collectFields(document);

  for (const el of elements) {
    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();

    if (tag === 'input' && type === 'radio') { radios.push(el); continue; }

    if (tag === 'input' && type === 'file' && !el.disabled) {
      showFileTooltip(el);
      continue;
    }

    if (tag === 'input' && type === 'checkbox') {
      if (el.readOnly) continue;
      filled += fillCheckbox(el, siteMem, customFields, groups);
      continue;
    }

    if (shouldSkip(el)) continue;

    // site memory first (remembered corrections beat heuristics),
    // then keyword matching; stale identifiers simply never match
    const identifier = deriveIdentifier(el);
    const remembered = identifier && siteMem[identifier] !== undefined ? siteMem[identifier] : null;
    const value = (remembered !== null && remembered !== '')
      ? remembered
      : matchValue(buildHaystack(el), profile, customFields, groups);

    if (value !== null) {
      if (tag === 'select') {
        if (fillSelect(el, value)) filled++;
      } else {
        setNativeValue(el, value);
        filled++;
      }
    }
    attachFieldRecording(el, identifier);
  }

  filled += fillRadioGroups(radios, siteMem, customFields, groups);
  return filled;
}

/* ---------- message wiring ---------- */

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.action === 'fill') {
      const profile = message.profile || {};
      const customFields = message.customFields || [];
      const groups = message.groups || { fixed: true, custom: true };
      fillPage(profile, customFields, groups)
        .then((count) => {
          sendResponse({ filled: count });
          watchForLateFields(profile, customFields, groups);
        })
        .catch(() => sendResponse({ filled: 0 }));
      return true; // async response
    }
  });
}
