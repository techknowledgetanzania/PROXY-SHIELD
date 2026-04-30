# ProxyShield

A Manifest V3 Chrome extension for routing browser traffic through HTTP, HTTPS, SOCKS4, or SOCKS5 proxies with best-effort DNS leak prevention.

## Features

- **Multi-protocol**: HTTP, HTTPS, SOCKS4, SOCKS5
- **Proxy auth**: username/password via `webRequestAuthProvider`
- **DNS leak mitigation**:
  - WebRTC restricted to proxied UDP only (`disable_non_proxied_udp`)
  - Chrome DNS prefetch disabled (stops local pre-resolution)
  - Hyperlink audit pings (`<a ping>`) disabled
  - Referer headers disabled
- **Privacy snapshot**: your previous privacy settings are saved and restored when you disable the proxy — we don't clobber your preferences
- **Saved profiles**: create, switch, and delete named proxy configs
- **MV3-safe background**: `ensureSettings()` re-reads storage on every wake-up so idle service worker restarts don't silently lose state

## Install (developer mode)

1. Clone or download this repo
2. Open `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the `proxy-extension/` folder
5. The 🛡 ProxyShield icon appears in your toolbar

## Verify your protection

After enabling a proxy, check these sites:

| Tool | What it checks |
|---|---|
| [ipleak.net](https://ipleak.net) | IP address visible to sites |
| [browserleaks.com/webrtc](https://browserleaks.com/webrtc) | WebRTC real-IP exposure |
| [dnsleaktest.com](https://dnsleaktest.com) | DNS resolver leakage |

## Known limitations

- **Browser traffic only** — OS-level traffic, other apps, and UDP outside WebRTC are not affected
- **SOCKS5 DNS**: `fixed_servers` with scheme `socks5` resolves DNS on the proxy server automatically in Chrome — no extra config needed
- **Proxy auth in MV3**: Chrome does not permit `blocking` webRequest in consumer extensions; credentials are supplied via the synchronous return value of `onAuthRequired` (requires `webRequestAuthProvider` permission, included in manifest)
- **No connectivity test**: "Validate Config" checks format only. Real verification requires applying the proxy and visiting a leak-test site

## File structure

```
proxy-extension/
├── manifest.json          MV3 manifest
├── popup.html / src/popup.js      Toolbar popup
├── options.html / src/options.js  Profiles & settings page
├── src/background.js      Service worker — proxy engine
├── fonts/                 Bundled Space Grotesk + JetBrains Mono
└── icons/                 16 / 48 / 128px icons
```
