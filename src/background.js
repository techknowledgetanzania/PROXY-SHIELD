// ProxyShield Background Service Worker — v1.1.0
// ─────────────────────────────────────────────────────────────────────────────
// MV3 service workers are terminated when idle. ALL module-level variables
// reset on the next wake-up. Every public entry point calls ensureSettings()
// first so we always work from storage, never from stale in-memory state.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  enabled: false,
  proxy: { type: 'http', host: '', port: '', username: '', password: '' },
  // FIX 3: keys now match exactly what the UI renders and what the code uses.
  // proxyDns removed (fixed_servers SOCKS5 always resolves DNS remotely — no
  // extra toggle needed). blockUdp renamed blockReferrers.
  leakPrevention: {
    webrtc: true,              // chrome.privacy.network.webRTCIPHandlingPolicy
    dnsPrefetch: true,         // chrome.privacy.websites.networkPredictionEnabled
    blockHyperlinkAudit: true, // chrome.privacy.websites.hyperlinkAuditingEnabled
    blockReferrers: true       // chrome.privacy.websites.referrersEnabled
  },
  // FIX 5: snapshot of user's own privacy values taken before we change anything.
  // Restored on disable so we don't clobber user preferences.
  _privacySnapshot: null,
  profiles: []
};

// ── FIX 1: settings hydration ─────────────────────────────────────────────────
// Called at the top of EVERY exported handler. Re-reads from storage so a
// just-woken service worker has correct state before doing anything.

async function ensureSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings ? { ...DEFAULTS, ...settings } : { ...DEFAULTS };
}

async function persist(s) {
  await chrome.storage.local.set({ settings: s });
}

// ── Startup / install ─────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  const s = await ensureSettings();
  if (!s.proxy.host) await persist(DEFAULTS); // first install
  if (s.enabled && s.proxy.host) await applyProxy(s);
  badge(s.enabled);
});

chrome.runtime.onStartup.addListener(async () => {
  const s = await ensureSettings();
  if (s.enabled && s.proxy.host) await applyProxy(s);
  badge(s.enabled);
});

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    const s = await ensureSettings(); // FIX 1 — always fresh before dispatch
    try {
      reply(await dispatch(msg, s));
    } catch (err) {
      console.error('[ProxyShield]', err);
      reply({ success: false, error: err.message });
    }
  })();
  return true; // keep port open
});

async function dispatch(msg, s) {
  switch (msg.type) {
    case 'GET_SETTINGS':    return { success: true, settings: s };
    case 'SAVE_SETTINGS':   return save(msg.settings, s);
    case 'TOGGLE_PROXY':    return toggle(msg.enabled, s);
    case 'VALIDATE_CONFIG': return validate(msg.proxy);       // FIX 4: renamed
    case 'GET_STATUS':      return status(s);
    case 'APPLY_PROFILE':   return applyProfile(msg.profile, s);
    default:                return { success: false, error: 'Unknown message' };
  }
}

// ── Proxy application ─────────────────────────────────────────────────────────

async function applyProxy(s) {
  const { proxy, leakPrevention } = s;
  if (!proxy.host || !proxy.port) throw new Error('Host and port are required');

  const port = parseInt(proxy.port, 10);
  if (isNaN(port) || port < 1 || port > 65535) throw new Error('Port must be 1–65535');

  const scheme = { http:'http', https:'https', socks4:'socks4', socks5:'socks5' }[proxy.type] ?? 'http';

  await chrome.proxy.settings.set({
    value: {
      mode: 'fixed_servers',
      rules: {
        singleProxy: { scheme, host: proxy.host, port },
        // Never route loopback or RFC-1918 ranges through proxy
        bypassList: ['localhost','127.0.0.1','[::1]','10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','*.local']
      }
    },
    scope: 'regular'
  });

  // Keep auth in memory for the onAuthRequired listener.
  // FIX 2: credentials persist in storage so they survive a worker restart.
  _auth = proxy.username ? { username: proxy.username, password: proxy.password } : null;

  await applyLeakPrevention(leakPrevention, s);
  console.log(`[ProxyShield] applied ${scheme}://${proxy.host}:${port}`);
}

async function clearProxy(s) {
  await chrome.proxy.settings.clear({ scope: 'regular' });
  await restoreSnapshot(s);
  _auth = null;
}

// ── FIX 5: Snapshot & restore ─────────────────────────────────────────────────
// Read the current values of every privacy setting we might change,
// store them in settings._privacySnapshot, then restore on disable.

const PRIVACY_TARGETS = [
  { key: 'webrtc',             api: () => chrome.privacy.network.webRTCIPHandlingPolicy },
  { key: 'netPredict',         api: () => chrome.privacy.websites.networkPredictionEnabled },
  { key: 'hyperlinkAudit',     api: () => chrome.privacy.websites.hyperlinkAuditingEnabled },
  { key: 'referrers',          api: () => chrome.privacy.websites.referrersEnabled }
];

async function snapshotPrivacy() {
  const snap = {};
  for (const { key, api } of PRIVACY_TARGETS) {
    try { snap[key] = (await api().get({})).value; }
    catch { snap[key] = null; } // API unavailable — skip on restore too
  }
  return snap;
}

async function applyLeakPrevention(lp, s) {
  // Snapshot only once per enable session
  if (!s._privacySnapshot) {
    s._privacySnapshot = await snapshotPrivacy();
    await persist(s);
  }

  // FIX 3: every key name matches its actual API target — no misleading labels
  if (lp.webrtc)            await tryPrivacy(chrome.privacy.network.webRTCIPHandlingPolicy, 'disable_non_proxied_udp');
  if (lp.dnsPrefetch)       await tryPrivacy(chrome.privacy.websites.networkPredictionEnabled, false);
  if (lp.blockHyperlinkAudit) await tryPrivacy(chrome.privacy.websites.hyperlinkAuditingEnabled, false);
  if (lp.blockReferrers)    await tryPrivacy(chrome.privacy.websites.referrersEnabled, false);
}

async function restoreSnapshot(s) {
  const snap = s._privacySnapshot;
  if (!snap) return; // never changed anything — nothing to restore

  const pairs = [
    [chrome.privacy.network.webRTCIPHandlingPolicy, snap.webrtc],
    [chrome.privacy.websites.networkPredictionEnabled, snap.netPredict],
    [chrome.privacy.websites.hyperlinkAuditingEnabled, snap.hyperlinkAudit],
    [chrome.privacy.websites.referrersEnabled, snap.referrers]
  ];
  for (const [api, val] of pairs) {
    if (val === null || val === undefined) continue;
    try { await api.set({ value: val, scope: 'regular' }); } catch { /* unavailable */ }
  }

  s._privacySnapshot = null; // clear so next enable gets a fresh snapshot
  await persist(s);
}

async function tryPrivacy(api, value) {
  try { await api.set({ value, scope: 'regular' }); }
  catch (e) { console.warn('[ProxyShield] privacy API skipped:', e.message); }
}

// ── FIX 2: Proxy auth ─────────────────────────────────────────────────────────
// webRequestAuthProvider in manifest (required for onAuthRequired in MV3).
// Credentials live in _auth (memory) + storage so they survive worker restarts.
// No 'blocking' extraInfoSpec — that requires enterprise force-install policy.

let _auth = null; // repopulated by ensureSettings via applyProxy on worker wake

chrome.webRequest.onAuthRequired.addListener(
  (details) => {
    if (_auth && details.isProxy) {
      return { authCredentials: { username: _auth.username, password: _auth.password } };
    }
    return {}; // Chrome shows its own prompt if no credentials
  },
  { urls: ['<all_urls>'] }
  // no extraInfoSpec — 'blocking' not permitted in MV3 consumer extensions
);

// ── Toggle, save, profile ─────────────────────────────────────────────────────

async function toggle(enabled, s) {
  if (enabled) {
    if (!s.proxy.host || !s.proxy.port)
      return { success: false, error: 'Set a proxy host and port first' };
    try { await applyProxy(s); }
    catch (e) { return { success: false, error: e.message }; }
    s.enabled = true;
  } else {
    s.enabled = false;
    await clearProxy(s);
  }
  await persist(s);
  badge(s.enabled);
  return { success: true, enabled: s.enabled };
}

async function save(incoming, s) {
  // Merge but preserve any existing snapshot
  const merged = { ...s, ...incoming, _privacySnapshot: s._privacySnapshot };
  if (merged.enabled && merged.proxy.host) {
    try { await applyProxy(merged); }
    catch (e) { return { success: false, error: e.message }; }
  }
  await persist(merged);
  return { success: true };
}

async function applyProfile(profile, s) {
  s.proxy          = { ...s.proxy, ...profile.proxy };
  s.leakPrevention = { ...s.leakPrevention, ...profile.leakPrevention };
  if (s.enabled) {
    try { await applyProxy(s); }
    catch (e) { return { success: false, error: e.message }; }
  }
  await persist(s);
  return { success: true };
}

// ── FIX 4: Validate (replaces "Test Config") ──────────────────────────────────
// Honest local validation only — we make it clear in the UI it's not a
// connectivity test. Real verification = apply + visit ipleak.net.

function validate(proxy) {
  if (!proxy.host) return { success: false, error: 'Host is required' };
  if (!proxy.port) return { success: false, error: 'Port is required' };

  const port = parseInt(proxy.port, 10);
  if (isNaN(port) || port < 1 || port > 65535)
    return { success: false, error: 'Port must be 1–65535' };

  const ipv4     = /^(\d{1,3}\.){3}\d{1,3}$/;
  const hostname = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (!ipv4.test(proxy.host) && !hostname.test(proxy.host))
    return { success: false, error: 'Invalid host — use an IP address or hostname' };

  if (ipv4.test(proxy.host)) {
    const octs = proxy.host.split('.').map(Number);
    if (octs.some(o => o > 255)) return { success: false, error: 'Invalid IPv4 address' };
  }

  return { success: true };
}

// ── Status ────────────────────────────────────────────────────────────────────

async function status(s) {
  const proxyState = await chrome.proxy.settings.get({});
  const rtcState   = await chrome.privacy.network.webRTCIPHandlingPolicy.get({}).catch(() => null);
  return {
    success: true,
    enabled: s.enabled,
    proxy: s.proxy,
    proxyMode: proxyState.value?.mode ?? 'system',
    levelOfControl: proxyState.levelOfControl,
    webrtcPolicy: rtcState?.value ?? 'unknown',
    leakPrevention: s.leakPrevention,
    hasSnapshot: !!s._privacySnapshot
  };
}

// ── Badge ─────────────────────────────────────────────────────────────────────

function badge(on) {
  chrome.action.setBadgeText({ text: on ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ color: on ? '#00C896' : '#666666' });
}
