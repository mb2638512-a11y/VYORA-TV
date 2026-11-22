# VYORA Browser — Orbit Core Integration

## Status

Integration is planned and pinned to the reviewed upstream snapshot below. This document is a migration contract, not a claim that Orbit has already been integrated.

- Upstream: https://github.com/egeeuzun/orbit
- Reviewed upstream commit: `c2b6077f0c309b2a8fa830a7a8c8e19e4cf4259a`
- Upstream license: **not declared by the GitHub repository** (API reports `license: null`; no root `LICENSE` file was present in the inspected tree). Do not copy upstream source or redistribute its native binaries unless the author supplies a license or written permission. Third-party dependency licenses do not grant rights to the Orbit application code.
- Upstream runtime: Android System WebView
- Upstream native component: Brave adblock-rust JNI
- VYORA integration branch: `feature/orbit-browser-core-port`

## Integration direction

Use Orbit's browser implementation as the Android browser foundation while retaining VYORA's product identity and app-specific features:

- Keep VYORA branding, phone/TV layouts, navigation entry point and search-provider catalog.
- Keep per-tab search provider selection and VYORA's configured search URL templates.
- Port Orbit's tab lifecycle, WebView client/chrome client, download handling, popup/new-window flow, site permissions, history/bookmarks and memory-pressure behavior.
- Keep TV remote/D-pad navigation as a VYORA-owned UI adaptation; do not blindly import phone-only interactions.
- Do not replace or route VYORA live-TV playback traffic through the browser proxy.

## Network, privacy and popup policy

1. **No browser-wide proxy by default.** Normal browsing should use Android WebView's normal network path. Do not add a proxy/VPN workaround as a default dependency.
2. **No silent endless retry.** A navigation that fails or stalls must expose a recoverable error/retry state. Do not automatically loop between proxy and direct routes.
3. **Private tabs must be genuinely isolated.** Use supported WebView profile isolation where available; otherwise use a clearly documented fallback that clears cookies, cache, DOM storage and history on private-session exit. Never imply profile isolation if the platform does not provide it.
4. **Popups must be context-aware.** Support legitimate `window.open`, OAuth/sign-in windows and target=_blank flows. Block only requests identified as advertising/unwanted by the protection layer, and allow per-site exceptions. Never disable all multiple-window support globally.
5. **Site protection is configurable.** Ad blocking defaults to a balanced list; provide per-site disable/allowlist. Do not let filter rules block first-party login, payment, video playback or essential page scripts without a user-visible way to disable protection for that site.
6. **HTTPS errors remain secure.** Never bypass certificate errors or proceed through invalid TLS certificates.

## Build and licensing requirements

- Port into VYORA's existing Android packaging only after verifying all required Gradle/Kotlin/AndroidX and native NDK/Rust build inputs.
- Prefer consuming a reproducible upstream release/artifact only if its provenance, ABI coverage, version and license are verifiable; otherwise build the JNI library from source in CI.
- Treat Orbit application code and its checked-in native binaries as all-rights-reserved until an explicit license or written permission is obtained; do not vendor/copy them meanwhile.
- If permission is granted, retain the exact upstream notices and identify every modified file. Preserve third-party notices for Brave adblock-rust and filter lists; their licenses are separate from Orbit's application-code rights.
- Do not copy upstream release APKs or native binaries into VYORA without a verified redistribution grant and ABI/provenance checks.
- Pin upstream source to the commit above initially; upgrades must be deliberate PRs.

## Acceptance checklist

### Browser behavior
- [ ] Google, Bing, DuckDuckGo, Brave and VYORA custom search destinations work from the address bar.
- [ ] A tab remembers its own search provider; newly created tabs use the configured default.
- [ ] Normal tabs retain login/session state; private tabs do not leak cookies/history/storage into normal tabs.
- [ ] OAuth, sign-in popups, target=_blank, downloads and file chooser flows work.
- [ ] Ad/pop-up protection can be disabled for one site without disabling it globally.
- [ ] No browser proxy is enabled by default; no navigation can remain in an infinite loading/retry loop.
- [ ] Back/forward/reload, tab restore, downloads, bookmarks and history work.
- [ ] Background tabs are suspended/restored within a bounded memory budget.

### Device and regression coverage
- [ ] Android phone touch, keyboard, safe areas and file picker.
- [ ] Android TV D-pad focus, remote back, focus visibility and landscape layout.
- [ ] Low-memory behavior and WebView renderer termination recovery.
- [ ] Existing VYORA channel playback, channel catalogue, app navigation and bridge APIs remain unchanged.

## Current known VYORA browser defects to eliminate

The existing `BrowserActivity` still creates a live WebView for every tab and has no isolated private-profile implementation. Popup support is now enabled for user-initiated windows, with scripted background popups rejected and transport validation added; this is an interim compatibility fix, not the full Orbit popup/adblock policy. The per-tab WebView allocation is a key memory/performance gap versus Orbit's single-live-WebView + saved-state tab lifecycle. Replace this implementation as the Orbit port lands; do not treat a settings-only cosmetic change as a fix.

## CI strategy

Use GitHub Actions on this branch/PR to:
1. Validate upstream pin and required license notices.
2. Compile the Android app for phone and TV variants.
3. Run browser regression checks for navigation, search-provider persistence, popup handling, private-session cleanup and proxy-off behavior.
4. Upload phone and TV APK artifacts for device testing.

A successful CI build is not a substitute for physical Android phone and Android TV testing.


## Orbit source audit — performance-critical pieces

The pinned Orbit tree was inspected at the exact upstream commit. It is a complete browser application, not a standalone WebView dependency. Its performance characteristics depend on the combined implementation:

- `TabManager` keeps background tabs serialized and restores a WebView when selected; only a bounded number of renderers stay live.
- `WebViewFactory` applies low-memory WebView settings, safe browsing, image controls, cache policy, document-start cosmetic/performance scripts and WebKit feature checks.
- `AdblockService` builds filter lists off the UI thread, keeps a compiled `engine.bin` cache and a fast `hosts.bin` path, and avoids repeating a failed/OOM filter compilation on every launch.
- `AdblockEngine` uses a read/write lock around JNI handles so request filtering cannot race native-engine replacement/free.
- `OrbitWebViewClient` and `OrbitChromeClient` coordinate request interception, page lifecycle, popup windows and site-level protection.
- `NativeAdblock` requires the matching Rust JNI ABI plus packaged `libadblock_jni.so` files for supported Android ABIs. Kotlin wrappers alone do not enable ad blocking.

The current VYORA branch has no Orbit JNI libraries or Rust engine sources in its Android tree yet. The existing CI success therefore validates the VYORA Android packaging and current browser shell only; it does not validate Orbit ad blocking, Orbit's low-memory tab lifecycle, or private-profile isolation.

### Performance acceptance targets

- Keep only the active tab's WebView alive by default; save and restore background tab state safely.
- Never compile multi-megabyte filter lists on the UI thread. Download, parse, compile and persist filter data in background workers.
- Load a versioned compiled filter cache on subsequent launches; fall back safely if the JNI library or cache is unavailable.
- Bound in-memory decision caches and release them under memory pressure.
- Do not eagerly restore every tab's WebView on app startup.
- Preserve opener relationships while an OAuth popup is active so `window.opener.postMessage` flows continue to work.
- Measure cold start, first-page render, tab switch, peak memory and renderer recovery on a low-RAM phone before claiming Orbit-level performance.


## Upstream licensing gate (verified 2026-11-23)

The public GitHub repository metadata currently reports `license: null`, and the inspected root tree has no `LICENSE` file. An earlier assumption that Orbit was MPL-2.0 was incorrect and is superseded by this gate. Before copying Orbit Kotlin/Java code or its prebuilt JNI `.so` files, obtain a clear license from the author or written permission covering modification and redistribution. Until then, VYORA may implement compatible behavior independently and use public technical documentation, but must not vendor the upstream application source or binaries. The Rust crate's dependency licenses do not automatically license Orbit's wrapper code or checked-in binaries.
