// ProxyShield - Background Service Worker (MV3 Compatible)
// Fix 1: Use `fixed_servers` mode — avoids pacScript ASCII/Punycode issues entirely
// Fix 2: Removed asyncBlocking webRequest (not allowed in MV3 without force-install policy)

const DEFAULT_SETTINGS = {
  enabled: false,
  proxy: {
    type: 'http',
    host: '',
    port: '',
    username: '',
    password: ''
  },
  leakPrevention: {
    webrtc: true,
    dnsPrefetch: true,
    proxyDns: true,
    blockUdp: true
  },
  profiles: []
};

let currentSettings = { ...DEFAULT_SETTINGS };

// ─── Init ────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get('settings');
  if (!stored.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  } else {
    currentSettings = stored.settings;
  }
  if (currentSettings.enabled && currentSettings.proxy.host) {
    await applyProxy(currentSettings);
  }
  updateIcon(currentSettings.enabled);
});

chrome.runtime.onStartup.addListener(async () => {
  const stored = await chrome.storage.local.get('settings');
  if (stored.settings) {
    currentSettings = stored.settings;
    if (currentSettings.enabled && currentSettings.proxy.host) {
      await applyProxy(currentSettings);
    }
    updateIcon(currentSettings.enabled);
  }
});

// ─── Message Handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => {
    sendResponse({ success: false, error: err.message });
  });
  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case 'GET_SETTINGS':  return { success: true, settings: currentSettings };
    case 'SAVE_SETTINGS': return await saveSettings(message.settings);
    case 'TOGGLE_PROXY':  return await toggleProxy(message.enabled);
    case 'TEST_PROXY':    return await testProxy(message.proxy);
    case 'GET_STATUS':    return await getStatus();
    case 'APPLY_PROFILE': return await applyProfile(message.profile);
    default:              return { success: false, error: 'Unknown message type' };
  }
}

// ─── Proxy Application ────────────────────────────────────────────────────────
//
// FIX 1: Use `fixed_servers` mode instead of `pac_script`.
// pac_script.data only supports ASCII — Punycode IDN hostnames throw errors.
// fixed_servers is cleaner, more reliable, and has no encoding restrictions.
//
// SOCKS5 note: Chrome's native SOCKS5 scheme resolves DNS on the proxy server
// automatically — no extra config needed for remote DNS with fixed_servers.

async function applyProxy(settings) {
  const { proxy, leakPrevention } = settings;

  if (!proxy.host || !proxy.port) {
    throw new Error('Proxy host and port are required');
  }

  const port = parseInt(proxy.port, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error('Invalid port number');
  }

  const scheme = proxyTypeToScheme(proxy.type);

  const proxyConfig = {
    mode: 'fixed_servers',
    rules: {
      singleProxy: {
        scheme: scheme,
        host: proxy.host,
        port: port
      },
      bypassList: [
        'localhost',
        '127.0.0.1',
        '[::1]',
        '10.0.0.0/8',
        '172.16.0.0/12',
        '192.168.0.0/16',
        '*.local'
      ]
    }
  };

  await chrome.proxy.settings.set({
    value: proxyConfig,
    scope: 'regular'
  });

  if (proxy.username) {
    storeProxyAuth(proxy);
  } else {
    clearProxyAuth();
  }

  await applyLeakPrevention(leakPrevention);
  console.log(`[ProxyShield] Applied: ${scheme}://${proxy.host}:${port}`);
}

function proxyTypeToScheme(type) {
  const map = { http: 'http', https: 'https', socks4: 'socks4', socks5: 'socks5' };
  return map[type] || 'http';
}

async function clearProxy() {
  await chrome.proxy.settings.clear({ scope: 'regular' });
  await restorePrivacyDefaults();
  clearProxyAuth();
  console.log('[ProxyShield] Proxy cleared');
}

// ─── DNS & WebRTC Leak Prevention ─────────────────────────────────────────────

async function applyLeakPrevention(lp) {
  // WebRTC: 'disable_non_proxied_udp' blocks all UDP not going through proxy
  if (lp.webrtc) {
    await trySet(chrome.privacy.network.webRTCIPHandlingPolicy, 'disable_non_proxied_udp');
  }

  // DNS prefetch: Chrome pre-resolves domains via local DNS — leaks hostnames
  if (lp.dnsPrefetch) {
    await trySet(chrome.privacy.websites.networkPredictionEnabled, false);
  }

  // Hyperlink auditing: <a ping> can leak info
  await trySet(chrome.privacy.websites.hyperlinkAuditingEnabled, false);

  // Referrer headers
  if (lp.blockUdp) {
    await trySet(chrome.privacy.websites.referrersEnabled, false);
  }
}

async function restorePrivacyDefaults() {
  const apis = [
    chrome.privacy.network.webRTCIPHandlingPolicy,
    chrome.privacy.websites.networkPredictionEnabled,
    chrome.privacy.websites.hyperlinkAuditingEnabled,
    chrome.privacy.websites.referrersEnabled
  ];
  for (const api of apis) {
    try { await api.clear({ scope: 'regular' }); } catch (_) {}
  }
}

async function trySet(api, value) {
  try {
    await api.set({ value, scope: 'regular' });
  } catch (e) {
    console.warn('[ProxyShield] Privacy API unavailable:', e.message);
  }
}

// ─── Proxy Auth ───────────────────────────────────────────────────────────────
//
// FIX 2: MV3 does NOT allow 'asyncBlocking' or 'blocking' extraInfoSpec.
// The 'webRequestBlocking' permission is restricted to enterprise force-installed
// extensions only (ExtensionInstallForcelist policy).
//
// Solution: Register onAuthRequired WITHOUT extraInfoSpec.
// The synchronous return value still works for supplying cached credentials.
// Chrome will fall back to showing its own auth dialog if no credentials stored.

let proxyAuth = null;

function storeProxyAuth(proxy) {
  proxyAuth = { username: proxy.username, password: proxy.password };
}

function clearProxyAuth() {
  proxyAuth = null;
}

// Non-blocking — MV3 compatible, no extraInfoSpec needed
chrome.webRequest.onAuthRequired.addListener(
  (details) => {
    if (proxyAuth && details.isProxy) {
      return { authCredentials: { username: proxyAuth.username, password: proxyAuth.password } };
    }
    return {};
  },
  { urls: ['<all_urls>'] }
  // No ['asyncBlocking'] — not permitted in MV3 consumer extensions
);

// ─── Toggle & Save ────────────────────────────────────────────────────────────

async function toggleProxy(enabled) {
  currentSettings.enabled = enabled;

  if (enabled) {
    if (!currentSettings.proxy.host || !currentSettings.proxy.port) {
      currentSettings.enabled = false;
      return { success: false, error: 'Configure a proxy host and port first' };
    }
    try {
      await applyProxy(currentSettings);
    } catch (e) {
      currentSettings.enabled = false;
      return { success: false, error: e.message };
    }
  } else {
    await clearProxy();
  }

  await chrome.storage.local.set({ settings: currentSettings });
  updateIcon(enabled);
  return { success: true, enabled };
}

async function saveSettings(settings) {
  currentSettings = { ...currentSettings, ...settings };
  await chrome.storage.local.set({ settings: currentSettings });

  if (currentSettings.enabled && currentSettings.proxy.host) {
    try {
      await applyProxy(currentSettings);
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  return { success: true };
}

async function applyProfile(profile) {
  currentSettings.proxy = { ...profile.proxy };
  currentSettings.leakPrevention = { ...profile.leakPrevention };

  if (currentSettings.enabled) {
    await applyProxy(currentSettings);
  }

  await chrome.storage.local.set({ settings: currentSettings });
  return { success: true };
}

// ─── Proxy Test ───────────────────────────────────────────────────────────────

async function testProxy(proxy) {
  if (!proxy.host) return { success: false, error: 'Host is required' };
  if (!proxy.port) return { success: false, error: 'Port is required' };

  const port = parseInt(proxy.port, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    return { success: false, error: 'Invalid port (must be 1–65535)' };
  }

  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const hostRegex = /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;

  if (!ipRegex.test(proxy.host) && !hostRegex.test(proxy.host)) {
    return { success: false, error: 'Invalid host format' };
  }

  return {
    success: true,
    message: `Config valid: ${proxy.type}://${proxy.host}:${proxy.port}`,
    note: 'Save & enable, then visit ipleak.net to verify'
  };
}

// ─── Status ───────────────────────────────────────────────────────────────────

async function getStatus() {
  const proxyState = await chrome.proxy.settings.get({});
  const webrtcState = await chrome.privacy.network.webRTCIPHandlingPolicy.get({}).catch(() => null);

  return {
    success: true,
    enabled: currentSettings.enabled,
    proxy: currentSettings.proxy,
    proxyMode: proxyState.value?.mode || 'system',
    webrtcPolicy: webrtcState?.value || 'unknown',
    leakPrevention: currentSettings.leakPrevention
  };
}

// ─── Icon ─────────────────────────────────────────────────────────────────────

function updateIcon(enabled) {
  chrome.action.setBadgeText({ text: enabled ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ color: enabled ? '#00C896' : '#666666' });
}
