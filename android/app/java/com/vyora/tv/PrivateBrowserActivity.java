package com.vyora.tv;

import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import android.widget.Toast;

/**
 * Runs in a dedicated Android process so API 28+ can assign a separate
 * Chromium/WebView data directory before the first WebView is created.
 */
public final class PrivateBrowserActivity extends BrowserActivity {
    @Override public void onCreate(Bundle state) {
        // Must be called before BrowserActivity creates the first WebView.
        if (Build.VERSION.SDK_INT >= 28) WebView.setDataDirectorySuffix("vyora_private");
        super.onCreate(state);
        if (Build.VERSION.SDK_INT < 28) {
            Toast.makeText(this, "Private browsing requires Android 9 or newer for isolated storage.", Toast.LENGTH_LONG).show();
            finish();
        }
    }

    @Override protected boolean isPrivateSession() {
        return true;
    }

    @Override protected void onDestroy() {
        // Destroy and clear private renderers/storage before the private process exits.
        clearPrivateBrowsingData();
        super.onDestroy();
    }
}
