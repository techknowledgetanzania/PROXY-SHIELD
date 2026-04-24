// ProxyShield - Background Service Worker
// Handles proxy configuration, DNS leak prevention, and WebRTC leak mitigation

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
    proxyDns: true,       // SOCKS5 remote DNS resolution
    blockUdp: true
  },
  profiles: []
};

let currentSettings = { ...DEFAULT_SETTINGS };

// ─── Init ───────────────────────────────────────────────────────────────────

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

// ─── Message Handler ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => {
    sendResponse({ success: false, error: err.message });
  });
  return true; // async
});

async function handleMessage(message) {
  switch (message.type) {
    case 'GET_SETTINGS':
      return { success: true, settings: currentSettings };

    case 'SAVE_SETTINGS':
      return await saveSettings(message.settings);

    case 'TOGGLE_PROXY':
      return await toggleProxy(message.enabled);

    case 'TEST_PROXY':
      return await testProxy(message.proxy);

    case 'GET_STATUS':
      return await getStatus();

    case 'APPLY_PROFILE':
      return await applyProfile(message.profile);

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

// ─── Proxy Application ────────────────────────────────────────────────────────

async function applyProxy(settings) {
  const { proxy, leakPrevention } = settings;

  if (!proxy.host || !proxy.port) {
    throw new Error('Proxy host and port are required');
  }

  const port = parseInt(proxy.port, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error('Invalid port number');
  }

  let proxyConfig;

  if (proxy.type === 'direct') {
    proxyConfig = { mode: 'direct' };
  } else {
    const scheme = getScheme(proxy.type, leakPrevention.proxyDns);

    // Build PAC script for maximum control and DNS routing
    const pacScript = buildPacScript(scheme, proxy.host, port);

    proxyConfig = {
      mode: 'pac_script',
      pacScript: {
        data: pacScript
      }
    };
  }

  await chrome.proxy.settings.set({
    value: proxyConfig,
    scope: 'regular'
  });

  // Apply all leak prevention measures
  await applyLeakPrevention(leakPrevention, proxy.type);

  // Store auth credentials if provided
  if (proxy.username && proxy.password) {
    storeProxyAuth(proxy);
  }

  console.log(`[ProxyShield] Proxy applied: ${proxy.type}://${proxy.host}:${proxy.port}`);
}

function getScheme(type, proxyDns) {
  switch (type) {
    case 'socks5':
      // proxyDns=true means DNS is resolved on the proxy server side — prevents DNS leaks
      return proxyDns ? 'socks5' : 'socks5';
    case 'socks4':
      return 'socks4';
    case 'https':
      return 'https';
    case 'http':
    default:
      return 'http';
  }
}

function buildPacScript(scheme, host, port) {
  // For SOCKS5 with remote DNS, use SOCKS5 which Chrome resolves DNS remotely
  // For HTTP proxies, PROXY directive is used
  let proxyDirective;

  if (scheme === 'socks5') {
    // SOCKS5 in PAC scripts: Chrome will resolve DNS through the SOCKS5 proxy
    proxyDirective = `SOCKS5 ${host}:${port}; SOCKS ${host}:${port}`;
  } else if (scheme === 'socks4') {
    proxyDirective = `SOCKS ${host}:${port}`;
  } else {
    // HTTP or HTTPS proxy
    proxyDirective = `PROXY ${host}:${port}`;
  }

  return `
    function FindProxyForURL(url, host) {
      // Bypass localhost and private ranges — never proxy these
      if (isPlainHostName(host)) return "DIRECT";
      if (host === "localhost" || host === "127.0.0.1" || host === "::1") return "DIRECT";

      // Bypass private IP ranges
      if (isInNet(host, "10.0.0.0", "255.0.0.0")) return "DIRECT";
      if (isInNet(host, "172.16.0.0", "255.240.0.0")) return "DIRECT";
      if (isInNet(host, "192.168.0.0", "255.255.0.0")) return "DIRECT";

      // Route all other traffic through proxy
      return "${proxyDirective}; DIRECT";
    }
  `.trim();
}

async function clearProxy() {
  await chrome.proxy.settings.clear({ scope: 'regular' });
  await restorePrivacyDefaults();
  console.log('[ProxyShield] Proxy cleared');
}

// ─── DNS & WebRTC Leak Prevention ────────────────────────────────────────────

async function applyLeakPrevention(leakPrevention, proxyType) {
  // 1. WebRTC leak prevention
  // WebRTC can bypass proxy and expose real IP — restrict it
  if (leakPrevention.webrtc) {
    try {
      await chrome.privacy.network.webRTCIPHandlingPolicy.set({
        value: 'disable_non_proxied_udp', // Most aggressive: only WebRTC via proxy
        scope: 'regular'
      });
    } catch (e) {
      console.warn('[ProxyShield] WebRTC policy not available:', e.message);
    }
  }

  // 2. DNS prefetching — Chrome pre-resolves domains using local DNS
  // This leaks hostnames you visit. Disable it.
  if (leakPrevention.dnsPrefetch) {
    try {
      await chrome.privacy.websites.networkPredictionEnabled.set({
        value: false,
        scope: 'regular'
      });
    } catch (e) {
      console.warn('[ProxyShield] DNS prefetch control not available:', e.message);
    }
  }

  // 3. Hyperlinking auditing — can leak info
  try {
    await chrome.privacy.websites.hyperlinkAuditingEnabled.set({
      value: false,
      scope: 'regular'
    });
  } catch (e) {}

  // 4. Safe browsing & referrer tracking
  try {
    await chrome.privacy.websites.referrersEnabled.set({
      value: false,
      scope: 'regular'
    });
  } catch (e) {}
}

async function restorePrivacyDefaults() {
  const apis = [
    chrome.privacy.network.webRTCIPHandlingPolicy,
    chrome.privacy.websites.networkPredictionEnabled,
    chrome.privacy.websites.hyperlinkAuditingEnabled,
    chrome.privacy.websites.referrersEnabled
  ];

  for (const api of apis) {
    try {
      await api.clear({ scope: 'regular' });
    } catch (e) {}
  }
}

// ─── Proxy Auth Handler ───────────────────────────────────────────────────────

let proxyAuth = null;

function storeProxyAuth(proxy) {
  proxyAuth = {
    username: proxy.username,
    password: proxy.password,
    host: proxy.host,
    port: parseInt(proxy.port, 10)
  };
}

// Handle proxy auth challenges
chrome.webRequest.onAuthRequired.addListener(
  (details, callback) => {
    if (proxyAuth && details.isProxy) {
      callback({
        authCredentials: {
          username: proxyAuth.username,
          password: proxyAuth.password
        }
      });
    } else {
      callback({});
    }
  },
  { urls: ['<all_urls>'] },
  ['asyncBlocking']
);

// ─── Toggle & Save ────────────────────────────────────────────────────────────

async function toggleProxy(enabled) {
  currentSettings.enabled = enabled;

  if (enabled) {
    if (!currentSettings.proxy.host || !currentSettings.proxy.port) {
      return { success: false, error: 'Configure proxy host and port first' };
    }
    await applyProxy(currentSettings);
  } else {
    await clearProxy();
    proxyAuth = null;
  }

  await chrome.storage.local.set({ settings: currentSettings });
  updateIcon(enabled);

  return { success: true, enabled };
}

async function saveSettings(settings) {
  currentSettings = { ...currentSettings, ...settings };
  await chrome.storage.local.set({ settings: currentSettings });

  if (currentSettings.enabled) {
    await applyProxy(currentSettings);
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
  // We can't directly test proxy connectivity from the service worker
  // but we can validate the config and check current proxy state
  if (!proxy.host) return { success: false, error: 'Host is required' };
  if (!proxy.port) return { success: false, error: 'Port is required' };

  const port = parseInt(proxy.port, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    return { success: false, error: 'Invalid port number (1-65535)' };
  }

  const hostRegex = /^(\d{1,3}\.){3}\d{1,3}$|^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!hostRegex.test(proxy.host)) {
    return { success: false, error: 'Invalid host format' };
  }

  return {
    success: true,
    message: `Config valid: ${proxy.type}://${proxy.host}:${proxy.port}`,
    note: 'Apply proxy and visit ip-check.info to verify'
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
    proxyState: proxyState.value,
    webrtcPolicy: webrtcState?.value || 'unknown',
    leakPrevention: currentSettings.leakPrevention
  };
}

// ─── Icon ─────────────────────────────────────────────────────────────────────

function updateIcon(enabled) {
  // Badge text to show on/off state
  chrome.action.setBadgeText({ text: enabled ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({
    color: enabled ? '#00C896' : '#666666'
  });
}
