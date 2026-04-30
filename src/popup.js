// ProxyShield Popup v1.1.0

let _settings = null;
let _type = 'http';

document.addEventListener('DOMContentLoaded', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  if (res.success) { _settings = res.settings; render(_settings); }
  else showToast('Failed to load settings', 'err');
  bindAll();
});

// ── Render ────────────────────────────────────────────────────────────────────

function render(s) {
  // Toggle
  const chk = document.getElementById('master');
  chk.checked = s.enabled;
  chk.setAttribute('aria-checked', String(s.enabled));
  setToggleLabel(s.enabled);
  setStatus(s);

  // Proxy fields
  _type = s.proxy.type || 'http';
  document.getElementById('host').value = s.proxy.host     || '';
  document.getElementById('port').value = s.proxy.port     || '';
  document.getElementById('user').value = s.proxy.username || '';
  document.getElementById('pass').value = s.proxy.password || '';

  // Protocol buttons
  document.querySelectorAll('.pt').forEach(b => {
    const active = b.dataset.type === _type;
    b.classList.toggle('on', active);
    b.setAttribute('aria-pressed', String(active));
  });

  // Leak prevention toggles
  const lp = s.leakPrevention;
  document.querySelectorAll('.li').forEach(btn => {
    const on = lp[btn.dataset.key] !== false;
    btn.setAttribute('aria-pressed', String(on));
    btn.querySelector('.lck').textContent = on ? '✓' : '';
  });
}

// ── Bind events ───────────────────────────────────────────────────────────────

function bindAll() {
  // Master toggle
  document.getElementById('master').addEventListener('change', async e => {
    const on = e.target.checked;
    setToggleLabel(on);
    const res = await chrome.runtime.sendMessage({ type: 'TOGGLE_PROXY', enabled: on });
    if (res.success) {
      _settings.enabled = on;
      setStatus(_settings);
      showToast(on ? '🛡 Proxy active' : 'Proxy disabled', on ? 'ok' : '');
    } else {
      e.target.checked = !on;
      e.target.setAttribute('aria-checked', String(!on));
      setToggleLabel(!on);
      showToast(res.error || 'Toggle failed', 'err');
    }
  });

  // Protocol buttons
  document.querySelectorAll('.pt').forEach(btn => {
    btn.addEventListener('click', () => {
      _type = btn.dataset.type;
      document.querySelectorAll('.pt').forEach(b => {
        b.classList.toggle('on', b === btn);
        b.setAttribute('aria-pressed', String(b === btn));
      });
    });
  });

  // Leak prevention buttons — real <button> elements, keyboard-accessible
  document.querySelectorAll('.li').forEach(btn => {
    btn.addEventListener('click', () => {
      const on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(on));
      btn.querySelector('.lck').textContent = on ? '✓' : '';
    });
  });

  document.getElementById('btn-save').addEventListener('click', saveAndApply);
  document.getElementById('btn-validate').addEventListener('click', validateConfig);
  document.getElementById('opts').addEventListener('click', e => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

// ── Save ──────────────────────────────────────────────────────────────────────

async function saveAndApply() {
  const host = document.getElementById('host').value.trim();
  const port = document.getElementById('port').value.trim();
  if (!host) { showToast('Host is required', 'err'); return; }
  if (!port) { showToast('Port is required', 'err'); return; }

  const lp = {};
  document.querySelectorAll('.li').forEach(btn => {
    lp[btn.dataset.key] = btn.getAttribute('aria-pressed') === 'true';
  });

  const next = {
    ..._settings,
    proxy: {
      type: _type, host, port,
      username: document.getElementById('user').value,
      password: document.getElementById('pass').value
    },
    leakPrevention: lp
  };

  const btn = document.getElementById('btn-save');
  btn.disabled = true; btn.textContent = 'Saving…';
  const res = await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: next });
  btn.disabled = false; btn.textContent = 'Save & Apply';

  if (res.success) { _settings = next; setStatus(_settings); showToast('✓ Saved', 'ok'); }
  else showToast(res.error || 'Save failed', 'err');
}

// ── FIX 4: Validate — inline result box, honest label ─────────────────────────

async function validateConfig() {
  const proxy = {
    type: _type,
    host: document.getElementById('host').value.trim(),
    port: document.getElementById('port').value.trim()
  };

  const btn = document.getElementById('btn-validate');
  btn.disabled = true; btn.textContent = 'Checking…';
  const res = await chrome.runtime.sendMessage({ type: 'VALIDATE_CONFIG', proxy });
  btn.disabled = false; btn.textContent = 'Validate Config';

  const box = document.getElementById('val-box');
  if (res.success) {
    box.className = 'val-box ok';
    box.textContent = `✓ Format valid — save & enable, then visit ipleak.net to confirm connectivity.`;
  } else {
    box.className = 'val-box err';
    box.textContent = `✗ ${res.error}`;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setToggleLabel(on) {
  const el = document.getElementById('tl');
  el.textContent = on ? 'ON' : 'OFF';
  el.style.color = on ? 'var(--accent)' : 'var(--muted)';
}

function setStatus(s) {
  const bar = document.getElementById('status');
  const txt = document.getElementById('stxt');
  bar.className = 'status';
  if (!s.proxy.host) { txt.textContent = 'No proxy configured'; return; }
  if (s.enabled) {
    bar.classList.add('on');
    txt.textContent = `${s.proxy.type.toUpperCase()} → ${s.proxy.host}:${s.proxy.port}`;
  } else {
    txt.textContent = `${s.proxy.type.toUpperCase()} ${s.proxy.host}:${s.proxy.port} (inactive)`;
  }
}

let _tt;
function showToast(msg, cls = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${cls}`;
  clearTimeout(_tt);
  _tt = setTimeout(() => t.classList.remove('show'), 2800);
}
