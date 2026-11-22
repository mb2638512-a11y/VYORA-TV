package com.vyora.tv;

import android.app.Activity;
import android.content.pm.ActivityInfo;
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
import android.widget.Button;

import java.util.Locale;

public class MainActivity extends Activity {

    private static final String TAG = "VyoraTV";
    private static final String INDEX_URL = "file:///android_asset/index.html";

    private FrameLayout root;
    private WebView web;
    private SurfaceView surface;
    private TextView overlay;
    private Button playerExpandButton;
    private Button playerCloseButton;
    private boolean tvDevice = false;
    private boolean phonePlayerExpanded = false;
    private TvPlayer player;
    private LocalServer localServer;
    private TextToSpeech tts;
    private String defaultWebUserAgent;
    private boolean ttsReady = false;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private String startupStage = "activity creation";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
        startupStage = "window configuration";
        tvDevice = getPackageManager().hasSystemFeature("android.software.leanback");
        configureWindowForDevice();

        startupStage = "native view creation";
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

        // Native phone controls must sit above Media3's SurfaceView. WebView
        // controls are underneath that surface and cannot receive touch input.
        playerExpandButton = new Button(this);
        playerExpandButton.setText("⛶  Expand");
        playerExpandButton.setAllCaps(false);
        playerExpandButton.setTextColor(Color.WHITE);
        playerExpandButton.setTextSize(14);
        playerExpandButton.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xDD172235));
        FrameLayout.LayoutParams expandLp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        expandLp.gravity = android.view.Gravity.BOTTOM | android.view.Gravity.END;
        expandLp.setMargins(0, 0, 24, 28);
        root.addView(playerExpandButton, expandLp);
        playerExpandButton.setVisibility(View.GONE);
        playerExpandButton.setOnClickListener(v -> togglePhonePlayerOrientation());

        playerCloseButton = new Button(this);
        playerCloseButton.setText("✕");
        playerCloseButton.setAllCaps(false);
        playerCloseButton.setTextColor(Color.WHITE);
        playerCloseButton.setTextSize(18);
        playerCloseButton.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xDD172235));
        FrameLayout.LayoutParams closeLp = new FrameLayout.LayoutParams(56, 52);
        closeLp.gravity = android.view.Gravity.TOP | android.view.Gravity.END;
        closeLp.setMargins(0, 22, 16, 0);
        root.addView(playerCloseButton, closeLp);
        playerCloseButton.setVisibility(View.GONE);
        playerCloseButton.setOnClickListener(v -> stopPlayback());

        setContentView(root);

        startupStage = "media engine initialization";
        player = new TvPlayer(this, surface);
        player.setPlaybackListener(new TvPlayer.PlaybackListener() {
            @Override
            public void onFirstFrame(String url, long startupMs) {
                runOnUiThread(() -> {
                    if (web == null) return;
                    String safeUrl = org.json.JSONObject.quote(url == null ? "" : url);
                    web.evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('vyora-native-first-frame',{detail:{url:"
                                    + safeUrl + ",startupMs:" + startupMs + "}}));",
                            null);
                });
            }

            @Override
            public void onSourceFailed(String url, long elapsedMs) {
                runOnUiThread(() -> {
                    if (web == null) return;
                    String safeUrl = org.json.JSONObject.quote(url == null ? "" : url);
                    web.evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('vyora-native-source-failed',{detail:{url:"
                                    + safeUrl + ",elapsedMs:" + elapsedMs + "}}));",
                            null);
                });
            }

            @Override
            public void onAllSourcesFailed() {
                runOnUiThread(() -> {
                    if (web != null) {
                        web.evaluateJavascript(
                                "window.dispatchEvent(new Event('vyora-native-sources-failed'));",
                                null);
                    }
                });
            }
        });

        startupStage = "Android WebView initialization";
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
        s.setUserAgentString(defaultWebUserAgent + " VyoraTV/1.0 (Android) VyoraDevice/" + BuildConfig.FLAVOR.toUpperCase());

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

        startupStage = "text-to-speech initialization";
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
        startupStage = "embedded platform server initialization";
        localServer = new LocalServer(this, player);
        int port = localServer.start();
        if (port > 0) {
            web.loadUrl("http://127.0.0.1:" + port + "/index.html");
        } else {
            Log.w(TAG, "local server unavailable, falling back to bundled file");
            web.loadUrl(INDEX_URL);
        }
        startupStage = "platform loading";
        } catch (Throwable startupError) {
            Log.e(TAG, "FATAL STARTUP FAILURE at " + startupStage, startupError);
            try {
                if (localServer != null) localServer.stop();
                if (player != null) player.stop();
                if (web != null) { web.destroy(); web = null; }
            } catch (Throwable cleanupError) {
                Log.e(TAG, "startup cleanup failed", cleanupError);
            }
            TextView diagnostic = new TextView(this);
            diagnostic.setTextColor(Color.WHITE);
            diagnostic.setTextSize(15);
            diagnostic.setPadding(32, 40, 32, 40);
            diagnostic.setBackgroundColor(Color.rgb(12, 14, 22));
            String detail = startupError.getClass().getName() + ": " + String.valueOf(startupError.getMessage());
            diagnostic.setText("VYORA could not finish starting.\\n\\nStage: " + startupStage + "\\n\\n" + detail + "\\n\\nPlease send this screen to VYORA support.");
            setContentView(diagnostic);
        }
    }

    /** Keep TV immersive while allowing phone status/navigation bars and portrait layout. */
    private void configureWindowForDevice() {
        boolean tv = tvDevice;
        setRequestedOrientation(tv ? ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        getWindow().setStatusBarColor(Color.rgb(6, 7, 13));
        getWindow().setNavigationBarColor(Color.rgb(6, 7, 13));
        View decor = getWindow().getDecorView();
        if (tv) {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        } else {
            decor.setSystemUiVisibility(0);
            getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);
        }
    }

    /** Apply a real WebView User-Agent, not only a CSS viewport width. */
    public void setBrowserDisplayMode(String mode) {
        if (web == null) return;
        WebSettings settings = web.getSettings();
        if ("desktop".equalsIgnoreCase(mode)) {
            settings.setUserAgentString("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 VyoraTV/1.0 VyoraDevice/" + BuildConfig.FLAVOR.toUpperCase());
        } else if ("mobile".equalsIgnoreCase(mode)) {
            settings.setUserAgentString("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 VyoraTV/1.0 VyoraDevice/" + BuildConfig.FLAVOR.toUpperCase());
        } else {
            settings.setUserAgentString((defaultWebUserAgent == null ? WebSettings.getDefaultUserAgent(this) : defaultWebUserAgent)
                    + " VyoraTV/1.0 (Android) VyoraDevice/" + BuildConfig.FLAVOR.toUpperCase());
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
        showPhonePlayerControls();
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
            showPhonePlayerControls();
        } catch (Throwable t) {
            Log.e(TAG, "startPlaybackMulti failed", t);
        }
    }

    public void stopPlayback() {
        player.stop();
        surface.setVisibility(View.GONE);
        web.bringToFront();
        overlay.setVisibility(View.GONE);
        if (web != null) {
            web.evaluateJavascript("window.dispatchEvent(new Event('vyora-native-player-closed'));", null);
        }
        if (playerExpandButton != null) playerExpandButton.setVisibility(View.GONE);
        if (playerCloseButton != null) playerCloseButton.setVisibility(View.GONE);
        if (!tvDevice) {
            phonePlayerExpanded = false;
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        }
    }

    private void showPhonePlayerControls() {
        if (tvDevice) return;
        phonePlayerExpanded = false;
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        if (playerExpandButton != null) {
            playerExpandButton.setText("⛶  Expand");
            playerExpandButton.setVisibility(View.VISIBLE);
        }
        if (playerCloseButton != null) playerCloseButton.setVisibility(View.VISIBLE);
        if (overlay != null) overlay.bringToFront();
        if (playerExpandButton != null) playerExpandButton.bringToFront();
        if (playerCloseButton != null) playerCloseButton.bringToFront();
    }

    private void togglePhonePlayerOrientation() {
        if (tvDevice) return;
        phonePlayerExpanded = !phonePlayerExpanded;
        setRequestedOrientation(phonePlayerExpanded
                ? ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        if (playerExpandButton != null) {
            playerExpandButton.setText(phonePlayerExpanded ? "↙  Portrait" : "⛶  Expand");
            playerExpandButton.bringToFront();
        }
        if (playerCloseButton != null) playerCloseButton.bringToFront();
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
        // Deliver remote input to the focused DOM control so React handlers,
        // text fields, and TV spatial-navigation logic see the same target.
        // Enter activates focused controls explicitly because synthetic DOM
        // KeyboardEvents do not trigger the browser's native default click.
        String script = "(function(){"
                + "var key='" + key + "';"
                + "var target=document.activeElement||document.body;"
                + "if(key==='Enter'&&target&&target.matches('button:not([disabled]),a[href],[role=button],[role=tab]')){target.click();return;}"
                + "target.dispatchEvent(new KeyboardEvent('keydown',{key:key,bubbles:true,cancelable:true}));"
                + "})()";
        web.evaluateJavascript(script, null);
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
                handleBackNavigation();
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

    /**
     * Route Android phone gesture/back-button and TV remote BACK through the
     * web app first. Only finish the Activity when the web UI has no prior
     * screen to return to.
     */
    private void handleBackNavigation() {
        if (player != null && player.isActive()) {
            stopPlayback();
            dispatchKey("Escape");
            return;
        }
        if (web == null) {
            finish();
            return;
        }
        web.evaluateJavascript(
                "(function(){try{return window.__vyoraBack ? window.__vyoraBack() : 'exit';}catch(e){return 'exit';}})()",
                value -> {
                    if (value == null || !"true".equals(value.replace("\"", ""))) {
                        finish();
                    }
                });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBackNavigation();
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
