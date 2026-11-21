package com.vyora.tv;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.util.Log;
import android.view.KeyEvent;
import android.view.SurfaceView;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import java.util.Locale;

public class MainActivity extends Activity {

    private static final String TAG = "VyoraTV";
    private static final String INDEX_URL = "file:///android_asset/index.html";

    private FrameLayout root;
    private WebView web;
    private SurfaceView surface;
    private TextView overlay;
    private TvPlayer player;
    private LocalServer localServer;
    private TextToSpeech tts;
    private String defaultWebUserAgent;
    private boolean ttsReady = false;
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // native video surface (on top of the web view while playing)
        surface = new SurfaceView(this);
        surface.setVisibility(View.GONE);
        root.addView(surface, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(web);

        // native info overlay shown over the video
        overlay = new TextView(this);
        overlay.setVisibility(View.GONE);
        overlay.setTextColor(Color.WHITE);
        overlay.setTextSize(20);
        overlay.setPadding(32, 24, 32, 24);
        overlay.setBackgroundColor(0x88000000);
        FrameLayout.LayoutParams olp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        olp.gravity = android.view.Gravity.TOP;
        root.addView(overlay, olp);

        setContentView(root);

        player = new TvPlayer(this, surface);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        // Keep every navigation inside this WebView. Multiple-window support would
        // let a proxied page (or a target="_blank" link that slipped past the
        // injected click handler) spawn an OS-level browser window, which breaks
        // the self-contained Chrome-like experience.
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        defaultWebUserAgent = WebSettings.getDefaultUserAgent(this);
        s.setUserAgentString(defaultWebUserAgent + " VyoraTV/1.0 (Android TV)");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Do not intercept or cancel internal iframe, webproxy, or http/https navigations
                return false;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, "console: " + m.message() + " @" + m.lineNumber());
                return true;
            }
        });
        web.addJavascriptInterface(new TvBridge(this), "VyoraBridge");

        initTts();

        /*
         * The platform engine runs INSIDE the app.
         *
         * The bundle used to be opened from file:///android_asset/index.html.
         * Every relative /api/... URL then resolved to file:///api/... and never
         * answered: no channel logos, no web proxy (the browser could not open
         * a single site) and no downloads. The embedded server serves the same
         * bundle over http://127.0.0.1:<port> and implements the API, so the UI
         * is same-origin with the engine and everything works.
         */
        localServer = new LocalServer(this, player);
        int port = localServer.start();
        if (port > 0) {
            web.loadUrl("http://127.0.0.1:" + port + "/index.html");
        } else {
            Log.w(TAG, "local server unavailable, falling back to bundled file");
            web.loadUrl(INDEX_URL);
        }
    }

    /** Apply a real WebView User-Agent, not only a CSS viewport width. */
    public void setBrowserDisplayMode(String mode) {
        if (web == null) return;
        WebSettings settings = web.getSettings();
        if ("desktop".equalsIgnoreCase(mode)) {
            settings.setUserAgentString("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 VyoraTV/1.0");
        } else if ("mobile".equalsIgnoreCase(mode)) {
            settings.setUserAgentString("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 VyoraTV/1.0");
        } else {
            settings.setUserAgentString((defaultWebUserAgent == null ? WebSettings.getDefaultUserAgent(this) : defaultWebUserAgent)
                    + " VyoraTV/1.0 (Android TV)");
        }
    }

    private void initTts() {
        try {
            tts = new TextToSpeech(this, new TextToSpeech.OnInitListener() {
                @Override
                public void onInit(int status) {
                    ttsReady = (status == TextToSpeech.SUCCESS);
                    if (ttsReady) {
                        try {
                            tts.setLanguage(Locale.US);
                        } catch (Throwable ignored) {
                        }
                    }
                }
            });
        } catch (Throwable t) {
            Log.e(TAG, "tts init failed", t);
        }
    }

    public void speak(String text) {
        if (text == null || text.trim().isEmpty()) return;
        ui.post(new Runnable() {
            @Override
            public void run() {
                if (ttsReady && tts != null) {
                    try {
                        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "vyora-ad");
                    } catch (Throwable ignored) {
                    }
                }
            }
        });
    }

    /* ---------------- playback ---------------- */

    public void startPlayback(String url, String referer, String ua, String title, String logo) {
        surface.setVisibility(View.VISIBLE);
        surface.bringToFront();
        player.play(url, referer, ua);
        showOverlay(title, referer);
    }

    /**
     * Turbo start with several sources: the native player races them and
     * shows the first one that works (no 20 second black screen).
     */
    public void startPlaybackMulti(String candidatesJson, String title, String logo) {
        try {
            org.json.JSONArray arr = new org.json.JSONArray(candidatesJson);
            int n = arr.length();
            String[] urls = new String[n];
            String[] referers = new String[n];
            String[] uas = new String[n];
            for (int i = 0; i < n; i++) {
                org.json.JSONObject o = arr.getJSONObject(i);
                urls[i] = o.optString("url", "");
                referers[i] = o.optString("referer", "");
                uas[i] = o.optString("ua", "");
            }
            surface.setVisibility(View.VISIBLE);
            surface.bringToFront();
            player.play(urls, referers, uas);
            showOverlay(title, "");
        } catch (Throwable t) {
            Log.e(TAG, "startPlaybackMulti failed", t);
        }
    }

    public void stopPlayback() {
        player.stop();
        surface.setVisibility(View.GONE);
        web.bringToFront();
        overlay.setVisibility(View.GONE);
    }

    /** Base URL of the embedded engine (used to resolve relative app URLs). */
    public String localBaseUrl() {
        int p = localServer != null ? localServer.getPort() : -1;
        return p > 0 ? ("http://127.0.0.1:" + p) : "http://127.0.0.1:8787";
    }

    private void showOverlay(String title, String detail) {
        String text = title == null ? "" : title;
        if (detail != null && !detail.isEmpty()) {
            text = text + "\n" + detail;
        }
        text = text + "\n" + getString(R.string.player_hint);
        overlay.setText(text);
        overlay.setVisibility(View.VISIBLE);
        overlay.bringToFront();
        ui.removeCallbacks(hideOverlay);
        ui.postDelayed(hideOverlay, 5000);
    }

    private final Runnable hideOverlay = new Runnable() {
        @Override
        public void run() {
            if (player != null && player.isActive()) {
                overlay.setVisibility(View.GONE);
            }
        }
    };

    public void setPlayerVolume(float v) {
        player.setVolume(Math.max(0f, Math.min(1f, v)));
    }

    public float getPlayerVolume() {
        return player.getVolume();
    }

    public void toggleMute() {
        float v = player.getVolume();
        setPlayerVolume(v <= 0.01f ? 1f : 0f);
    }

    /* ---------------- remote keys ---------------- */

    private void dispatchKey(String key) {
        web.evaluateJavascript(
                "window.dispatchEvent(new KeyboardEvent('keydown',{key:'" + key + "',bubbles:true}));",
                null);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_CHANNEL_UP:
            case KeyEvent.KEYCODE_DPAD_UP:
                dispatchKey(event.getKeyCode() == KeyEvent.KEYCODE_CHANNEL_UP ? "ChannelUp" : "ArrowUp");
                return true;
            case KeyEvent.KEYCODE_CHANNEL_DOWN:
            case KeyEvent.KEYCODE_DPAD_DOWN:
                dispatchKey(event.getKeyCode() == KeyEvent.KEYCODE_CHANNEL_DOWN ? "ChannelDown" : "ArrowDown");
                return true;
            case KeyEvent.KEYCODE_DPAD_LEFT:
                dispatchKey("ArrowLeft");
                return true;
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                dispatchKey("ArrowRight");
                return true;
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
                dispatchKey("Enter");
                return true;
            case KeyEvent.KEYCODE_BACK:
                if (player != null && player.isActive()) {
                    stopPlayback();
                    // let the web UI close its player overlay too
                    dispatchKey("Escape");
                    return true;
                }
                // let the web layer decide; exit only if it does not handle it
                web.evaluateJavascript(
                        "(function(){try{return window.__vyoraBack ? window.__vyoraBack() : 'exit';}catch(e){return 'exit';}})()",
                        value -> {
                            if (value == null || !"true".equals(value.replace("\"", ""))) {
                                finish();
                            }
                        });
                return true;
            case KeyEvent.KEYCODE_VOLUME_UP:
                setPlayerVolume(getPlayerVolume() + 0.1f);
                return true;
            case KeyEvent.KEYCODE_VOLUME_DOWN:
                setPlayerVolume(getPlayerVolume() - 0.1f);
                return true;
            case KeyEvent.KEYCODE_MUTE:
                toggleMute();
                return true;
            default:
                return super.onKeyDown(keyCode, event);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
        if (player != null) player.pause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (player != null) player.stop();
        if (localServer != null) localServer.stop();
        if (tts != null) {
            try {
                tts.stop();
                tts.shutdown();
            } catch (Throwable ignored) {
            }
        }
        if (web != null) {
            web.removeJavascriptInterface("VyoraBridge");
            web.destroy();
        }
        super.onDestroy();
    }
}
