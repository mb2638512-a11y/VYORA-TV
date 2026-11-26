package com.vyora.tv;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.os.Handler;
import android.os.Environment;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.SafeBrowsingResponse;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebStorage;
import android.webkit.WebViewClient;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import android.widget.ArrayAdapter;
import android.widget.AutoCompleteTextView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.Locale;

/**
 * Native Android browser surface. Pages run in Android System WebView directly,
 * not in a nested iframe, so normal navigation, cookies, forms and site scripts
 * use the platform browser engine.
 */
public class BrowserActivity extends Activity {
    private static final String PREFS = "vyora_native_browser_v1";
    private static final int MAX_TABS = 20;
    // Orbit-style memory policy: keep only the selected tab and its OAuth opener live.
    private static final int MAX_LIVE_WEBVIEWS = 2;
    private static final int BG = Color.rgb(10, 14, 26);
    private static final int BAR = Color.rgb(18, 25, 43);
    private static final int FG = Color.rgb(238, 242, 255);
    private static final int MUTED = Color.rgb(155, 169, 198);
    private static final int ACCENT = Color.rgb(87, 150, 255);

    private static class Engine {
        String id, name, category, template, home;
        boolean requiresAuth;
        Engine(String id, String name, String category, String template, boolean auth) {
            this.id=id; this.name=name; this.category=category; this.template=template; this.requiresAuth=auth;
            Uri u=Uri.parse(template);
            this.home=(u.getScheme()==null?"https":u.getScheme())+"://"+u.getHost()+"/";
        }
    }
    private static class BrowserTab {
        String id, title, url, engineId;
        WebView web;
        Bundle savedState;
        BrowserTab opener;
        long navigationToken;
        Runnable loadTimeout;
        BrowserTab(String id, String engineId) {
            this.id=id; this.engineId=engineId; this.title="New tab"; this.url="";
        }
    }

    private final ArrayList<Engine> engines = new ArrayList<>();
    private final ArrayList<BrowserTab> tabs = new ArrayList<>();
    private LinearLayout root, tabStrip;
    private FrameLayout webFrame;
    private AutoCompleteTextView enginePicker;
    private EditText address;
    private Button backButton, forwardButton, reloadButton, homeButton, goButton, addButton, closeButton, privateButton, protectionButton;
    private ProgressBar progress;
    private SharedPreferences prefs;
    private BrowserHostBlocker hostBlocker;
    private final Handler mainHandler = new Handler();
    private int activeIndex = 0;
    private boolean tv = false;
    private String initialMode = "auto";
    private boolean standaloneMode = false;
    private View fullscreenCustomView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private int savedSystemUiVisibility;
    private int savedRequestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;

    private void enterImmersiveMode() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    private void showFullscreenCustomView(View view, WebChromeClient.CustomViewCallback callback) {
        if (view == null) return;
        if (fullscreenCustomView != null) { hideFullscreenCustomView(); return; }
        fullscreenCustomView = view;
        fullscreenCallback = callback;
        savedSystemUiVisibility = getWindow().getDecorView().getSystemUiVisibility();
        savedRequestedOrientation = getRequestedOrientation();
        ViewGroup decor = (ViewGroup) getWindow().getDecorView();
        decor.addView(view, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (!tv) setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        enterImmersiveMode();
        view.setFocusable(true);
        view.setFocusableInTouchMode(true);
        view.requestFocus();
    }

    private void hideFullscreenCustomView() {
        if (fullscreenCustomView == null) return;
        View view = fullscreenCustomView;
        fullscreenCustomView = null;
        ViewParent parent = view.getParent();
        if (parent instanceof ViewGroup) ((ViewGroup) parent).removeView(view);
        if (fullscreenCallback != null) {
            WebChromeClient.CustomViewCallback callback = fullscreenCallback;
            fullscreenCallback = null;
            callback.onCustomViewHidden();
        }
        getWindow().getDecorView().setSystemUiVisibility(savedSystemUiVisibility);
        setRequestedOrientation(savedRequestedOrientation);
    }

    private int dp(float value) { return (int)(value * getResources().getDisplayMetrics().density + 0.5f); }
    private int controlHeight() { return dp(tv ? 54 : 44); }
    private int textSize() { return tv ? 18 : 14; }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (isPrivateSession() && Build.VERSION.SDK_INT < 28) {
            Toast.makeText(this,"Private browsing requires Android 9 or newer for isolated storage.",Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        tv = getPackageManager().hasSystemFeature("android.software.leanback");
        if (tv) setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
        prefs = getSharedPreferences(isPrivateSession() ? PREFS + "_private" : PREFS, MODE_PRIVATE);
        hostBlocker = BrowserHostBlocker.get(this);
        hostBlocker.start();
        initialMode = getIntent().getStringExtra("displayMode");
        if (initialMode == null) initialMode = "auto";
        standaloneMode = getIntent().getBooleanExtra("standaloneMode", false);
        if (standaloneMode) enterImmersiveMode();
        loadEngines();
        buildLayout();
        prepareBrowserSession(() -> restoreOrCreateSession(getIntent().getStringExtra("initialUrl"),
                getIntent().getStringExtra("engineId")));
    }

    private void loadEngines() {
        try {
            InputStream in = getAssets().open("browser-search-engines.json");
            BufferedReader reader = new BufferedReader(new InputStreamReader(in, "UTF-8"));
            StringBuilder raw = new StringBuilder(); String line;
            while ((line=reader.readLine())!=null) raw.append(line);
            reader.close();
            JSONArray list = new JSONObject(raw.toString()).optJSONArray("engines");
            if (list != null) for (int i=0;i<list.length();i++) {
                JSONObject item=list.optJSONObject(i); if(item==null) continue;
                String id=item.optString("id"), name=item.optString("name"), template=item.optString("template");
                if(id.isEmpty() || name.isEmpty() || !template.startsWith("https://")) continue;
                engines.add(new Engine(id,name,item.optString("category","web"),template,item.optBoolean("requiresAuth",false)));
            }
        } catch (Throwable ignored) { }
        boolean hasBrave=false;
        for(Engine e:engines) if("brave".equals(e.id)) hasBrave=true;
        if(!hasBrave) engines.add(new Engine("brave","Brave Search","web","https://search.brave.com/search?q=",false));
        if(engines.isEmpty()) engines.add(new Engine("google0","Google","web","https://www.google.com/search?q=",false));
    }

    private Engine engine(String id) {
        if(id!=null) for(Engine e:engines) if(e.id.equals(id)) return e;
        for(Engine e:engines) if("google0".equals(e.id)) return e;
        return engines.get(0);
    }

    private void buildLayout() {
        root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(BG);
        LinearLayout toolbar = new LinearLayout(this); toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setGravity(Gravity.CENTER_VERTICAL); toolbar.setPadding(dp(6),dp(5),dp(6),dp(5)); toolbar.setBackgroundColor(BAR);
        backButton=button("‹","Back"); forwardButton=button("›","Forward"); reloadButton=button("↻","Reload"); homeButton=button("⌂","Home");
        toolbar.addView(backButton, new LinearLayout.LayoutParams(controlHeight(),controlHeight()));
        toolbar.addView(forwardButton, new LinearLayout.LayoutParams(controlHeight(),controlHeight()));
        toolbar.addView(reloadButton, new LinearLayout.LayoutParams(controlHeight(),controlHeight()));
        toolbar.addView(homeButton, new LinearLayout.LayoutParams(controlHeight(),controlHeight()));
        address=new EditText(this); address.setSingleLine(true); address.setTextColor(FG); address.setHintTextColor(MUTED);
        address.setHint("Search or enter website address"); address.setTextSize(textSize()); address.setSelectAllOnFocus(true);
        address.setImeOptions(EditorInfo.IME_ACTION_GO); address.setPadding(dp(10),0,dp(10),0);
        address.setBackgroundColor(Color.rgb(30,40,62));
        toolbar.addView(address,new LinearLayout.LayoutParams(0,controlHeight(),1f));
        goButton=button("Go","Go to address");
        toolbar.addView(goButton,new LinearLayout.LayoutParams(dp(tv?64:48),controlHeight()));
        if (!standaloneMode) root.addView(toolbar,new LinearLayout.LayoutParams(-1,-2));

        LinearLayout second = new LinearLayout(this); second.setOrientation(LinearLayout.HORIZONTAL);
        second.setGravity(Gravity.CENTER_VERTICAL); second.setPadding(dp(7),dp(4),dp(7),dp(4)); second.setBackgroundColor(BAR);
        enginePicker=new AutoCompleteTextView(this); enginePicker.setSingleLine(true); enginePicker.setTextSize(textSize());
        enginePicker.setTextColor(FG); enginePicker.setHintTextColor(MUTED); enginePicker.setHint("Search provider");
        enginePicker.setThreshold(0); enginePicker.setDropDownHeight(dp(440));
        ArrayList<String> names=new ArrayList<>(); for(Engine e:engines) names.add(e.name+(e.requiresAuth?" • account":""));
        ArrayAdapter<String> adapter=new ArrayAdapter<>(this,android.R.layout.simple_dropdown_item_1line,names);
        enginePicker.setAdapter(adapter);
        second.addView(enginePicker,new LinearLayout.LayoutParams(dp(tv?260:155),controlHeight()));
        HorizontalScrollView tabsScroll=new HorizontalScrollView(this); tabsScroll.setHorizontalScrollBarEnabled(false);
        tabStrip=new LinearLayout(this); tabStrip.setOrientation(LinearLayout.HORIZONTAL); tabStrip.setGravity(Gravity.CENTER_VERTICAL);
        tabsScroll.addView(tabStrip);
        second.addView(tabsScroll,new LinearLayout.LayoutParams(0,controlHeight(),1f));
        addButton=button("+","New tab"); closeButton=button("×","Close tab");
        privateButton=button(isPrivateSession()?"Exit private":"Private",isPrivateSession()?"Exit private browsing":"Open isolated private browsing");
        protectionButton=button("Shield on","Allow or protect this site; long press for global protection");
        second.addView(addButton,new LinearLayout.LayoutParams(controlHeight(),controlHeight()));
        second.addView(closeButton,new LinearLayout.LayoutParams(controlHeight(),controlHeight()));
        second.addView(protectionButton,new LinearLayout.LayoutParams(dp(tv?120:88),controlHeight()));
        second.addView(privateButton,new LinearLayout.LayoutParams(dp(tv?116:84),controlHeight()));
        if (!standaloneMode) root.addView(second,new LinearLayout.LayoutParams(-1,-2));

        progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100); progress.setProgressTintList(android.content.res.ColorStateList.valueOf(ACCENT));
        if (!standaloneMode) root.addView(progress,new LinearLayout.LayoutParams(-1,dp(3)));
        webFrame=new FrameLayout(this); webFrame.setBackgroundColor(Color.WHITE);
        root.addView(webFrame,new LinearLayout.LayoutParams(-1,0,1f));
        setContentView(root);

        backButton.setOnClickListener(v -> { WebView web=activeWebView(); if(web!=null && web.canGoBack()) web.goBack(); });
        forwardButton.setOnClickListener(v -> { WebView web=activeWebView(); if(web!=null && web.canGoForward()) web.goForward(); });
        reloadButton.setOnClickListener(v -> reloadActiveTab());
        homeButton.setOnClickListener(v -> { BrowserTab tab=current(); if(tab!=null) ensureWebView(tab).loadUrl(engine(tab.engineId).home); });
        goButton.setOnClickListener(v -> navigateFromAddress());
        address.setOnEditorActionListener((v,action,event)-> {
            if(action==EditorInfo.IME_ACTION_GO || action==EditorInfo.IME_ACTION_DONE ||
                    (event!=null && event.getKeyCode()==KeyEvent.KEYCODE_ENTER)) { navigateFromAddress(); return true; }
            return false;
        });
        addButton.setOnClickListener(v -> addTab(null,null));
        closeButton.setOnClickListener(v -> closeCurrentTab());
        protectionButton.setOnClickListener(v -> {
            String host = activeHost();
            if (host == null) { Toast.makeText(this,"Open a website first to change its protection.",Toast.LENGTH_SHORT).show(); return; }
            boolean allow = !hostBlocker.isAllowed(host);
            hostBlocker.setAllowed(host, allow);
            updateProtectionButton();
            Toast.makeText(this,allow?"Protection paused for "+host:"Protection restored for "+host,Toast.LENGTH_SHORT).show();
        });
        protectionButton.setOnLongClickListener(v -> {
            hostBlocker.setEnabled(!hostBlocker.isEnabled());
            updateProtectionButton();
            Toast.makeText(this,hostBlocker.isEnabled()?"Ad and tracker protection enabled":"Ad and tracker protection disabled",Toast.LENGTH_SHORT).show();
            return true;
        });
        privateButton.setOnClickListener(v -> {
            if (isPrivateSession()) { finish(); return; }
            if (Build.VERSION.SDK_INT < 28) {
                Toast.makeText(this,"Private browsing needs Android 9 or newer for isolated storage.",Toast.LENGTH_LONG).show();
                return;
            }
            Intent intent = new Intent(this, PrivateBrowserActivity.class);
            BrowserTab active = current();
            if (active != null && active.url != null && !active.url.isEmpty()) intent.putExtra("initialUrl", active.url);
            if (active != null) intent.putExtra("engineId", active.engineId);
            startActivity(intent);
        });
        enginePicker.setOnItemClickListener((parent,view,position,id)-> {
            if(position>=0 && position<engines.size()) selectEngine(engines.get(position).id);
        });
        enginePicker.setOnClickListener(v -> enginePicker.showDropDown());
        enginePicker.setOnLongClickListener(v -> { Toast.makeText(this,"Choose a provider for this tab; new tabs use it by default.",Toast.LENGTH_LONG).show(); return true; });
    }

    private Button button(String label,String description) {
        Button b=new Button(this); b.setText(label); b.setTextColor(FG); b.setTextSize(tv?22:18);
        b.setAllCaps(false); b.setPadding(dp(4),0,dp(4),0); b.setContentDescription(description);
        b.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(38,52,79)));
        b.setFocusable(true); return b;
    }

    protected boolean isPrivateSession() { return false; }

    protected void prepareBrowserSession(Runnable continuation) { continuation.run(); }

    private void restoreOrCreateSession(String initialUrl,String requestedEngine) {
        boolean restored=false;
        if(!isPrivateSession() && (initialUrl==null || initialUrl.trim().isEmpty())) {
            try {
                JSONArray saved=new JSONArray(prefs.getString("tabs","[]"));
                int wanted=prefs.getInt("active",0);
                for(int i=0;i<saved.length() && i<MAX_TABS;i++) {
                    JSONObject item=saved.optJSONObject(i); if(item==null) continue;
                    String engineId=item.optString("engine",prefs.getString("defaultEngine","google0"));
                    BrowserTab tab=createTab(engineId);
                    tab.title=item.optString("title","New tab");
                    tab.url=item.optString("url","");
                    tabs.add(tab);
                }
                if(!tabs.isEmpty()) { activeIndex=Math.max(0,Math.min(wanted,tabs.size()-1)); restored=true; }
            } catch(Throwable ignored) { }
        }
        if(!restored) addTab(requestedEngine,initialUrl);
        else { showActiveTab(); updateTabs(); }
    }

    private BrowserTab createTab(String engineId) {
        // Background tabs are metadata until selected; do not allocate a renderer for each.
        return new BrowserTab("tab-"+System.nanoTime(),engine(engineId).id);
    }

    private WebView ensureWebView(BrowserTab tab) {
        if(tab.web!=null) return tab.web;
        WebView web=new WebView(this);
        tab.web=web;
        configureWebView(tab);
        boolean restored=false;
        if(tab.savedState!=null) {
            try { restored=web.restoreState(tab.savedState)!=null; } catch(Throwable ignored) { }
            tab.savedState=null;
        }
        if(!restored && tab.url!=null && !tab.url.isEmpty()) web.loadUrl(tab.url);
        return web;
    }

    private void cancelLoadTimeout(BrowserTab tab) {
        if (tab == null) return;
        tab.navigationToken++;
        if (tab.loadTimeout != null) {
            mainHandler.removeCallbacks(tab.loadTimeout);
            tab.loadTimeout = null;
        }
    }

    private void scheduleLoadTimeout(BrowserTab tab, WebView view) {
        cancelLoadTimeout(tab);
        final long token = tab.navigationToken;
        tab.loadTimeout = () -> {
            if (tab.navigationToken != token || tab.web != view) return;
            tab.loadTimeout = null;
            view.stopLoading();
            if (current() == tab) {
                progress.setVisibility(View.GONE);
                Toast.makeText(BrowserActivity.this,"This page took too long to respond. Loading stopped; tap reload to try again.",Toast.LENGTH_LONG).show();
                updateControls();
            }
        };
        mainHandler.postDelayed(tab.loadTimeout, 45000L);
    }

    private void suspendTab(BrowserTab tab) {
        if(tab==null || tab.web==null) return;
        cancelLoadTimeout(tab);
        WebView web=tab.web;
        try {
            Bundle state=new Bundle();
            web.saveState(state);
            tab.savedState=state;
            String currentUrl=web.getUrl(); if(currentUrl!=null) tab.url=currentUrl;
            String title=web.getTitle(); if(title!=null && !title.trim().isEmpty()) tab.title=title.trim();
        } catch(Throwable ignored) { }
        try {
            if(web.getParent() instanceof ViewGroup) ((ViewGroup)web.getParent()).removeView(web);
            web.stopLoading();
            web.onPause();
            web.destroy();
        } catch(Throwable ignored) { }
        tab.web=null;
    }

    private void enforceLiveWebViewBudget() {
        BrowserTab active=current();
        BrowserTab opener=active==null?null:active.opener;
        for(BrowserTab tab:tabs) {
            if(tab!=active && tab!=opener && tab.web!=null) suspendTab(tab);
        }
    }

    private void configureWebView(BrowserTab tab) {
        WebSettings s=tab.web.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setDatabaseEnabled(true);
        s.setSupportZoom(true); s.setBuiltInZoomControls(true); s.setDisplayZoomControls(false);
        s.setLoadsImagesAutomatically(true); s.setMediaPlaybackRequiresUserGesture(true);
        s.setJavaScriptCanOpenWindowsAutomatically(false); s.setSupportMultipleWindows(true);
        s.setAllowFileAccess(false); s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        if(Build.VERSION.SDK_INT>=26) s.setSafeBrowsingEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(tab.web,true);
        tab.web.setBackgroundColor(Color.WHITE);
        tab.web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                // Only block known ad/tracker hosts on subresources. Never block the
                // top-level page, so a stale list cannot make a destination unopenable.
                if (!request.isForMainFrame() && hostBlocker != null
                        && hostBlocker.shouldBlock(request.getUrl().getHost())) {
                    return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
                }
                return super.shouldInterceptRequest(view, request);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri=request.getUrl(); String scheme=uri.getScheme()==null?"":uri.getScheme().toLowerCase(Locale.ROOT);
                if("http".equals(scheme)||"https".equals(scheme)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW,uri)); } catch(Throwable ignored) { }
                return true;
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon) {
                tab.url=url; scheduleLoadTimeout(tab, view);
                if(current()==tab) { address.setText(url); progress.setVisibility(View.VISIBLE); progress.setProgress(5); }
                updateTabs();
            }
            @Override public void onPageFinished(WebView view,String url) {
                cancelLoadTimeout(tab);
                tab.url=url; String title=view.getTitle(); if(title!=null && !title.trim().isEmpty()) tab.title=title.trim();
                if(current()==tab) { address.setText(url); progress.setVisibility(View.GONE); updateControls(); updateProtectionButton(); }
                updateTabs(); saveSession();
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (Build.VERSION.SDK_INT >= 23 && request.isForMainFrame()) cancelLoadTimeout(tab);
                if (Build.VERSION.SDK_INT >= 23 && request.isForMainFrame() && current()==tab) {
                    progress.setVisibility(View.GONE);
                    Toast.makeText(BrowserActivity.this,"Page could not load. Check your connection, then tap reload.",Toast.LENGTH_LONG).show();
                }
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                cancelLoadTimeout(tab);
                // A crashed/evicted Chromium renderer must not take down the app.
                try { if(view.getParent() instanceof ViewGroup) ((ViewGroup)view.getParent()).removeView(view); } catch(Throwable ignored) { }
                try { view.destroy(); } catch(Throwable ignored) { }
                if(tab.web==view) tab.web=null;
                tab.savedState=null; // Renderer state is no longer trustworthy; reload the last URL on demand.
                if(current()==tab) {
                    progress.setVisibility(View.GONE);
                    updateControls();
                    Toast.makeText(BrowserActivity.this,"This tab was stopped to recover memory. Tap reload to reopen it.",Toast.LENGTH_LONG).show();
                }
                return true;
            }
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError error) {
                handler.cancel();
                if(current()==tab) Toast.makeText(BrowserActivity.this,"Secure connection failed. The page was blocked.",Toast.LENGTH_LONG).show();
            }
        });
        tab.web.setWebChromeClient(new WebChromeClient() {
            @Override public void onShowCustomView(View view, CustomViewCallback callback) { showFullscreenCustomView(view, callback); }
            @Override public void onHideCustomView() { hideFullscreenCustomView(); }
            @Override public void onProgressChanged(WebView view,int value) {
                if(current()==tab) { progress.setProgress(value); progress.setVisibility(value>=100?View.GONE:View.VISIBLE); }
            }
            @Override public void onReceivedTitle(WebView view,String title) {
                if(title!=null && !title.trim().isEmpty()) tab.title=title.trim();
                updateTabs();
            }
            @Override public boolean onCreateWindow(WebView view, boolean isDialog,
                                                    boolean isUserGesture, Message resultMsg) {
                // Allow user-initiated OAuth/sign-in and target=_blank windows.
                // Scripted background popups stay blocked to avoid ad spam.
                if (!isUserGesture || resultMsg == null || tabs.size() >= MAX_TABS) return false;
                // WebView supplies a WebViewTransport in Message.obj. Validate it
                // before creating a tab so malformed/unsupported popup requests
                // cannot crash the whole browser activity.
                if (!(resultMsg.obj instanceof WebView.WebViewTransport)) return false;
                BrowserTab popup = null;
                try {
                    popup = createTab(tab.engineId);
                    popup.opener = tab; // Keep OAuth window.opener alive while the child is active.
                    WebView popupWeb = ensureWebView(popup);
                    WebView.WebViewTransport transport =
                            (WebView.WebViewTransport) resultMsg.obj;
                    transport.setWebView(popupWeb);
                    // Complete the hand-off before switching the visible tab.
                    resultMsg.sendToTarget();
                    tabs.add(popup);
                    activeIndex = tabs.size() - 1;
                    showActiveTab();
                    updateTabs();
                    saveSession();
                    return true;
                } catch (Throwable error) {
                    if (popup != null && popup.web != null) {
                        try { popup.web.stopLoading(); popup.web.destroy(); } catch (Throwable ignored) { }
                        popup.web = null;
                    }
                    return false;
                }
            }
        });
        tab.web.setDownloadListener((url,userAgent,contentDisposition,mimeType,contentLength)->download(url,userAgent,contentDisposition,mimeType));
    }

    private void download(String url,String userAgent,String disposition,String mimeType) {
        try {
            DownloadManager.Request request=new DownloadManager.Request(Uri.parse(url));
            String cookie=CookieManager.getInstance().getCookie(url);
            if(cookie!=null) request.addRequestHeader("Cookie",cookie);
            if(userAgent!=null) request.addRequestHeader("User-Agent",userAgent);
            request.setMimeType(mimeType);
            request.setTitle(android.webkit.URLUtil.guessFileName(url,disposition,mimeType));
            request.setDescription("Downloading with VYORA Browser");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,
                    android.webkit.URLUtil.guessFileName(url,disposition,mimeType));
            ((DownloadManager)getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
            Toast.makeText(this,"Download started",Toast.LENGTH_SHORT).show();
        } catch(Throwable error) {
            Toast.makeText(this,"Could not start this download",Toast.LENGTH_LONG).show();
        }
    }

    private void addTab(String engineId,String url) {
        if(tabs.size()>=MAX_TABS) { Toast.makeText(this,"Maximum 20 tabs reached",Toast.LENGTH_SHORT).show(); return; }
        String selected=engine(engineId==null?prefs.getString("defaultEngine","google0"):engineId).id;
        BrowserTab tab=createTab(selected); tabs.add(tab); activeIndex=tabs.size()-1;
        showActiveTab(); updateTabs();
        WebView web=ensureWebView(tab);
        if(url!=null && !url.trim().isEmpty()) web.loadUrl(normalizeAddress(url,selected));
        else web.loadUrl(engine(selected).home);
        saveSession();
    }

    private void selectEngine(String id) {
        BrowserTab tab=current(); if(tab==null) return;
        Engine chosen=engine(id); tab.engineId=chosen.id;
        prefs.edit().putString("defaultEngine",chosen.id).apply();
        enginePicker.setText(chosen.name,false);
        updateTabs();
        Toast.makeText(this,chosen.name+" selected for this tab and new tabs",Toast.LENGTH_SHORT).show();
        saveSession();
    }

    private String normalizeAddress(String raw,String engineId) {
        String value=raw==null?"":raw.trim(); if(value.isEmpty()) return engine(engineId).home;
        if(value.matches("(?i)^https?://.*")) return value;
        if(!value.contains(" ") && value.matches("(?i)^[a-z0-9.-]+(?::[0-9]+)?(?:/.*)?$") && value.contains(".")) return "https://"+value;
        try {
            if("google0".equals(engineId)) return "https://www.google.com/search?igu=1&q="+URLEncoder.encode(value,"UTF-8");
            return engine(engineId).template+URLEncoder.encode(value,"UTF-8");
        } catch(Throwable ignored) { return engine(engineId).home; }
    }

    private void navigateFromAddress() {
        BrowserTab tab=current(); if(tab==null) return;
        String target=normalizeAddress(address.getText().toString(),tab.engineId);
        if(target.isEmpty()) return;
        ensureWebView(tab).loadUrl(target);
        address.clearFocus();
        android.view.inputmethod.InputMethodManager imm=(android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE);
        if(imm!=null) imm.hideSoftInputFromWindow(address.getWindowToken(),0);
    }

    private BrowserTab current() { return tabs.isEmpty()?null:tabs.get(Math.max(0,Math.min(activeIndex,tabs.size()-1))); }

    private WebView activeWebView() { BrowserTab tab=current(); return tab==null?null:tab.web; }

    private void reloadActiveTab() {
        BrowserTab tab=current(); if(tab==null) return;
        if (tab.web != null && tab.web.getUrl() != null) { tab.web.reload(); return; }
        WebView web=ensureWebView(tab);
        if(tab.url!=null && !tab.url.isEmpty()) web.loadUrl(tab.url);
        else web.loadUrl(engine(tab.engineId).home);
    }

    private void showActiveTab() {
        BrowserTab tab=current(); if(tab==null) return;
        WebView activeWeb=ensureWebView(tab);
        if(activeWeb.getParent()!=null) ((ViewGroup)activeWeb.getParent()).removeView(activeWeb);
        webFrame.removeAllViews(); webFrame.addView(activeWeb,new FrameLayout.LayoutParams(-1,-1));
        enforceLiveWebViewBudget();
        address.setText(tab.url==null?"":tab.url);
        enginePicker.setText(engine(tab.engineId).name,false);
        updateControls();
        updateProtectionButton();
        // Persist the suspended tab URLs/history metadata after every tab switch.
        saveSession();
    }

    private String activeHost() {
        BrowserTab tab=current();
        if(tab==null || tab.url==null || tab.url.isEmpty()) return null;
        try { return Uri.parse(tab.url).getHost(); } catch(Throwable ignored) { return null; }
    }

    private void updateProtectionButton() {
        if(protectionButton==null || hostBlocker==null) return;
        String host=activeHost();
        boolean enabled=hostBlocker.isEnabled();
        boolean allowed=host!=null && hostBlocker.isAllowed(host);
        String label=!enabled?"Shield off":(allowed?"Site allowed":"Shield on");
        protectionButton.setText(label);
        protectionButton.setContentDescription(label+". Tap to toggle this site's allowlist; long press to toggle global protection.");
    }

    private void updateControls() {
        BrowserTab tab=current(); if(tab==null) return;
        WebView web=tab.web;
        backButton.setEnabled(web!=null && web.canGoBack()); forwardButton.setEnabled(web!=null && web.canGoForward());
        backButton.setAlpha(web!=null && web.canGoBack()?1f:0.45f); forwardButton.setAlpha(web!=null && web.canGoForward()?1f:0.45f);
    }

    private void updateTabs() {
        if(tabStrip==null) return;
        tabStrip.removeAllViews();
        for(int i=0;i<tabs.size();i++) {
            final int index=i; BrowserTab tab=tabs.get(i);
            TextView item=new TextView(this);
            String title=tab.title==null?"New tab":tab.title.replaceAll("\\s+"," ").trim();
            if(title.length()>18) title=title.substring(0,17)+"…";
            item.setText((i+1)+" · "+(title.isEmpty()?"New tab":title));
            item.setTextSize(textSize()); item.setTextColor(FG); item.setGravity(Gravity.CENTER);
            item.setPadding(dp(14),0,dp(14),0); item.setMinHeight(controlHeight());
            item.setBackgroundColor(i==activeIndex?Color.rgb(42,67,105):Color.rgb(26,36,58));
            item.setFocusable(true); item.setOnClickListener(v->{activeIndex=index;showActiveTab();updateTabs();});
            item.setOnLongClickListener(v->{if(tabs.size()>1) closeTabAt(index); else Toast.makeText(this,"Use × to close the current tab",Toast.LENGTH_SHORT).show();return true;});
            LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-2,controlHeight()); lp.setMargins(dp(3),0,dp(3),0); tabStrip.addView(item,lp);
        }
    }

    private void closeCurrentTab() { if(!tabs.isEmpty()) closeTabAt(activeIndex); }
    private void closeTabAt(int index) {
        if(index<0||index>=tabs.size()) return;
        BrowserTab removed=tabs.remove(index);
        cancelLoadTimeout(removed);
        // Do not leave a popup holding a detached OAuth opener (and its renderer) alive.
        for(BrowserTab tab:tabs) if(tab.opener==removed) tab.opener=null;
        if(removed.web!=null) { webFrame.removeView(removed.web); removed.web.stopLoading(); removed.web.destroy(); removed.web=null; }
        if(tabs.isEmpty()) { activeIndex=0; addTab(null,null); return; }
        activeIndex=Math.min(activeIndex,tabs.size()-1);
        showActiveTab(); updateTabs(); saveSession();
    }

    private void saveSession() {
        if (isPrivateSession()) return; // Private tabs never enter persisted browsing history.
        try {
            JSONArray arr=new JSONArray();
            for(BrowserTab tab:tabs) {
                if(tab.web!=null) {
                    String liveUrl=tab.web.getUrl(); if(liveUrl!=null) tab.url=liveUrl;
                    String liveTitle=tab.web.getTitle(); if(liveTitle!=null && !liveTitle.trim().isEmpty()) tab.title=liveTitle.trim();
                }
                JSONObject item=new JSONObject(); item.put("title",tab.title); item.put("url",tab.url); item.put("engine",tab.engineId); arr.put(item);
            }
            prefs.edit().putString("tabs",arr.toString()).putInt("active",activeIndex).apply();
        } catch(Throwable ignored) { }
    }

    @Override protected void onPause() { saveSession(); for(BrowserTab t:tabs) if(t.web!=null) t.web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); for(BrowserTab t:tabs) if(t.web!=null) t.web.onResume(); }
    @Override public void onBackPressed() {
        if (fullscreenCustomView != null) { hideFullscreenCustomView(); return; }
        BrowserTab tab=current();
        if(tab!=null && tab.web!=null && tab.web.canGoBack()) { tab.web.goBack(); return; }
        if(tabs.size()>1) { closeCurrentTab(); return; }
        super.onBackPressed();
    }
    protected void clearPrivateBrowsingData() {
        for (BrowserTab tab : tabs) {
            if (tab.web != null) {
                try { tab.web.stopLoading(); tab.web.clearCache(true); tab.web.clearHistory(); tab.web.clearFormData(); } catch (Throwable ignored) { }
            }
        }
        try {
            CookieManager cookies = CookieManager.getInstance();
            cookies.removeAllCookies(value -> cookies.flush());
        } catch (Throwable ignored) { }
        try { WebStorage.getInstance().deleteAllData(); } catch (Throwable ignored) { }
    }

    @Override protected void onDestroy() {
        saveSession();
        for(BrowserTab t:tabs) { cancelLoadTimeout(t); if(t.web!=null) { t.web.stopLoading(); t.web.destroy(); t.web=null; } }
        tabs.clear(); super.onDestroy();
    }
}
