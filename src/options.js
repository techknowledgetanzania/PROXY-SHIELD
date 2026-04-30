// ProxyShield Options v1.1.0

let _s = null;
let _editing = null;
const ICONS = { http:'🌐', https:'🔒', socks4:'🔷', socks5:'🔵' };

document.addEventListener('DOMContentLoaded', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  if (res.success) { _s = res.settings; renderProfiles(); prefillForm(); }
  bindAll();
});

// ── Profiles ──────────────────────────────────────────────────────────────────

function renderProfiles() {
  const list = document.getElementById('plist');
  const ps = _s.profiles || [];
  if (!ps.length) {
    list.innerHTML = '<div style="text-align:center;color:var(--dim);font-size:12px;padding:20px 0">No saved profiles</div>';
    return;
  }
  list.innerHTML = ps.map(p => `
    <div role="listitem" style="display:flex;gap:6px;align-items:center;">
      <button class="pitem${_editing === p.id ? ' active' : ''}" data-id="${p.id}" aria-label="Edit ${esc(p.name)}">
        <div class="pico2">${ICONS[p.proxy.type]||'🌐'}</div>
        <div class="pinfo">
          <div class="pname">${esc(p.name||'Unnamed')}</div>
          <div class="pmeta">${p.proxy.type.toUpperCase()} · ${esc(p.proxy.host)}:${esc(p.proxy.port)}</div>
        </div>
      </button>
      <button class="pdel" data-del="${p.id}" aria-label="Delete ${esc(p.name)}">✕</button>
    </div>`).join('');

  list.querySelectorAll('.pitem').forEach(b => b.addEventListener('click', () => loadProfile(b.dataset.id)));
  list.querySelectorAll('.pdel').forEach(b => b.addEventListener('click', () => deleteProfile(b.dataset.del)));
}

function loadProfile(id) {
  const p = (_s.profiles||[]).find(p => p.id === id);
  if (!p) return;
  _editing = id;
  document.getElementById('ftitle').textContent = 'Edit Profile';
  document.getElementById('f-name').value = p.name || '';
  document.getElementById('f-host').value = p.proxy.host || '';
  document.getElementById('f-port').value = p.proxy.port || '';
  document.getElementById('f-type').value = p.proxy.type || 'http';
  document.getElementById('f-user').value = p.proxy.username || '';
  document.getElementById('f-pass').value = p.proxy.password || '';
  const lp = p.leakPrevention || {};
  document.querySelectorAll('.orow').forEach(r => {
    const on = lp[r.dataset.opt] !== false;
    r.setAttribute('aria-pressed', String(on));
    r.querySelector('.ocb').textContent = on ? '✓' : '';
  });
  renderProfiles();
}

function prefillForm() {
  if (!_s.proxy.host) return;
  document.getElementById('f-host').value = _s.proxy.host;
  document.getElementById('f-port').value = _s.proxy.port;
  document.getElementById('f-type').value = _s.proxy.type || 'http';
  document.getElementById('f-user').value = _s.proxy.username || '';
}

async function deleteProfile(id) {
  _s.profiles = (_s.profiles||[]).filter(p => p.id !== id);
  if (_editing === id) { _editing = null; clearForm(); }
  await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: _s });
  renderProfiles();
  showToast('Profile deleted');
}

// ── Form ──────────────────────────────────────────────────────────────────────

function bindAll() {
  document.querySelectorAll('.orow').forEach(r => {
    r.addEventListener('click', () => {
      const on = r.getAttribute('aria-pressed') !== 'true';
      r.setAttribute('aria-pressed', String(on));
      r.querySelector('.ocb').textContent = on ? '✓' : '';
    });
  });
  document.getElementById('btn-new').addEventListener('click', () => {
    _editing = null; clearForm();
    document.getElementById('ftitle').textContent = 'New Profile';
    renderProfiles();
  });
  document.getElementById('btn-save').addEventListener('click', saveProfile);
  document.getElementById('btn-apply').addEventListener('click', applyNow);
  document.getElementById('btn-clear').addEventListener('click', clearForm);
}

function formData() {
  const lp = {};
  document.querySelectorAll('.orow').forEach(r => {
    lp[r.dataset.opt] = r.getAttribute('aria-pressed') === 'true';
  });
  return {
    name: document.getElementById('f-name').value.trim() || 'Unnamed',
    proxy: {
      type:     document.getElementById('f-type').value,
      host:     document.getElementById('f-host').value.trim(),
      port:     document.getElementById('f-port').value.trim(),
      username: document.getElementById('f-user').value,
      password: document.getElementById('f-pass').value
    },
    leakPrevention: lp
  };
}

async function saveProfile() {
  const d = formData();
  if (!d.proxy.host) { showToast('Host is required', 'err'); return; }
  if (!d.proxy.port) { showToast('Port is required', 'err'); return; }
  if (!_s.profiles) _s.profiles = [];
  if (_editing) {
    const i = _s.profiles.findIndex(p => p.id === _editing);
    if (i !== -1) _s.profiles[i] = { ..._s.profiles[i], ...d };
  } else {
    _s.profiles.push({ id: Date.now().toString(), ...d });
  }
  await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: _s });
  renderProfiles();
  showToast('✓ Profile saved', 'ok');
}

async function applyNow() {
  const d = formData();
  if (!d.proxy.host) { showToast('Host is required', 'err'); return; }
  if (!d.proxy.port) { showToast('Port is required', 'err'); return; }
  _s.proxy = d.proxy;
  _s.leakPrevention = d.leakPrevention;
  const res = await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: _s });
  showToast(res.success
    ? (_s.enabled ? '✓ Proxy updated' : '✓ Saved — enable in popup')
    : (res.error || 'Failed'), res.success ? 'ok' : 'err');
}

function clearForm() {
  _editing = null;
  ['f-name','f-host','f-port','f-user','f-pass'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-type').value = 'http';
  document.querySelectorAll('.orow').forEach(r => {
    r.setAttribute('aria-pressed', 'true');
    r.querySelector('.ocb').textContent = '✓';
  });
  document.getElementById('ftitle').textContent = 'Configure Proxy';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

let _tt;
function showToast(msg, cls = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${cls}`;
  clearTimeout(_tt);
  _tt = setTimeout(() => t.classList.remove('show'), 2800);
}
