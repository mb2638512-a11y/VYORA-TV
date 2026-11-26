package com.vyora.tv;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.net.Uri;
import android.speech.tts.TextToSpeech;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Bridge exposed to the web UI as window.VyoraBridge.
 * Every method may be called from the WebView's JS thread, so all UI work is
 * posted to the main thread.
 */
public class TvBridge {

    private static final String TAG = "VyoraBridge";

    private final MainActivity act;

    public TvBridge(MainActivity act) {
        this.act = act;
    }

    /** True only on Android TV / Leanback hardware; used to select the TV UI. */
    @JavascriptInterface
    public boolean isTvDevice() {
        return act.getPackageManager().hasSystemFeature("android.software.leanback");
    }

    @JavascriptInterface
    public void play(final String url, final String referer, final String ua, final String title, final String logo) {
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                act.startPlayback(url, referer, ua, title, logo);
            }
        });
    }

    /**
     * Turbo start: hand over every source of the channel at once. The native
     * player races them and keeps the first one that works.
     * @param candidates JSON array of {url, referer, ua}
     */
    @JavascriptInterface
    public void playMulti(final String candidates, final String title, final String logo) {
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                act.startPlaybackMulti(candidates, title, logo);
            }
        });
    }

    @JavascriptInterface
    public void stop() {
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                act.stopPlayback();
            }
        });
    }

    @JavascriptInterface
    public void setVolume(final int volume) {
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                act.setPlayerVolume(volume / 100f);
            }
        });
    }

    @JavascriptInterface
    public int getVolume() {
        return (int) (act.getPlayerVolume() * 100f);
    }

    @JavascriptInterface
    public boolean isMuted() {
        return act.getPlayerVolume() <= 0.01f;
    }

    @JavascriptInterface
    public void toggleMute() {
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                act.toggleMute();
            }
        });
    }

    @JavascriptInterface
    public void speak(final String text) {
        act.speak(text);
    }

    @JavascriptInterface
    public void openExternal(final String url) {
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Intent i;
                    if (url != null && url.startsWith("intent:")) {
                        i = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
                    } else {
                        i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    }
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    act.startActivity(i);
                } catch (Throwable t) {
                    Log.e(TAG, "openExternal failed", t);
                }
            }
        });
    }

    @JavascriptInterface
    public boolean launchPlayer(final String url, final String title, final String pkg,
                                final String referer, final String ua) {
        if (url == null || url.trim().isEmpty() || pkg == null || pkg.trim().isEmpty()) return false;
        // MX Player has separate free and Pro package IDs. Prefer the
        // requested edition, then fall back to the other installed edition.
        String installedPackage = pkg.trim();
        try {
            act.getPackageManager().getPackageInfo(installedPackage, 0);
        } catch (Throwable missing) {
            if ("com.mxtech.videoplayer.ad".equals(installedPackage)) {
                installedPackage = "com.mxtech.videoplayer.pro";
                try {
                    act.getPackageManager().getPackageInfo(installedPackage, 0);
                } catch (Throwable alsoMissing) {
                    act.runOnUiThread(() -> Toast.makeText(act,
                            "MX Player is not installed. VYORA's built-in player will be used.",
                            Toast.LENGTH_LONG).show());
                    return false;
                }
            } else {
                act.runOnUiThread(() -> Toast.makeText(act,
                        pkg + " is not installed. VYORA's built-in player will be used.",
                        Toast.LENGTH_LONG).show());
                return false;
            }
        }

        final Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(Uri.parse(url), "video/*");
        intent.setPackage(installedPackage);
        if (title != null && !title.trim().isEmpty()) {
            intent.putExtra("title", title);
            intent.putExtra(Intent.EXTRA_TITLE, title);
        }

        // Common Android media/browser header conventions. Apps may ignore
        // these extras; the built-in Media3 player remains the reliable option
        // for providers that require custom request headers.
        if ((referer != null && !referer.isEmpty()) || (ua != null && !ua.isEmpty())) {
            Bundle headers = new Bundle();
            if (referer != null && !referer.isEmpty()) {
                headers.putString("Referer", referer);
                intent.putExtra("http-referrer", referer);
            }
            if (ua != null && !ua.isEmpty()) {
                headers.putString("User-Agent", ua);
                intent.putExtra("http-user-agent", ua);
            }
            intent.putExtra("com.android.browser.headers", headers);
            intent.putExtra("headers", headers);
            intent.putExtra("http_headers", headers);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        // JavascriptInterface methods run off the UI thread. Wait briefly for
        // startActivity so the web UI never reports a launch before Android
        // has actually accepted it.
        final CountDownLatch completed = new CountDownLatch(1);
        final AtomicBoolean started = new AtomicBoolean(false);
        act.runOnUiThread(() -> {
            try {
                if (intent.resolveActivity(act.getPackageManager()) == null) {
                    throw new android.content.ActivityNotFoundException("No activity can open this stream");
                }
                act.startActivity(intent);
                started.set(true);
            } catch (Throwable error) {
                Log.e(TAG, "External player could not open stream: " + pkg, error);
                Toast.makeText(act,
                        "This player could not open the stream. Try VYORA Player instead.",
                        Toast.LENGTH_LONG).show();
            } finally {
                completed.countDown();
            }
        });
        try {
            if (!completed.await(4, TimeUnit.SECONDS)) return false;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return false;
        }
        return started.get();
    }

    /** Open the full native Android WebView browser, outside the app's iframe shell. */
    @JavascriptInterface
    public boolean openBrowser(final String initialUrl, final String engineId, final String displayMode, final boolean standalone) {
        final CountDownLatch done = new CountDownLatch(1);
        final AtomicBoolean started = new AtomicBoolean(false);
        act.runOnUiThread(() -> {
            try {
                Intent intent = new Intent(act, BrowserActivity.class);
                intent.putExtra("initialUrl", initialUrl == null ? "" : initialUrl);
                intent.putExtra("engineId", engineId == null ? "google0" : engineId);
                intent.putExtra("displayMode", displayMode == null ? "auto" : displayMode);
                intent.putExtra("standaloneMode", standalone);
                act.startActivity(intent);
                started.set(true);
            } catch (Throwable error) {
                Log.e(TAG, "Could not open native browser", error);
                Toast.makeText(act, "VYORA Browser could not be opened", Toast.LENGTH_LONG).show();
            } finally {
                done.countDown();
            }
        });
        try {
            if (!done.await(4, TimeUnit.SECONDS)) return false;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return false;
        }
        return started.get();
    }

    @JavascriptInterface
    public void setBrowserDisplayMode(final String mode) {
        act.runOnUiThread(() -> act.setBrowserDisplayMode(mode));
    }

    @JavascriptInterface
    public void installApk(final String urlOrPath) {
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    // A relative download URL must be resolved against the
                    // embedded engine, otherwise the installer gets a URI it
                    // cannot open.
                    String target = urlOrPath;
                    if (target != null && target.startsWith("/")) {
                        target = act.localBaseUrl() + target;
                    }
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    i.setDataAndType(Uri.parse(target), "application/vnd.android.package-archive");
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    act.startActivity(i);
                } catch (Throwable t) {
                    Log.e(TAG, "installApk failed, trying browser view", t);
                    try {
                        String target = urlOrPath;
                        if (target != null && target.startsWith("/")) {
                            target = act.localBaseUrl() + target;
                        }
                        Intent i2 = new Intent(Intent.ACTION_VIEW, Uri.parse(target));
                        i2.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        act.startActivity(i2);
                    } catch (Throwable t2) {
                        Log.e(TAG, "fallback launch failed", t2);
                    }
                }
            }
        });
    }

    @JavascriptInterface
    public void exitApp() {
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                act.finish();
            }
        });
    }

    @JavascriptInterface
    public void toast(final String message) {
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(act, message, Toast.LENGTH_SHORT).show();
            }
        });
    }
}
