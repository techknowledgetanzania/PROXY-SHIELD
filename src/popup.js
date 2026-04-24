// ProxyShield - Popup Script

let settings = null;
let selectedType = 'http';

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  bindEvents();
});

async function loadSettings() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    if (res.success) {
      settings = res.settings;
      populateUI(settings);
    }
  } catch (e) {
    showToast('Failed to load settings', 'error');
  }
}

function populateUI(s) {
  // Toggle state
  const toggle = document.getElementById('master-toggle');
  toggle.checked = s.enabled;
  updateToggleLabel(s.enabled);
  updateStatusBar(s);

  // Proxy fields
  selectedType = s.proxy.type || 'http';
  document.getElementById('proxy-host').value = s.proxy.host || '';
  document.getElementById('proxy-port').value = s.proxy.port || '';
  document.getElementById('proxy-user').value = s.proxy.username || '';
  document.getElementById('proxy-pass').value = s.proxy.password || '';

  // Type buttons
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === selectedType);
  });

  // Leak prevention
  const lp = s.leakPrevention;
  document.querySelectorAll('.leak-item').forEach(item => {
    const key = item.dataset.key;
    const enabled = lp[key] !== false;
    item.classList.toggle('enabled', enabled);
    item.querySelector('.leak-check').textContent = enabled ? '✓' : '';
  });
}

// ─── Events ───────────────────────────────────────────────────────────────────

function bindEvents() {
  // Master toggle
  document.getElementById('master-toggle').addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    updateToggleLabel(enabled);

    const res = await chrome.runtime.sendMessage({ type: 'TOGGLE_PROXY', enabled });

    if (res.success) {
      settings.enabled = enabled;
      updateStatusBar(settings);
      showToast(enabled ? '🛡 Proxy activated' : 'Proxy disabled', enabled ? 'success' : '');
    } else {
      e.target.checked = !enabled;
      updateToggleLabel(!enabled);
      showToast(res.error || 'Failed to toggle proxy', 'error');
    }
  });

  // Type buttons
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedType = btn.dataset.type;
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Leak prevention toggles
  document.querySelectorAll('.leak-item').forEach(item => {
    item.addEventListener('click', () => {
      item.classList.toggle('enabled');
      const enabled = item.classList.contains('enabled');
      item.querySelector('.leak-check').textContent = enabled ? '✓' : '';
    });
  });

  // Save button
  document.getElementById('btn-save').addEventListener('click', saveAndApply);

  // Test button
  document.getElementById('btn-test').addEventListener('click', testConfig);

  // Options link
  document.getElementById('options-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

// ─── Save ─────────────────────────────────────────────────────────────────────

async function saveAndApply() {
  const host = document.getElementById('proxy-host').value.trim();
  const port = document.getElementById('proxy-port').value.trim();

  if (!host) { showToast('Host is required', 'error'); return; }
  if (!port)  { showToast('Port is required', 'error'); return; }

  // Collect leak prevention state
  const leakPrevention = {};
  document.querySelectorAll('.leak-item').forEach(item => {
    leakPrevention[item.dataset.key] = item.classList.contains('enabled');
  });

  const newSettings = {
    ...settings,
    proxy: {
      type: selectedType,
      host,
      port,
      username: document.getElementById('proxy-user').value,
      password: document.getElementById('proxy-pass').value
    },
    leakPrevention
  };

  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const res = await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: newSettings });

  btn.disabled = false;
  btn.textContent = 'Save & Apply';

  if (res.success) {
    settings = newSettings;
    updateStatusBar(settings);
    showToast('✓ Settings saved', 'success');
  } else {
    showToast(res.error || 'Save failed', 'error');
  }
}

// ─── Test ─────────────────────────────────────────────────────────────────────

async function testConfig() {
  const proxy = {
    type: selectedType,
    host: document.getElementById('proxy-host').value.trim(),
    port: document.getElementById('proxy-port').value.trim()
  };

  const btn = document.getElementById('btn-test');
  btn.disabled = true;
  btn.textContent = 'Testing…';

  const res = await chrome.runtime.sendMessage({ type: 'TEST_PROXY', proxy });

  btn.disabled = false;
  btn.textContent = 'Test Config';

  if (res.success) {
    showToast('✓ Config valid — apply & visit ip-check.info', 'success');
  } else {
    showToast(res.error, 'error');
  }
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

function updateToggleLabel(enabled) {
  const label = document.getElementById('toggle-state-label');
  label.textContent = enabled ? 'ON' : 'OFF';
  label.style.color = enabled ? 'var(--accent)' : 'var(--text-muted)';
}

function updateStatusBar(s) {
  const bar = document.getElementById('status-bar');
  const text = document.getElementById('status-text');

  bar.className = 'status-bar';

  if (!s.proxy.host) {
    text.textContent = 'No proxy configured';
    return;
  }

  if (s.enabled) {
    bar.classList.add('active');
    text.textContent = `${s.proxy.type.toUpperCase()} → ${s.proxy.host}:${s.proxy.port}`;
  } else {
    text.textContent = `${s.proxy.type.toUpperCase()} ${s.proxy.host}:${s.proxy.port} (inactive)`;
  }
}

let toastTimer = null;

function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2800);
}
