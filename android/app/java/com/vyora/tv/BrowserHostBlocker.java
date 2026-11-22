package com.vyora.tv;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Lightweight, fail-open host protection for WebView subresources.
 *
 * This is deliberately a bounded hosts-file implementation, not a claim of
 * full EasyList/uBlock cosmetic or scriptlet support. It never blocks a
 * top-level navigation and keeps parsing/network work off the UI thread.
 */
final class BrowserHostBlocker {
    private static final String TAG = "VyoraHostBlocker";
    private static final String PREFS = "vyora_browser_protection";
    private static final String LIST_URL =
            "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts";
    private static final long REFRESH_MS = 24L * 60L * 60L * 1000L;
    private static final int MAX_HOSTS = 60000;
    private static volatile BrowserHostBlocker instance;

    private final Context app;
    private final SharedPreferences prefs;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "vyora-host-filter");
        t.setPriority(Thread.MIN_PRIORITY);
        return t;
    });
    private volatile Set<String> blocked = Collections.emptySet();
    private volatile boolean ready;

    static BrowserHostBlocker get(Context context) {
        BrowserHostBlocker current = instance;
        if (current == null) {
            synchronized (BrowserHostBlocker.class) {
                current = instance;
                if (current == null) instance = current = new BrowserHostBlocker(context);
            }
        }
        return current;
    }

    private BrowserHostBlocker(Context context) {
        app = context.getApplicationContext();
        prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    void start() {
        worker.execute(() -> {
            File cache = new File(app.getFilesDir(), "browser-hosts.txt");
            if (cache.isFile()) load(cache);
            long last = prefs.getLong("last_success", 0L);
            if (!cache.isFile() || System.currentTimeMillis() - last > REFRESH_MS) {
                download(cache);
            }
        });
    }

    boolean shouldBlock(String rawHost) {
        if (!ready || rawHost == null) return false;
        String host = rawHost.toLowerCase(Locale.ROOT);
        while (host.endsWith(".")) host = host.substring(0, host.length() - 1);
        if (host.isEmpty() || isEssentialAuthHost(host)) return false;
        Set<String> rules = blocked;
        String candidate = host;
        while (true) {
            if (rules.contains(candidate)) return true;
            int dot = candidate.indexOf('.');
            if (dot < 0) return false;
            candidate = candidate.substring(dot + 1);
        }
    }

    private boolean isEssentialAuthHost(String host) {
        return host.equals("accounts.google.com")
                || host.endsWith(".accounts.google.com")
                || host.equals("oauth2.googleapis.com")
                || host.equals("login.microsoftonline.com")
                || host.endsWith(".login.microsoftonline.com")
                || host.equals("appleid.apple.com")
                || host.equals("github.com")
                || host.endsWith(".github.com");
    }

    private void download(File target) {
        HttpURLConnection connection = null;
        File temp = new File(target.getParentFile(), target.getName() + ".tmp");
        try {
            connection = (HttpURLConnection) new URL(LIST_URL).openConnection();
            connection.setConnectTimeout(6000);
            connection.setReadTimeout(10000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("User-Agent", "VYORA-Browser/1.0");
            connection.connect();
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) return;
            try (FileOutputStream out = new FileOutputStream(temp);
                 java.io.InputStream in = connection.getInputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                long total = 0;
                while ((count = in.read(buffer)) != -1) {
                    total += count;
                    if (total > 8L * 1024L * 1024L) throw new IllegalStateException("hosts list too large");
                    out.write(buffer, 0, count);
                }
                out.getFD().sync();
            }
            if (temp.length() > 0 && temp.renameTo(target)) {
                load(target);
                if (ready) prefs.edit().putLong("last_success", System.currentTimeMillis()).apply();
            }
        } catch (Throwable error) {
            Log.w(TAG, "Host list refresh skipped; continuing with cached rules", error);
            // Fail open: network/filter failure must never trap the browser in a loading state.
        } finally {
            if (temp.exists()) temp.delete();
            if (connection != null) connection.disconnect();
        }
    }

    private void load(File file) {
        HashSet<String> parsed = new HashSet<>(MAX_HOSTS);
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                new FileInputStream(file), StandardCharsets.UTF_8), 32768)) {
            String line;
            while ((line = reader.readLine()) != null && parsed.size() < MAX_HOSTS) {
                int comment = line.indexOf('#');
                if (comment >= 0) line = line.substring(0, comment);
                line = line.trim();
                if (line.isEmpty()) continue;
                String[] parts = line.split("\\s+");
                if (parts.length < 2) continue;
                String ip = parts[0];
                if (!("0.0.0.0".equals(ip) || "127.0.0.1".equals(ip) || "::".equals(ip))) continue;
                String host = parts[1].toLowerCase(Locale.ROOT);
                if (host.length() > 2 && host.indexOf('.') > 0
                        && host.matches("[a-z0-9._-]+") && !host.equals("localhost")) {
                    parsed.add(host);
                }
            }
            if (!parsed.isEmpty()) {
                blocked = Collections.unmodifiableSet(parsed);
                ready = true;
                Log.i(TAG, "Loaded " + parsed.size() + " bounded host rules");
            }
        } catch (Throwable error) {
            Log.w(TAG, "Could not load cached host list; protection remains fail-open", error);
        }
    }
}
