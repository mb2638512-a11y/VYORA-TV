package com.vyora.tv;

import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.CookieManager;
import android.webkit.WebStorage;

/**
 * Runs in a dedicated Android process so API 28+ can assign a separate
 * Chromium/WebView data directory before the first WebView is created.
 */
public final class PrivateBrowserActivity extends BrowserActivity {
    private static boolean profileSuffixConfigured;

    @Override public void onCreate(Bundle state) {
        // Configure once per private process, before its first WebView. The
        // process may be reused after a private window is closed.
        if (Build.VERSION.SDK_INT >= 28 && !profileSuffixConfigured) {
            WebView.setDataDirectorySuffix("vyora_private");
            profileSuffixConfigured = true;
        }
        super.onCreate(state);
    }

    @Override protected boolean isPrivateSession() {
        return true;
    }

    @Override protected void prepareBrowserSession(Runnable continuation) {
        // Purge leftovers from a previous private process crash before loading
        // any page in this new private session.
        CookieManager cookies = CookieManager.getInstance();
        cookies.removeAllCookies(value -> {
            cookies.flush();
            try { WebStorage.getInstance().deleteAllData(); } catch (Throwable ignored) { }
            try {
                WebView cleanup = new WebView(this);
                cleanup.clearCache(true);
                cleanup.clearHistory();
                cleanup.clearFormData();
                cleanup.destroy();
            } catch (Throwable ignored) { }
            if (!isFinishing() && !isDestroyed()) continuation.run();
        });
    }

    @Override protected void onDestroy() {
        // Destroy and clear private renderers/storage before the private process exits.
        if (isFinishing()) clearPrivateBrowsingData();
        super.onDestroy();
    }
}
