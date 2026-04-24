// ProxyShield - Options Script

let settings = null;
let editingProfileId = null;

const ICONS = { http: '🌐', https: '🔒', socks4: '🔷', socks5: '🔵' };

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  bindEvents();
});

async function loadSettings() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  if (res.success) {
    settings = res.settings;
    renderProfiles();
    populateFormFromSettings();
  }
}

// ─── Profiles ─────────────────────────────────────────────────────────────────

function renderProfiles() {
  const list = document.getElementById('profile-list');
  const profiles = settings.profiles || [];

  if (profiles.length === 0) {
    list.innerHTML = `<div style="text-align:center;color:var(--text-dim);font-size:12px;padding:20px 0;">No saved profiles yet</div>`;
    return;
  }

  list.innerHTML = profiles.map(p => `
    <div class="profile-item ${editingProfileId === p.id ? 'active' : ''}" data-id="${p.id}">
      <div class="profile-icon">${ICONS[p.proxy.type] || '🌐'}</div>
      <div class="profile-info">
        <div class="profile-name">${escHtml(p.name || 'Unnamed')}</div>
        <div class="profile-meta">${p.proxy.type.toUpperCase()} · ${escHtml(p.proxy.host)}:${escHtml(p.proxy.port)}</div>
      </div>
      <div class="profile-del" data-del="${p.id}" title="Delete">✕</div>
    </div>
  `).join('');

  // Click to edit
  list.querySelectorAll('.profile-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('profile-del')) return;
      loadProfileIntoForm(item.dataset.id);
    });
  });

  // Delete
  list.querySelectorAll('.profile-del').forEach(btn => {
    btn.addEventListener('click', () => deleteProfile(btn.dataset.del));
  });
}

function loadProfileIntoForm(id) {
  const profile = (settings.profiles || []).find(p => p.id === id);
  if (!profile) return;

  editingProfileId = id;
  document.getElementById('form-title').textContent = 'Edit Profile';
  document.getElementById('f-name').value = profile.name || '';
  document.getElementById('f-host').value = profile.proxy.host || '';
  document.getElementById('f-port').value = profile.proxy.port || '';
  document.getElementById('f-type').value = profile.proxy.type || 'http';
  document.getElementById('f-user').value = profile.proxy.username || '';
  document.getElementById('f-pass').value = profile.proxy.password || '';

  const lp = profile.leakPrevention || {};
  document.querySelectorAll('.opt-row').forEach(row => {
    const key = row.dataset.opt;
    const checked = lp[key] !== false;
    row.classList.toggle('checked', checked);
    row.querySelector('.opt-cb').textContent = checked ? '✓' : '';
  });

  renderProfiles();
}

function populateFormFromSettings() {
  // Pre-fill from current active settings
  if (settings.proxy.host) {
    document.getElementById('f-host').value = settings.proxy.host;
    document.getElementById('f-port').value = settings.proxy.port;
    document.getElementById('f-type').value = settings.proxy.type || 'http';
    document.getElementById('f-user').value = settings.proxy.username || '';
  }
}

async function deleteProfile(id) {
  settings.profiles = (settings.profiles || []).filter(p => p.id !== id);
  if (editingProfileId === id) {
    editingProfileId = null;
    clearForm();
  }
  await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });
  renderProfiles();
  showToast('Profile deleted');
}

// ─── Form ─────────────────────────────────────────────────────────────────────

function bindEvents() {
  // Opt-row toggles
  document.querySelectorAll('.opt-row').forEach(row => {
    row.addEventListener('click', () => {
      row.classList.toggle('checked');
      row.querySelector('.opt-cb').textContent = row.classList.contains('checked') ? '✓' : '';
    });
  });

  document.getElementById('btn-new-profile').addEventListener('click', () => {
    editingProfileId = null;
    clearForm();
    document.getElementById('form-title').textContent = 'New Profile';
    renderProfiles();
  });

  document.getElementById('btn-save-profile').addEventListener('click', saveProfile);
  document.getElementById('btn-apply-now').addEventListener('click', applyNow);
  document.getElementById('btn-clear-form').addEventListener('click', clearForm);
}

function getFormData() {
  const leakPrevention = {};
  document.querySelectorAll('.opt-row').forEach(row => {
    leakPrevention[row.dataset.opt] = row.classList.contains('checked');
  });

  return {
    name: document.getElementById('f-name').value.trim() || 'Unnamed',
    proxy: {
      type: document.getElementById('f-type').value,
      host: document.getElementById('f-host').value.trim(),
      port: document.getElementById('f-port').value.trim(),
      username: document.getElementById('f-user').value,
      password: document.getElementById('f-pass').value
    },
    leakPrevention
  };
}

async function saveProfile() {
  const data = getFormData();

  if (!data.proxy.host) { showToast('Host is required', 'error'); return; }
  if (!data.proxy.port) { showToast('Port is required', 'error'); return; }

  if (!settings.profiles) settings.profiles = [];

  if (editingProfileId) {
    const idx = settings.profiles.findIndex(p => p.id === editingProfileId);
    if (idx !== -1) {
      settings.profiles[idx] = { ...settings.profiles[idx], ...data };
    }
  } else {
    settings.profiles.push({ id: Date.now().toString(), ...data });
  }

  await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });
  renderProfiles();
  showToast('✓ Profile saved', 'success');
}

async function applyNow() {
  const data = getFormData();

  if (!data.proxy.host) { showToast('Host is required', 'error'); return; }
  if (!data.proxy.port) { showToast('Port is required', 'error'); return; }

  settings.proxy = data.proxy;
  settings.leakPrevention = data.leakPrevention;

  const res = await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });

  if (res.success) {
    if (settings.enabled) {
      showToast('✓ Proxy updated and applied', 'success');
    } else {
      showToast('✓ Saved — enable proxy in popup to activate', 'success');
    }
  } else {
    showToast('Failed to apply', 'error');
  }
}

function clearForm() {
  editingProfileId = null;
  ['f-name','f-host','f-port','f-user','f-pass'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('f-type').value = 'http';
  document.querySelectorAll('.opt-row').forEach(row => {
    row.classList.add('checked');
    row.querySelector('.opt-cb').textContent = '✓';
  });
  document.getElementById('form-title').textContent = 'Configure Proxy';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

let toastTimer = null;

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}
