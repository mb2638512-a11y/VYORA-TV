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
3. **Private tabs must be genuinely isolated.** Android 9+ launches a dedicated private-browser process and calls `WebView.setDataDirectorySuffix("vyora_private")` before the first WebView is created. Private tabs use a separate preference namespace, are not restored or persisted, and clear cookies, cache, DOM storage, form data and history when the private window closes. On Android 8.1 and older, private mode is disabled rather than pretending shared WebView storage is isolated.
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
- [ ] Verify on Android 9+ that normal and private cookies/DOM storage are isolated in both directions; verify private data is cleared after close and after process restart.
- [x] Add a dedicated private-browser process with WebView data-directory suffix on Android 9+; private tabs are not persisted and cleanup runs on close.
- [x] Disable private browsing on Android 8.1 and older rather than expose a non-isolated mode.
- [ ] OAuth, sign-in popups, target=_blank, downloads and file chooser flows work.
- [x] Hosts-based ad/tracker protection can be paused for the active host; long-press Shield to toggle global protection.
- [ ] Expand filter coverage and add full EasyList-style cosmetic/scriptlet rules and a dedicated popup rules engine.
- [ ] No browser proxy is enabled by default; no navigation can remain in an infinite loading/retry loop.
- [ ] Back/forward/reload, tab restore, downloads, bookmarks and history work.
- [ ] Background tabs are suspended/restored within a bounded memory budget.

### Device and regression coverage
- [ ] Android phone touch, keyboard, safe areas and file picker.
- [ ] Android TV D-pad focus, remote back, focus visibility and landscape layout.
- [ ] Low-memory behavior and WebView renderer termination recovery.
- [ ] Existing VYORA channel playback, channel catalogue, app navigation and bridge APIs remain unchanged.

## Current known VYORA browser defects to eliminate

The current `BrowserActivity` now creates tab metadata lazily, suspends background WebViews with saved state, and keeps the active tab plus its OAuth opener live. It also handles renderer-process termination by detaching the failed renderer and allowing the user to reload the last URL. Navigation controls are guarded when a tab has no live renderer. This is a first VYORA-owned approximation of Orbit's bounded-renderer lifecycle, not a full Orbit port. User-gesture popups are supported with transport validation, but the full site-aware popup/adblock policy is still missing. Private browsing now launches a separate process/profile on Android 9+; it remains unverified on physical devices. Android 8.1 and older are deliberately blocked from private mode because this implementation cannot safely isolate their WebView storage.

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


## VYORA implementation progress (2026-11-23)

- [x] Lazy tab metadata and on-demand WebView allocation.
- [x] Suspend background renderers and save WebView state; restore on tab selection.
- [x] Preserve the OAuth opener renderer while its popup tab is active.
- [x] Recover from a WebView renderer-process crash without crashing the whole Activity; reload is user-triggered to avoid retry loops.
- [x] Guard toolbar navigation actions when a renderer is absent.
- [x] Add a lightweight, bounded hosts-file blocker for known ad/tracker subresources; list download/parse runs off the UI thread, cache is reused, top-level navigation is never blocked, and failures are fail-open.
- [ ] Add a full filter-engine implementation (cosmetic filters, exception/important rules, redirects and site-level controls); this is separate from the basic hosts blocker and must use independently licensed code or a verified redistribution grant.
- [ ] Implement genuinely isolated private browsing and test cookie/storage separation.
- [ ] Add polished main-frame error/retry UI and site permissions.
- [x] Add a 45-second navigation watchdog that stops stalled loads without proxy retries or automatic reload loops; user can tap Reload.
- [ ] Run real-device low-memory, phone and Android TV tests.


The first VYORA-owned protection layer now uses the MIT-licensed StevenBlack hosts data (attribution in `THIRD_PARTY_NOTICES.md`). It blocks only subresource requests matching the bounded host set and explicitly fails open. This is not equivalent to Orbit's Brave/uBlock-compatible native engine and does not provide cosmetic filtering or per-site exceptions yet.


## Private browsing implementation (2026-11-23)

- `PrivateBrowserActivity` runs under the manifest process `:private_browser` and sets the WebView data-directory suffix before `BrowserActivity` creates a renderer.
- The private process uses a separate preference namespace; `saveSession()` is a no-op and private startup does not restore saved tabs.
- The toolbar opens a private window with the current URL/search provider and exposes an explicit Exit private control.
- Closing the private Activity clears WebView cache/history/form data, cookies and DOM storage before its renderer is destroyed.
- Android API 27 and below are intentionally unsupported for private mode; the UI explains why rather than sharing the normal profile.
- This is implemented in source but still needs physical-device verification, including abrupt process termination and cookie/storage separation tests.


## Site protection controls (2026-11-23)

The browser toolbar now exposes a Shield control. Tap it to allowlist/unallowlist the active host (including its subdomains); long-press it to toggle the global hosts-based protection layer. This is a basic hosts-rule control, not a full EasyList/uBlock rules engine. Login, payment and video sites can be allowlisted when a filter causes breakage.


## Navigation watchdog (2026-11-23)

Main-frame navigation now gets a 45-second watchdog. A navigation that never completes is stopped, its progress indicator is cleared, and the user is told to retry manually. The watchdog is cancelled on page completion, main-frame errors, tab suspension, renderer termination and tab closure. Reload uses WebView's reload path when a live renderer exists; it does not automatically retry or switch proxies.
