package com.vyora.tv;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.speech.tts.TextToSpeech;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import java.util.Locale;

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
    public boolean launchPlayer(final String url, final String title, final String pkg) {
        if (pkg == null || pkg.trim().isEmpty()) return false;
        try {
            // Android 11+ package visibility is declared in AndroidManifest.xml.
            act.getPackageManager().getPackageInfo(pkg.trim(), 0);
        } catch (Throwable missing) {
            act.runOnUiThread(() -> Toast.makeText(act,
                    pkg + " is not installed. VYORA's built-in player will be used.",
                    Toast.LENGTH_LONG).show());
            return false;
        }
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW);
                    intent.setDataAndType(Uri.parse(url), "video/*");
                    intent.setPackage(pkg.trim());
                    if (title != null && !title.trim().isEmpty()) intent.putExtra("title", title);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    act.startActivity(intent);
                } catch (Throwable error) {
                    Log.e(TAG, "External player could not open stream: " + pkg, error);
                    Toast.makeText(act,
                            "This player could not open the stream. Try VYORA Player or another player.",
                            Toast.LENGTH_LONG).show();
                }
            }
        });
        return true;
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
