/*
 * Vyora TV web-proxy bridge (Android TV local server).
 *
 * This script is injected into every HTML page that the local server proxies.
 * It keeps the browsing experience inside the app:
 *   - clicks never leave the app (no OS browser window),
 *   - search-engine redirect links are unpacked to their real destination,
 *   - a YouTube video link is turned into its embeddable form,
 *   - the page's own API calls are routed back through the proxy so a single
 *     page app (YouTube, news sites, ...) still receives its data instead of
 *     being CORS-blocked.
 */
(function () {
  var CURRENT = window.__VYORA_CURRENT_URL__ || document.baseURI || window.location.href;

  /* Capture the REAL parent BEFORE the frame-buster override below. */
  var realParent = null;
  try { realParent = window.parent; } catch (e) { realParent = null; }

  function sendToHost(msg) {
    try {
      if (realParent && realParent !== window) {
        realParent.postMessage(msg, '*');
        return true;
      }
    } catch (e) {}
    return false;
  }

  function unpackRedirect(u) {
    if (!u) return u;
    try {
      var fixed = u.replace(/&amp;/g, '&');
      if (fixed.indexOf('//') === 0) fixed = 'https:' + fixed;

      /* DuckDuckGo: /l/?uddg=<dest> */
      if (fixed.indexOf('/l/?') >= 0 && fixed.indexOf('uddg=') >= 0) {
        var p1 = new URL(fixed, 'https://duckduckgo.com');
        var d1 = p1.searchParams.get('uddg');
        if (d1) return unpackRedirect(d1);
      }
      /* Google: /url?q=<dest> */
      if (fixed.indexOf('/url?') >= 0 && (fixed.indexOf('q=') >= 0 || fixed.indexOf('url=') >= 0)) {
        var p2 = new URL(fixed, 'https://www.google.com');
        var d2 = p2.searchParams.get('q') || p2.searchParams.get('url');
        if (d2) return unpackRedirect(d2);
      }
      /* Bing: /ck/a?...&u=a1<base64> */
      if (fixed.indexOf('/ck/a') >= 0 && fixed.indexOf('u=') >= 0) {
        var p3 = new URL(fixed, 'https://www.bing.com');
        var u3 = p3.searchParams.get('u');
        if (u3 && u3.indexOf('a1') === 0) {
          var b64 = u3.slice(2).replace(/-/g, '+').replace(/_/g, '/');
          while (b64.length % 4 !== 0) b64 += '=';
          try {
            var dec = atob(b64);
            if (dec && (dec.indexOf('http://') === 0 || dec.indexOf('https://') === 0)) {
              return unpackRedirect(dec);
            }
          } catch (e) {}
        }
      }
      /* Yahoo: /RU=<encoded>/... */
      if (fixed.indexOf('/RU=') >= 0) {
        var m = fixed.match(/\/RU=([^/]+)/);
        if (m && m[1]) {
          var d4 = decodeURIComponent(m[1]);
          if (d4 && (d4.indexOf('http://') === 0 || d4.indexOf('https://') === 0)) {
            return unpackRedirect(d4);
          }
        }
      }
    } catch (e) {}
    return u;
  }

  /* Any YouTube video link -> the embed form (the only one that plays in a frame). */
  function toYoutubeEmbed(url) {
    try {
      var m = url.match(
        /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i
      );
      if (!m || !m[1]) return '';
      return 'https://www.youtube-nocookie.com/embed/' + m[1] + '?autoplay=1&rel=0&playsinline=1';
    } catch (e) {
      return '';
    }
  }

  function proxyNav(url) {
    if (!url) return false;
    var clean = unpackRedirect(url);
    var yt = toYoutubeEmbed(clean);
    if (yt) {
      sendToHost({ type: 'VYORA_NAVIGATE', url: yt });
      try { window.location.href = yt; } catch (e) {
        try { window.location.assign(yt); } catch (e2) {}
      }
      return true;
    }
    sendToHost({ type: 'VYORA_NAVIGATE', url: clean });
    var proxied = window.location.origin + '/api/webproxy?u=' + encodeURIComponent(clean);
    try { window.location.href = proxied; } catch (e) {
      try { window.location.assign(proxied); } catch (e2) {}
    }
    return true;
  }

  try {
    /* Frame-buster neutralizer: the page must believe it is the top window. */
    Object.defineProperty(window, 'top', { get: function () { return window.self; }, configurable: true });
    Object.defineProperty(window, 'parent', { get: function () { return window.self; }, configurable: true });
    Object.defineProperty(window, 'frameElement', { get: function () { return null; }, configurable: true });
  } catch (e) {}

  window.__VYORA_CURRENT_URL__ = CURRENT;
  window.__VYORA_CHROMIUM__ = true;

  /*
   * History guard: a <base href> points at the remote site, so a single page
   * app calling history.pushState with an absolute remote URL throws a
   * SecurityError and the whole app bootstrap dies (blank page). Drop
   * cross-origin URLs instead of throwing.
   */
  try {
    var wrapHistory = function (orig) {
      return function (state, title, url) {
        try {
          if (url != null && url !== '') {
            var resolved = null;
            try { resolved = new URL(String(url), document.baseURI || window.location.href); } catch (e) { resolved = null; }
            if (!resolved || resolved.origin !== window.location.origin) {
              url = null;
            } else {
              url = resolved.href;
            }
          }
        } catch (e) { url = null; }
        try { return orig.call(window.history, state, title, url); } catch (e) { return undefined; }
      };
    };
    window.history.pushState = wrapHistory(window.history.pushState);
    window.history.replaceState = wrapHistory(window.history.replaceState);
    try {
      History.prototype.pushState = wrapHistory(History.prototype.pushState);
      History.prototype.replaceState = wrapHistory(History.prototype.replaceState);
    } catch (e) {}
  } catch (e) {}

  /* Report the real page title + URL to the host app. */
  function syncState() {
    sendToHost({
      type: 'VYORA_PAGE_SYNC',
      url: window.__VYORA_CURRENT_URL__,
      title: document.title || window.location.hostname
    });
  }
  if (document.readyState === 'complete') syncState();
  else window.addEventListener('load', syncState);

  /* Clicks: keep navigation inside the app and unpack search redirects. */
  document.addEventListener('click', function (e) {
    var el = e.target;
    if (!el || !el.closest) return;
    var a = el.closest('a');
    if (!a) return;
    if (a.target === '_blank') a.target = '_self';
    var href = a.getAttribute('href') || '';
    if (!href || href === '#' || href.indexOf('javascript:') === 0) return;

    var absUrl = a.href || href;
    if (!absUrl) return;
    absUrl = unpackRedirect(absUrl);

    var yt = toYoutubeEmbed(absUrl);
    if (yt) absUrl = yt;

    var lower = absUrl.toLowerCase();
    if (
      lower.indexOf('.apk') >= 0 || lower.indexOf('.mp4') >= 0 || lower.indexOf('.mkv') >= 0 ||
      lower.indexOf('.zip') >= 0 || lower.indexOf('.avi') >= 0 || lower.indexOf('.webm') >= 0 ||
      lower.indexOf('.m3u8') >= 0
    ) {
      var isDownload =
        /\.apk$/.test(lower) || /\.mp4$/.test(lower) || /\.mkv$/.test(lower) ||
        /\.zip$/.test(lower) || /\.avi$/.test(lower) || /\.webm$/.test(lower);
      if (isDownload) {
        e.preventDefault();
        sendToHost({ type: 'VYORA_DOWNLOAD', url: absUrl, name: (a.innerText || '').trim() });
        return;
      }
    }

    e.preventDefault();
    proxyNav(absUrl);
  }, true);

  /* Search forms stay inside the app. */
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form) return;
    var action = form.action || window.location.href;
    var method = (form.method || 'GET').toUpperCase();
    if (method !== 'GET') return;
    e.preventDefault();
    try {
      var formData = new FormData(form);
      formData.delete('btnI');
      formData.delete('btnK');
      var params = new URLSearchParams(formData).toString();
      var sep = action.indexOf('?') >= 0 ? '&' : '?';
      proxyNav(params ? action + sep + params : action);
    } catch (err) {
      /* fall through to the normal submit */
    }
  }, true);

  /* No OS-level popup windows. */
  window.open = function (url) {
    if (url) proxyNav(url);
    return window;
  };

  /*
   * Same-origin API bridge: the page runs on the local server, so its own API
   * calls would be cross-origin and CORS-blocked. Route them back through the
   * proxy. Third-party origins are left untouched.
   */
  (function () {
    var siteHost = '';
    try { siteHost = new URL(CURRENT).hostname; } catch (e) { siteHost = ''; }

    function sameSite(host) {
      if (!host || !siteHost) return false;
      if (host === siteHost) return true;
      var yt = function (h) {
        return /(^|\.)youtube(-nocookie)?\.com$/.test(h) || /(^|\.)youtu\.be$/.test(h);
      };
      if (yt(host) && yt(siteHost)) return true;
      return host.split('.').slice(-2).join('.') === siteHost.split('.').slice(-2).join('.');
    }

    function toProxy(u) {
      if (typeof u !== 'string' || !u) return null;
      if (u.indexOf('/api/webproxy') >= 0) return null;
      if (u.indexOf('blob:') === 0 || u.indexOf('data:') === 0) return null;
      try {
        var abs = new URL(u, CURRENT);
        if (abs.origin === window.location.origin) return null;
        var isSite = sameSite(abs.hostname);
        var isCdn = /(^|\.)(gstatic\.com|ytimg\.com|ggpht\.com|googleusercontent\.com|googlevideo\.com|google\.com|youtube\.com|youtube-nocookie\.com|youtu\.be)$/.test(abs.hostname);
        if (!isSite && !isCdn) return null;
        if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return null;
        return window.location.origin + '/api/webproxy?u=' + encodeURIComponent(abs.href);
      } catch (e) {
        return null;
      }
    }

    try {
      if (window.fetch) {
        var _fetch = window.fetch;
        window.fetch = function (input, init) {
          try {
            if (typeof input === 'string') {
              var r = toProxy(input);
              if (r) input = r;
            } else if (input && input.url) {
              var r2 = toProxy(input.url);
              if (r2) input = new Request(r2, input);
            }
          } catch (e) {}
          return _fetch.call(this, input, init);
        };
      }
    } catch (e) {}

    try {
      var _open = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        try {
          var r = toProxy(url);
          if (r) url = r;
        } catch (e) {}
        var args = Array.prototype.slice.call(arguments);
        args[0] = method;
        args[1] = url;
        return _open.apply(this, args);
      };
    } catch (e) {}
  })();
})();
