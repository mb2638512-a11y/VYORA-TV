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
import android.os.Environment;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.SafeBrowsingResponse;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
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
    private Button backButton, forwardButton, reloadButton, homeButton, goButton, addButton, closeButton;
    private ProgressBar progress;
    private SharedPreferences prefs;
    private int activeIndex = 0;
    private boolean tv = false;
    private String initialMode = "auto";

    private int dp(float value) { return (int)(value * getResources().getDisplayMetrics().density + 0.5f); }
    private int controlHeight() { return dp(tv ? 54 : 44); }
    private int textSize() { return tv ? 18 : 14; }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        tv = getPackageManager().hasSystemFeature("android.software.leanback");
        if (tv) setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        initialMode = getIntent().getStringExtra("displayMode");
        if (initialMode == null) initialMode = "auto";
        loadEngines();
        buildLayout();
        restoreOrCreateSession(getIntent().getStringExtra("initialUrl"),
                getIntent().getStringExtra("engineId"));
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
        root.addView(toolbar,new LinearLayout.LayoutParams(-1,-2));

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
        second.addView(addButton,new LinearLayout.LayoutParams(controlHeight(),controlHeight()));
        second.addView(closeButton,new LinearLayout.LayoutParams(controlHeight(),controlHeight()));
        root.addView(second,new LinearLayout.LayoutParams(-1,-2));

        progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100); progress.setProgressTintList(android.content.res.ColorStateList.valueOf(ACCENT));
        root.addView(progress,new LinearLayout.LayoutParams(-1,dp(3)));
        webFrame=new FrameLayout(this); webFrame.setBackgroundColor(Color.WHITE);
        root.addView(webFrame,new LinearLayout.LayoutParams(-1,0,1f));
        setContentView(root);

        backButton.setOnClickListener(v -> { if(current()!=null && current().web.canGoBack()) current().web.goBack(); });
        forwardButton.setOnClickListener(v -> { if(current()!=null && current().web.canGoForward()) current().web.goForward(); });
        reloadButton.setOnClickListener(v -> { if(current()!=null) current().web.reload(); });
        homeButton.setOnClickListener(v -> { if(current()!=null) current().web.loadUrl(engine(current().engineId).home); });
        goButton.setOnClickListener(v -> navigateFromAddress());
        address.setOnEditorActionListener((v,action,event)-> {
            if(action==EditorInfo.IME_ACTION_GO || action==EditorInfo.IME_ACTION_DONE ||
                    (event!=null && event.getKeyCode()==KeyEvent.KEYCODE_ENTER)) { navigateFromAddress(); return true; }
            return false;
        });
        addButton.setOnClickListener(v -> addTab(null,null));
        closeButton.setOnClickListener(v -> closeCurrentTab());
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

    private void restoreOrCreateSession(String initialUrl,String requestedEngine) {
        boolean restored=false;
        if(initialUrl==null || initialUrl.trim().isEmpty()) {
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
                    if(!tab.url.isEmpty()) tab.web.loadUrl(tab.url);
                }
                if(!tabs.isEmpty()) { activeIndex=Math.max(0,Math.min(wanted,tabs.size()-1)); restored=true; }
            } catch(Throwable ignored) { }
        }
        if(!restored) addTab(requestedEngine,initialUrl);
        else { showActiveTab(); updateTabs(); }
    }

    private BrowserTab createTab(String engineId) {
        BrowserTab tab=new BrowserTab("tab-"+System.nanoTime(),engine(engineId).id);
        WebView web=new WebView(this); tab.web=web; configureWebView(tab);
        return tab;
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
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri=request.getUrl(); String scheme=uri.getScheme()==null?"":uri.getScheme().toLowerCase(Locale.ROOT);
                if("http".equals(scheme)||"https".equals(scheme)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW,uri)); } catch(Throwable ignored) { }
                return true;
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon) {
                tab.url=url; if(current()==tab) { address.setText(url); progress.setVisibility(View.VISIBLE); progress.setProgress(5); }
                updateTabs();
            }
            @Override public void onPageFinished(WebView view,String url) {
                tab.url=url; String title=view.getTitle(); if(title!=null && !title.trim().isEmpty()) tab.title=title.trim();
                if(current()==tab) { address.setText(url); progress.setVisibility(View.GONE); updateControls(); }
                updateTabs(); saveSession();
            }
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError error) {
                handler.cancel();
                if(current()==tab) Toast.makeText(BrowserActivity.this,"Secure connection failed. The page was blocked.",Toast.LENGTH_LONG).show();
            }
        });
        tab.web.setWebChromeClient(new WebChromeClient() {
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
                BrowserTab popup = createTab(tab.engineId);
                tabs.add(popup);
                activeIndex = tabs.size() - 1;
                showActiveTab();
                updateTabs();
                WebView.WebViewTransport transport =
                        (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(popup.web);
                resultMsg.sendToTarget();
                saveSession();
                return true;
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
        if(url!=null && !url.trim().isEmpty()) tab.web.loadUrl(normalizeAddress(url,selected));
        else tab.web.loadUrl(engine(selected).home);
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
        tab.web.loadUrl(target);
        address.clearFocus();
        android.view.inputmethod.InputMethodManager imm=(android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE);
        if(imm!=null) imm.hideSoftInputFromWindow(address.getWindowToken(),0);
    }

    private BrowserTab current() { return tabs.isEmpty()?null:tabs.get(Math.max(0,Math.min(activeIndex,tabs.size()-1))); }

    private void showActiveTab() {
        BrowserTab tab=current(); if(tab==null) return;
        if(tab.web.getParent()!=null) ((ViewGroup)tab.web.getParent()).removeView(tab.web);
        webFrame.removeAllViews(); webFrame.addView(tab.web,new FrameLayout.LayoutParams(-1,-1));
        address.setText(tab.url==null?"":tab.url);
        enginePicker.setText(engine(tab.engineId).name,false);
        updateControls();
    }

    private void updateControls() {
        BrowserTab tab=current(); if(tab==null) return;
        backButton.setEnabled(tab.web.canGoBack()); forwardButton.setEnabled(tab.web.canGoForward());
        backButton.setAlpha(tab.web.canGoBack()?1f:0.45f); forwardButton.setAlpha(tab.web.canGoForward()?1f:0.45f);
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
        if(removed.web!=null) { webFrame.removeView(removed.web); removed.web.stopLoading(); removed.web.loadUrl("about:blank"); removed.web.destroy(); }
        if(tabs.isEmpty()) { activeIndex=0; addTab(null,null); return; }
        activeIndex=Math.min(activeIndex,tabs.size()-1);
        showActiveTab(); updateTabs(); saveSession();
    }

    private void saveSession() {
        try {
            JSONArray arr=new JSONArray();
            for(BrowserTab tab:tabs) {
                JSONObject item=new JSONObject(); item.put("title",tab.title); item.put("url",tab.url); item.put("engine",tab.engineId); arr.put(item);
            }
            prefs.edit().putString("tabs",arr.toString()).putInt("active",activeIndex).apply();
        } catch(Throwable ignored) { }
    }

    @Override protected void onPause() { saveSession(); for(BrowserTab t:tabs) if(t.web!=null) t.web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); for(BrowserTab t:tabs) if(t.web!=null) t.web.onResume(); }
    @Override public void onBackPressed() {
        BrowserTab tab=current();
        if(tab!=null && tab.web.canGoBack()) { tab.web.goBack(); return; }
        if(tabs.size()>1) { closeCurrentTab(); return; }
        super.onBackPressed();
    }
    @Override protected void onDestroy() {
        saveSession();
        for(BrowserTab t:tabs) if(t.web!=null) { t.web.stopLoading(); t.web.destroy(); }
        tabs.clear(); super.onDestroy();
    }
}
