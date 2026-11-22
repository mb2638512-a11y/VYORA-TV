package com.vyora.tv;

import android.os.Build;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.widget.Toast;

/**
 * Runs in a dedicated Android process so API 28+ can assign a separate
 * Chromium/WebView data directory before the first WebView is created.
 */
public final class PrivateBrowserActivity extends BrowserActivity {
    @Override public void onCreate(Bundle state) {
        if (Build.VERSION.SDK_INT < 28) {
            Toast.makeText(this, "Private browsing requires Android 9 or newer on this device.", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        // Must be called before BrowserActivity (or anything else in this process)
        // creates the first WebView.
        WebView.setDataDirectorySuffix("vyora_private");
        super.onCreate(state);
    }

    @Override protected boolean isPrivateSession() {
        return true;
    }

    @Override protected void onDestroy() {
        // Do not retain private cookies, cache, DOM storage, or WebView history
        // when the private browser window is closed.
        try {
            CookieManager cookies = CookieManager.getInstance();
            cookies.removeAllCookies(null);
            cookies.flush();
        } catch (Throwable ignored) { }
        try { WebStorage.getInstance().deleteAllData(); } catch (Throwable ignored) { }
        super.onDestroy();
    }
}
