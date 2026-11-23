package com.vyora.tv;

import android.content.Context;
import android.content.res.AssetManager;
import android.os.Environment;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

/**
 * Embedded HTTP server for the Android TV shell.
 *
 * The APK used to open the web bundle straight from
 * {@code file:///android_asset/index.html}. Every relative {@code /api/...} URL
 * then resolved to {@code file:///api/...} and never answered, so the in-app
 * browser could not load a single page, no logo was ever fetched and the
 * download manager was dead.
 *
 * This server is the platform engine inside the app: it serves the bundled
 * web UI over {@code http://127.0.0.1:<port>} and implements the API the UI
 * needs:
 *
 *   /api/logo           icon proxy (site favicon -> Google -> DuckDuckGo)
 *   /api/webproxy       rewriting web proxy (X-Frame-Options/CSP stripped,
 *                       &lt;base href&gt; + bridge script injected)
 *   /api/downloads      download manager (list / start / delete / file)
 *   /api/network        measured bandwidth stub for the auto-quality badge
 *
 * Everything else is served straight from the APK assets.
 */
public class LocalServer {

    private static final String TAG = "VyoraLocal";
    private static final String UA =
            "Mozilla/5.0 (Linux; Android 10; Android TV) AppleWebKit/537.36 "
                    + "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final int MAX_BODY = 24 * 1024 * 1024;

    private final Context ctx;
    private final TvPlayer player;
    private final AssetManager assets;
    private final ExecutorService pool = Executors.newFixedThreadPool(16);
    private final Map<String, byte[]> iconCache = new ConcurrentHashMap<String, byte[]>();
    private final Map<String, String> iconTypes = new ConcurrentHashMap<String, String>();
    private final Map<String, String> cookies = new ConcurrentHashMap<String, String>();
    private final LinkedHashMap<String, Download> downloads =
            new LinkedHashMap<String, Download>();
    private final String bridgeJs;

    private ServerSocket socket;
    private volatile boolean running = false;
    private int port = -1;

    public LocalServer(Context ctx, TvPlayer player) {
        this.ctx = ctx.getApplicationContext();
        this.player = player;
        this.assets = this.ctx.getAssets();
        this.bridgeJs = readRaw("vyora_webproxy");
    }

    /* ------------------------------------------------------------------ */
    /* lifecycle                                                            */
    /* ------------------------------------------------------------------ */

    /** Starts the server and returns the port it listens on (-1 on failure). */
    public int start() {
        if (running) return port;
        try {
            socket = new ServerSocket();
            socket.setReuseAddress(true);
            try {
                socket.bind(new InetSocketAddress("127.0.0.1", 8787), 64);
            } catch (IOException e) {
                socket.bind(new InetSocketAddress("127.0.0.1", 0), 64);
            }
            port = socket.getLocalPort();
            running = true;
            Thread accept = new Thread(new Runnable() {
                @Override
                public void run() {
                    acceptLoop();
                }
            }, "vyora-http-accept");
            accept.setDaemon(true);
            accept.start();
            Log.i(TAG, "Local server listening on 127.0.0.1:" + port);
        } catch (Throwable t) {
            Log.e(TAG, "local server failed to start", t);
            running = false;
            port = -1;
        }
        return port;
    }

    public void stop() {
        running = false;
        try {
            if (socket != null) socket.close();
        } catch (Throwable ignored) {
        }
        pool.shutdownNow();
    }

    public int getPort() {
        return port;
    }

    private void acceptLoop() {
        while (running) {
            try {
                final Socket client = socket.accept();
                pool.execute(new Runnable() {
                    @Override
                    public void run() {
                        serve(client);
                    }
                });
            } catch (Throwable t) {
                if (running) Log.w(TAG, "accept failed", t);
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* tiny HTTP/1.1 server                                                  */
    /* ------------------------------------------------------------------ */

    private void serve(Socket sock) {
        try {
            sock.setSoTimeout(45000);
            sock.setTcpNoDelay(true);
            InputStream in = new java.io.BufferedInputStream(sock.getInputStream());
            OutputStream out = new java.io.BufferedOutputStream(sock.getOutputStream());
            while (running) {
                String requestLine = readLine(in);
                if (requestLine == null || requestLine.isEmpty()) break;
                String[] parts = requestLine.split(" ");
                if (parts.length < 2) break;
                String method = parts[0].toUpperCase(Locale.US);
                String rawPath = parts[1];

                Map<String, String> headers = new HashMap<String, String>();
                String line;
                while ((line = readLine(in)) != null && !line.isEmpty()) {
                    int c = line.indexOf(':');
                    if (c > 0) {
                        headers.put(line.substring(0, c).trim().toLowerCase(Locale.US),
                                line.substring(c + 1).trim());
                    }
                }

                byte[] body = null;
                String cl = headers.get("content-length");
                if (cl != null) {
                    try {
                        int n = Integer.parseInt(cl.trim());
                        if (n > 0 && n <= MAX_BODY) body = readFully(in, n);
                    } catch (Throwable ignored) {
                    }
                }

                boolean keepAlive = !"close".equalsIgnoreCase(headers.get("connection"));
                handle(method, rawPath, headers, body, out, keepAlive);
                out.flush();
                if (!keepAlive) break;
            }
        } catch (Throwable t) {
            // client vanished
        } finally {
            try {
                sock.close();
            } catch (Throwable ignored) {
            }
        }
    }

    private void handle(String method, String rawPath, Map<String, String> headers,
                        byte[] body, OutputStream out, boolean keepAlive) throws IOException {
        String path = rawPath;
        String query = "";
        int q = rawPath.indexOf('?');
        if (q >= 0) {
            path = rawPath.substring(0, q);
            query = rawPath.substring(q + 1);
        }

        try {
            if (path.startsWith("/api/")) {
                if (path.equals("/api/logo")) {
                    handleLogo(query, out, keepAlive);
                    return;
                }
                if (path.equals("/api/proxy")) {
                    handleStreamProxy(method, query, headers, out, keepAlive);
                    return;
                }
                if (path.equals("/api/webproxy") || path.equals("/webproxy")) {
                    handleWebProxy(method, query, headers, body, out, keepAlive);
                    return;
                }
                if (path.equals("/api/downloads")) {
                    handleDownloadsList(out, keepAlive);
                    return;
                }
                if (path.equals("/api/downloads/start")) {
                    handleDownloadStart(method, query, body, out, keepAlive);
                    return;
                }
                if (path.equals("/api/downloads/delete")) {
                    handleDownloadDelete(query, out, keepAlive);
                    return;
                }
                if (path.equals("/api/downloads/file")) {
                    handleDownloadFile(query, out, keepAlive);
                    return;
                }
                if (path.equals("/api/network")) {
                    json(player != null ? player.networkInfoJson() : "{\"kbps\":0,\"quality\":\"auto\",\"measured\":false}", out, keepAlive);
                    return;
                }
                if (path.equals("/api/health")) {
                    json("{\"status\":\"ok\",\"engine\":\"android-local\"}", out, keepAlive);
                    return;
                }
                if (path.equals("/api/status")) {
                    json("{\"status\":{}}", out, keepAlive);
                    return;
                }
                if (path.equals("/api/status/stream")) {
                    streamStatus(out);
                    return;
                }
                // Unknown API route -> 404 so the web app falls back to the
                // bundled dataset instead of parsing an error object as data.
                jsonStatus(404, "{\"error\":\"route-not-found\"}", out, keepAlive);
                return;
            }
            serveStatic(path, out, keepAlive);
        } catch (Throwable t) {
            Log.w(TAG, "handler failed for " + path, t);
            try {
                json("{\"error\":\"internal\"}", out, false);
            } catch (Throwable ignored) {
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* static assets                                                         */
    /* ------------------------------------------------------------------ */

    private void serveStatic(String path, OutputStream out, boolean keepAlive) throws IOException {
        String assetPath;
        boolean spaFallback = false;
        if (path == null || path.isEmpty() || path.equals("/")) {
            assetPath = "index.html";
        } else if (path.startsWith("/assets/") || path.startsWith("/data/")
                || path.startsWith("/flags/")) {
            assetPath = path.substring(1);
        } else if (path.indexOf('.') > 0) {
            // A real file request (favicon, flag, ...) - never the SPA shell.
            assetPath = path.substring(1);
        } else {
            // Unknown route -> SPA fallback.
            assetPath = "index.html";
            spaFallback = true;
        }

        InputStream is = null;
        try {
            is = assets.open(assetPath);
        } catch (Throwable ignored) {
        }
        if (is == null) {
            if (spaFallback) {
                is = assets.open("index.html");
                assetPath = "index.html";
            }
        }
        if (is == null) {
            notFound(out, keepAlive);
            return;
        }

        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        copy(is, bos);
        closeQuietly(is);
        byte[] data = bos.toByteArray();

        Map<String, String> extra = new HashMap<String, String>();
        extra.put("Cache-Control", "no-cache");
        respond(200, mimeOf(assetPath), data, out, keepAlive, extra);
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase(Locale.US);
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html; charset=utf-8";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".json")) return "application/json; charset=utf-8";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".txt") || p.endsWith(".m3u") || p.endsWith(".m3u8")) return "text/plain; charset=utf-8";
        if (p.endsWith(".mp4")) return "video/mp4";
        if (p.endsWith(".webm")) return "video/webm";
        return "application/octet-stream";
    }

    /* ------------------------------------------------------------------ */
    /* icon proxy                                                            */
    /* ------------------------------------------------------------------ */

    private void handleLogo(String query, OutputStream out, boolean keepAlive) throws IOException {
        String param = queryParam(query, "u");
        String target = decodeParam(param);
        if (target == null || target.isEmpty()) {
            notFound(out, keepAlive);
            return;
        }

        byte[] cached = iconCache.get(target);
        if (cached != null) {
            respond(200, iconTypes.get(target) == null ? "image/png" : iconTypes.get(target),
                    cached, out, keepAlive);
            return;
        }

        String host = hostOf(target);
        List<String> candidates = new ArrayList<String>();
        candidates.add(target);
        if (!target.endsWith("/favicon.ico")) {
            candidates.add("https://" + host + "/favicon.ico");
        }
        if (!host.contains("google.")) {
            candidates.add("https://www.google.com/s2/favicons?domain=" + host + "&sz=128");
        }
        candidates.add("https://icons.duckduckgo.com/ip3/" + host + ".ico");

        for (String candidate : candidates) {
            byte[] data = fetchBytes(candidate, 9000);
            if (data != null && data.length > 0 && !looksLikeHtml(data)) {
                String ctype = guessImageType(data, candidate);
                iconCache.put(target, data);
                iconTypes.put(target, ctype);
                respond(200, ctype, data, out, keepAlive);
                return;
            }
        }
        notFound(out, keepAlive);
    }

    private static boolean looksLikeHtml(byte[] data) {
        for (int i = 0; i < data.length && i < 8; i++) {
            char c = (char) data[i];
            if (c == ' ' || c == '\n' || c == '\r' || c == '\t') continue;
            return c == '<';
        }
        return false;
    }

    private static String guessImageType(byte[] data, String url) {
        if (data.length > 8 && (data[0] & 0xFF) == 0x89 && data[1] == 'P') return "image/png";
        if (data.length > 3 && (data[0] & 0xFF) == 0xFF && (data[1] & 0xFF) == 0xD8) return "image/jpeg";
        if (data.length > 3 && data[0] == 'G' && data[1] == 'I' && data[2] == 'F') return "image/gif";
        if (data.length > 4 && data[0] == 'R' && data[1] == 'I' && data[2] == 'F' && data[3] == 'F') {
            return "image/webp";
        }
        String u = url.toLowerCase(Locale.US);
        if (u.endsWith(".svg")) return "image/svg+xml";
        if (u.endsWith(".ico")) return "image/x-icon";
        if (u.endsWith(".jpg") || u.endsWith(".jpeg")) return "image/jpeg";
        return "image/png";
    }

    /* ------------------------------------------------------------------ */
    /* HLS / media stream proxy                                               */
    /* ------------------------------------------------------------------ */

    /** Absolute proxy URL for Media3. Original URLs remain separate for UI health reporting. */
    public String proxyUrl(String target, String referer, String userAgent, String channelId) {
        if (target == null || !(target.startsWith("http://") || target.startsWith("https://")) || port <= 0) {
            return target == null ? "" : target;
        }
        StringBuilder result = new StringBuilder("http://127.0.0.1:")
                .append(port).append("/api/proxy?u=").append(encodeParam(target));
        if (referer != null && !referer.isEmpty()) result.append("&r=").append(encodeParam(referer));
        if (userAgent != null && !userAgent.isEmpty()) result.append("&a=").append(encodeParam(userAgent));
        if (channelId != null && !channelId.isEmpty()) result.append("&cid=").append(encodeParam(channelId));
        return result.toString();
    }

    private static String encodeParam(String value) {
        return android.util.Base64.encodeToString(value.getBytes(UTF8),
                android.util.Base64.URL_SAFE | android.util.Base64.NO_WRAP | android.util.Base64.NO_PADDING);
    }

    private void handleStreamProxy(String method, String query, Map<String, String> requestHeaders,
                                   OutputStream out, boolean keepAlive) throws IOException {
        if ("OPTIONS".equalsIgnoreCase(method)) {
            respondProxy(204, "text/plain; charset=utf-8", new byte[0], out, keepAlive, null);
            return;
        }
        String target = decodeParam(queryParam(query, "u"));
        String referer = decodeParam(queryParam(query, "r"));
        String userAgent = decodeParam(queryParam(query, "a"));
        if (target == null || !(target.startsWith("http://") || target.startsWith("https://"))) {
            respondProxy(400, "application/json; charset=utf-8",
                    "{\"error\":\"invalid-stream-url\"}".getBytes(UTF8), out, keepAlive, null);
            return;
        }

        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(target).openConnection();
            conn.setConnectTimeout(7000);
            conn.setReadTimeout(16000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestMethod("HEAD".equalsIgnoreCase(method) ? "HEAD" : "GET");
            conn.setRequestProperty("User-Agent",
                    userAgent == null || userAgent.isEmpty() ? UA : userAgent);
            conn.setRequestProperty("Accept", requestHeaders.get("accept") == null
                    ? "*/*" : requestHeaders.get("accept"));
            conn.setRequestProperty("Accept-Encoding", "identity");
            conn.setRequestProperty("Connection", "close");
            if (referer != null && !referer.isEmpty()) {
                conn.setRequestProperty("Referer", referer);
                try {
                    URL ref = new URL(referer);
                    conn.setRequestProperty("Origin", ref.getProtocol() + "://" + ref.getAuthority());
                } catch (Throwable ignored) { }
            } else {
                try {
                    URL source = new URL(target);
                    conn.setRequestProperty("Referer", source.getProtocol() + "://" + source.getAuthority() + "/");
                    conn.setRequestProperty("Origin", source.getProtocol() + "://" + source.getAuthority());
                } catch (Throwable ignored) { }
            }
            String range = requestHeaders.get("range");
            if (range != null && !range.isEmpty()) conn.setRequestProperty("Range", range);

            int status = conn.getResponseCode();
            String contentType = conn.getContentType();
            if (contentType == null || contentType.isEmpty()) contentType = "application/octet-stream";
            String finalUrl = conn.getURL() == null ? target : conn.getURL().toString();
            byte[] payload = new byte[0];

            if (!"HEAD".equalsIgnoreCase(method)) {
                InputStream upstream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                if (upstream != null) payload = readAll(upstream, null);
            }

            String trimmed = new String(payload, UTF8).trim();
            boolean hls = status >= 200 && status < 300 && (
                    contentType.toLowerCase(Locale.US).contains("mpegurl")
                    || target.toLowerCase(Locale.US).contains(".m3u8")
                    || trimmed.startsWith("#EXTM3U"));
            if (hls) {
                String rewritten = rewriteHlsForProxy(trimmed, finalUrl, referer, userAgent,
                        queryParam(query, "cid"));
                payload = rewritten.getBytes(UTF8);
                contentType = "application/vnd.apple.mpegurl; charset=utf-8";
            }

            Map<String, String> extra = new HashMap<String, String>();
            String contentRange = conn.getHeaderField("Content-Range");
            String acceptRanges = conn.getHeaderField("Accept-Ranges");
            String lastModified = conn.getHeaderField("Last-Modified");
            if (contentRange != null) extra.put("Content-Range", contentRange);
            if (acceptRanges != null) extra.put("Accept-Ranges", acceptRanges);
            if (lastModified != null) extra.put("Last-Modified", lastModified);
            extra.put("Cache-Control", "no-store");
            respondProxy(status, contentType, payload, out, keepAlive, extra);
        } catch (Throwable error) {
            Log.w(TAG, "stream proxy failed: " + target, error);
            respondProxy(502, "application/json; charset=utf-8",
                    ("{\"error\":\"upstream-failed\",\"detail\":"
                            + jsonString(error.getMessage() == null ? "network error" : error.getMessage()) + "}")
                            .getBytes(UTF8), out, keepAlive, null);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String rewriteHlsForProxy(String playlist, String baseUrl, String referer,
                                      String userAgent, String channelId) {
        StringBuilder rewritten = new StringBuilder();
        String[] lines = playlist.split("\\r?\\n");
        Pattern uriAttribute = Pattern.compile("URI=\"([^\"]+)\"");
        for (String raw : lines) {
            String line = raw.trim();
            if (line.isEmpty()) {
                rewritten.append(raw).append('\n');
                continue;
            }
            if (line.startsWith("#")) {
                Matcher matcher = uriAttribute.matcher(line);
                StringBuffer replaced = new StringBuffer();
                while (matcher.find()) {
                    String original = matcher.group(1);
                    String proxied = proxyResolvedUrl(baseUrl, original, referer, userAgent, channelId);
                    matcher.appendReplacement(replaced, Matcher.quoteReplacement("URI=\"" + proxied + "\""));
                }
                matcher.appendTail(replaced);
                rewritten.append(replaced).append('\n');
            } else {
                rewritten.append(proxyResolvedUrl(baseUrl, line, referer, userAgent, channelId)).append('\n');
            }
        }
        return rewritten.toString();
    }

    private String proxyResolvedUrl(String baseUrl, String value, String referer,
                                    String userAgent, String channelId) {
        if (value == null || value.isEmpty() || value.startsWith("data:")
                || value.startsWith("skd:") || value.startsWith("urn:")) return value;
        try {
            URL resolved = new URL(new URL(baseUrl), value);
            String absolute = resolved.toString();
            if (!absolute.startsWith("http://") && !absolute.startsWith("https://")) return value;
            return proxyUrl(absolute, referer, userAgent, channelId);
        } catch (Throwable ignored) {
            return value;
        }
    }

    private static void respondProxy(int code, String contentType, byte[] body, OutputStream out,
                                     boolean keepAlive, Map<String, String> extra) throws IOException {
        String reason;
        switch (code) {
            case 200: reason = "OK"; break;
            case 204: reason = "No Content"; break;
            case 206: reason = "Partial Content"; break;
            case 400: reason = "Bad Request"; break;
            case 401: reason = "Unauthorized"; break;
            case 403: reason = "Forbidden"; break;
            case 404: reason = "Not Found"; break;
            case 416: reason = "Range Not Satisfiable"; break;
            case 429: reason = "Too Many Requests"; break;
            case 500: reason = "Internal Server Error"; break;
            case 502: reason = "Bad Gateway"; break;
            case 503: reason = "Service Unavailable"; break;
            default: reason = "Upstream Response";
        }
        StringBuilder head = new StringBuilder();
        head.append("HTTP/1.1 ").append(code).append(' ').append(reason).append("\r\n");
        head.append("Content-Type: ").append(contentType == null ? "application/octet-stream" : contentType).append("\r\n");
        head.append("Content-Length: ").append(body == null ? 0 : body.length).append("\r\n");
        head.append("Access-Control-Allow-Origin: *\r\n");
        head.append("Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n");
        head.append("Access-Control-Allow-Headers: *\r\n");
        head.append("Access-Control-Expose-Headers: *\r\n");
        if (extra != null) {
            for (Map.Entry<String, String> entry : extra.entrySet()) {
                head.append(entry.getKey()).append(": ").append(entry.getValue()).append("\r\n");
            }
        }
        head.append("Connection: ").append(keepAlive ? "keep-alive" : "close").append("\r\n\r\n");
        out.write(head.toString().getBytes(UTF8));
        if (body != null && body.length > 0) out.write(body);
    }

    /* ------------------------------------------------------------------ */
    /* web proxy                                                             */
    /* ------------------------------------------------------------------ */

    private void handleWebProxy(String method, String query, Map<String, String> headers,
                                byte[] body, OutputStream out, boolean keepAlive) throws IOException {
        String param = queryParam(query, "u");
        String target = decodeParam(param);
        if (target == null || target.isEmpty()) {
            errorPage(out, keepAlive, "No address to open",
                    "The browser did not receive a destination URL.", "");
            return;
        }
        target = target.trim();
        if (target.startsWith("//")) target = "https:" + target;
        if (!target.startsWith("http://") && !target.startsWith("https://")) {
            if (target.matches("^[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}(/.*)?$")) {
                target = "https://" + target;
            } else {
                target = "https://html.duckduckgo.com/html/?q="
                        + java.net.URLEncoder.encode(target, "UTF-8");
            }
        }

        // A YouTube video is served as its embed form - the only one that plays
        // inside a frame (the watch page is SAMEORIGIN, the regular embed
        // answers "Error 152 - 4").
        String embed = toYouTubeEmbed(target);
        if (embed != null) {
            redirect(307, embed, out, keepAlive);
            return;
        }

        boolean isDoc = "document".equals(headers.get("sec-fetch-dest"))
                || (headers.get("accept") != null
                        && headers.get("accept").toLowerCase(Locale.US).contains("text/html"));

        String userAgentMode = queryParam(query, "mode");
        HttpURLConnection conn = null;
        String finalUrl = target;
        try {
            String current = target;
            for (int hop = 0; hop < 8; hop++) {
                conn = openRemote(current, method, headers, body, userAgentMode);
                int code = conn.getResponseCode();
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    String loc = conn.getHeaderField("Location");
                    conn.disconnect();
                    if (loc == null || loc.isEmpty()) break;
                    current = absolute(current, loc);
                    finalUrl = current;
                    continue;
                }
                break;
            }
            if (conn == null) throw new IOException("no response");

            int code = conn.getResponseCode();
            if (code >= 400) {
                errorPage(out, keepAlive, "This site could not be reached",
                        "The site answered with HTTP " + code
                                + ". It may be blocking automated access from this network.",
                        finalUrl);
                return;
            }

            // Remember cookies so a second request (login, consent, ads) is
            // answered by the same session instead of a fresh visitor.
            try {
                Map<String, java.util.List<String>> setCookies = conn.getHeaderFields();
                if (setCookies != null) {
                    java.util.List<String> sc = setCookies.get("Set-Cookie");
                    if (sc != null && !sc.isEmpty()) {
                        StringBuilder jar = new StringBuilder();
                        for (String raw : sc) {
                            if (raw == null) continue;
                            int eq = raw.indexOf('=');
                            int semi = raw.indexOf(';');
                            if (eq > 0 && (semi < 0 || semi > eq)) {
                                if (jar.length() > 0) jar.append("; ");
                                jar.append(raw.substring(0, semi < 0 ? raw.length() : semi));
                            }
                        }
                        if (jar.length() > 0) {
                            cookies.put(hostOf(finalUrl), jar.toString());
                        }
                    }
                }
            } catch (Throwable ignored) {
            }

            String embed2 = toYouTubeEmbed(finalUrl);
            if (embed2 != null && isDoc) {
                redirect(307, embed2, out, keepAlive);
                return;
            }

            String ctype = conn.getHeaderField("Content-Type");
            boolean html = ctype != null && ctype.toLowerCase(Locale.US).contains("text/html");

            if (html && isDoc) {
                byte[] raw = readAll(conn.getInputStream(), conn.getContentEncoding());
                String page = new String(raw, UTF8);
                page = stripFrameBusters(page);
                page = injectBridge(page, finalUrl);
                byte[] outBytes = page.getBytes(UTF8);
                Map<String, String> extra = new HashMap<String, String>();
                extra.put("X-Vyora-Proxy", "local");
                respond(200, "text/html; charset=utf-8", outBytes, out, keepAlive, extra);
                return;
            }

            // Non-HTML (JSON, images, css, js, media): stream it through with
            // permissive CORS so the page can use it.
            InputStream src = conn.getInputStream();
            if ("gzip".equalsIgnoreCase(conn.getContentEncoding())) {
                src = new GZIPInputStream(src);
            }
            byte[] data = readAll(src, null);
            Map<String, String> extra = new HashMap<String, String>();
            extra.put("Access-Control-Allow-Origin", "*");
            extra.put("Access-Control-Allow-Headers", "*");
            extra.put("Cache-Control", "public, max-age=600");
            respond(200, ctype == null ? "application/octet-stream" : ctype, data, out,
                    keepAlive, extra);
        } catch (Throwable t) {
            Log.w(TAG, "webproxy failed for " + finalUrl, t);
            errorPage(out, keepAlive, "This site could not be reached",
                    "The server did not respond in time. It may be offline, geo-blocked, "
                            + "or blocking the proxy. Try a different site or search.", finalUrl);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private HttpURLConnection openRemote(String url, String method, Map<String, String> headers,
                                         byte[] body, String userAgentMode) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setInstanceFollowRedirects(false);
        conn.setConnectTimeout(12000);
        conn.setReadTimeout(25000);
        String requestUa = UA;
        if ("desktop".equalsIgnoreCase(userAgentMode)) {
            requestUa = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
        } else if ("mobile".equalsIgnoreCase(userAgentMode)) {
            requestUa = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
        }
        conn.setRequestProperty("User-Agent", requestUa);
        conn.setRequestProperty("Accept-Language", "en-US,en;q=0.9");
        conn.setRequestProperty("Accept-Encoding", "gzip");
        String accept = headers.get("accept");
        if (accept != null) conn.setRequestProperty("Accept", accept);
        String dest = headers.get("sec-fetch-dest");
        if (dest != null) conn.setRequestProperty("Sec-Fetch-Dest", dest);
        String cookie = cookies.get(hostOf(url));
        if (cookie != null && !cookie.isEmpty()) conn.setRequestProperty("Cookie", cookie);
        try {
            conn.setRequestMethod(method == null ? "GET" : method);
        } catch (Throwable t) {
            conn.setRequestMethod("GET");
        }
        if (body != null && body.length > 0
                && !"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) {
            conn.setDoOutput(true);
            conn.setFixedLengthStreamingMode(body.length);
            OutputStream os = conn.getOutputStream();
            os.write(body);
            os.flush();
            os.close();
        }
        return conn;
    }

    /** Removes the frame-busting meta tags a site may ship in its markup. */
    private static String stripFrameBusters(String html) {
        return html.replaceAll(
                "(?is)<meta[^>]*http-equiv\\s*=\\s*[\"']?(?:content-security-policy|x-frame-options)[^>]*>",
                "");
    }

    /**
     * Injects the base href and the bridge script right after &lt;head&gt;, so
     * relative links resolve against the real site while the bridge keeps the
     * navigation inside the app.
     */
    private String injectBridge(String html, String target) {
        StringBuilder sb = new StringBuilder();
        sb.append("<base href=\"").append(escapeHtml(target)).append("\">");
        sb.append("<script>window.__VYORA_CURRENT_URL__=")
                .append(jsonString(target)).append(";</script>");
        if (bridgeJs != null && !bridgeJs.isEmpty()) {
            sb.append("<script>").append(bridgeJs).append("</script>");
        }
        Matcher m = Pattern.compile("(?i)<head[^>]*>").matcher(html);
        if (m.find()) {
            int at = m.end();
            return html.substring(0, at) + sb + html.substring(at);
        }
        return sb + html;
    }

    private static String jsonString(String value) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '"' || c == '\\') sb.append('\\').append(c);
            else if (c == '\n') sb.append("\\n");
            else if (c == '\r') sb.append("\\r");
            else if (c == '\t') sb.append("\\t");
            else sb.append(c);
        }
        return sb.append('"').toString();
    }

    private static String escapeHtml(String s) {
        return s.replace("&", "&amp;").replace("\"", "&quot;").replace("<", "&lt;")
                .replace(">", "&gt;");
    }

    /* ------------------------------------------------------------------ */
    /* downloads                                                             */
    /* ------------------------------------------------------------------ */

    private static class Download {
        String id;
        String name;
        String url;
        String type = "file";
        String status = "downloading";
        String fileName = "";
        String filePath = "";
        long sizeBytes = 0;
        long downloaded = 0;
        int progress = 0;
        String speed = "";
        String createdAt = "";
        String errorMsg = "";
    }

    private void handleDownloadsList(OutputStream out, boolean keepAlive) throws IOException {
        StringBuilder sb = new StringBuilder("{\"items\":[");
        synchronized (downloads) {
            boolean first = true;
            for (Download d : downloads.values()) {
                if (!first) sb.append(",");
                first = false;
                sb.append("{\"id\":").append(jsonString(d.id))
                        .append(",\"name\":").append(jsonString(d.name))
                        .append(",\"url\":").append(jsonString(d.url))
                        .append(",\"type\":").append(jsonString(d.type))
                        .append(",\"sizeBytes\":").append(d.sizeBytes)
                        .append(",\"downloaded\":").append(d.downloaded)
                        .append(",\"progress\":").append(d.progress)
                        .append(",\"status\":").append(jsonString(d.status))
                        .append(",\"speed\":").append(jsonString(d.speed))
                        .append(",\"fileName\":").append(jsonString(d.fileName))
                        .append(",\"downloadUrl\":")
                        .append(jsonString("/api/downloads/file?id=" + d.id))
                        .append(",\"createdAt\":").append(jsonString(d.createdAt))
                        .append(",\"errorMsg\":").append(jsonString(d.errorMsg))
                        .append("}");
            }
        }
        sb.append("]}");
        json(sb.toString(), out, keepAlive);
    }

    private void handleDownloadStart(String method, String query, byte[] body, OutputStream out,
                                     boolean keepAlive) throws IOException {
        String url = queryParam(query, "url");
        String name = queryParam(query, "name");
        String type = queryParam(query, "type");
        if (body != null) {
            String text = new String(body, UTF8);
            if (url == null || url.isEmpty()) url = jsonField(text, "url");
            if (name == null || name.isEmpty()) name = jsonField(text, "name");
            if (type == null || type.isEmpty()) type = jsonField(text, "type");
        }
        if (url == null || url.trim().isEmpty()) {
            json("{\"ok\":false,\"error\":\"missing url\"}", out, keepAlive);
            return;
        }
        url = url.trim();

        Download d = new Download();
        d.id = "dl-" + System.currentTimeMillis();
        d.url = url;
        d.type = (type == null || type.isEmpty()) ? guessType(url) : type;
        d.name = (name == null || name.trim().isEmpty()) ? fileNameOf(url) : name.trim();
        d.fileName = safeFileName(d.name);
        d.createdAt = String.valueOf(System.currentTimeMillis());
        synchronized (downloads) {
            downloads.put(d.id, d);
        }

        final Download item = d;
        pool.execute(new Runnable() {
            @Override
            public void run() {
                runDownload(item);
            }
        });

        json("{\"ok\":true,\"item\":{\"id\":\"" + item.id + "\"}}", out, keepAlive);
    }

    private void runDownload(Download d) {
        HttpURLConnection conn = null;
        InputStream src = null;
        OutputStream file = null;
        try {
            File dir = ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (dir == null) dir = new File(ctx.getFilesDir(), "downloads");
            if (!dir.exists() && !dir.mkdirs()) throw new IOException("cannot create dir");
            File outFile = new File(dir, d.fileName);
            d.filePath = outFile.getAbsolutePath();

            conn = (HttpURLConnection) new URL(d.url).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setRequestProperty("User-Agent", UA);
            conn.connect();
            d.sizeBytes = conn.getContentLength();
            src = conn.getInputStream();
            file = new FileOutputStream(outFile);

            byte[] buf = new byte[64 * 1024];
            long last = System.currentTimeMillis();
            long lastBytes = 0;
            int read;
            while ((read = src.read(buf)) > 0) {
                file.write(buf, 0, read);
                d.downloaded += read;
                long now = System.currentTimeMillis();
                if (now - last > 700) {
                    double kbps = (d.downloaded - lastBytes) / 1024.0 / ((now - last) / 1000.0);
                    d.speed = String.format(Locale.US, "%.0f KB/s", kbps);
                    last = now;
                    lastBytes = d.downloaded;
                }
                if (d.sizeBytes > 0) {
                    d.progress = (int) Math.min(99, (d.downloaded * 100) / d.sizeBytes);
                }
            }
            file.flush();
            file.close();
            file = null;
            d.progress = 100;
            d.status = "completed";
            if (d.sizeBytes <= 0) d.sizeBytes = d.downloaded;
            Log.i(TAG, "download completed: " + d.fileName);
        } catch (Throwable t) {
            d.status = "failed";
            d.errorMsg = t.getMessage() == null ? "download failed" : t.getMessage();
            Log.w(TAG, "download failed: " + d.url, t);
        } finally {
            closeQuietly(src);
            closeQuietly(file);
            if (conn != null) conn.disconnect();
        }
    }

    private void handleDownloadDelete(String query, OutputStream out, boolean keepAlive)
            throws IOException {
        String id = queryParam(query, "id");
        boolean ok = false;
        synchronized (downloads) {
            Download d = downloads.remove(id);
            if (d != null) {
                ok = true;
                try {
                    if (d.filePath != null && !d.filePath.isEmpty()) new File(d.filePath).delete();
                } catch (Throwable ignored) {
                }
            }
        }
        json("{\"ok\":" + ok + "}", out, keepAlive);
    }

    private void handleDownloadFile(String query, OutputStream out, boolean keepAlive)
            throws IOException {
        String id = queryParam(query, "id");
        Download d = null;
        synchronized (downloads) {
            d = downloads.get(id);
        }
        if (d == null || d.filePath == null || d.filePath.isEmpty()) {
            notFound(out, keepAlive);
            return;
        }
        File f = new File(d.filePath);
        if (!f.exists()) {
            notFound(out, keepAlive);
            return;
        }
        byte[] data = readFile(f);
        Map<String, String> extra = new HashMap<String, String>();
        extra.put("Accept-Ranges", "bytes");
        respond(200, mimeOf(d.fileName), data, out, keepAlive, extra);
    }

    private static String guessType(String url) {
        String u = url.toLowerCase(Locale.US);
        if (u.endsWith(".apk")) return "apk";
        if (u.endsWith(".mp4") || u.endsWith(".mkv") || u.endsWith(".webm") || u.endsWith(".avi")) {
            return "movie";
        }
        return "file";
    }

    private static String fileNameOf(String url) {
        try {
            String p = new URL(url).getPath();
            String n = p.substring(p.lastIndexOf('/') + 1);
            if (n.isEmpty()) n = "download";
            return n;
        } catch (Throwable t) {
            return "download";
        }
    }

    private static String safeFileName(String name) {
        String n = name == null ? "download" : name.trim();
        n = n.replaceAll("[\\\\/:*?\"<>|]", "_");
        if (n.isEmpty()) n = "download";
        if (n.length() > 80) n = n.substring(n.length() - 80);
        return n;
    }

    /* ------------------------------------------------------------------ */
    /* helpers                                                               */
    /* ------------------------------------------------------------------ */

    private String readRaw(String name) {
        try {
            int id = ctx.getResources().getIdentifier(name, "raw", ctx.getPackageName());
            if (id == 0) return "";
            InputStream is = ctx.getResources().openRawResource(id);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            copy(is, bos);
            closeQuietly(is);
            return new String(bos.toByteArray(), UTF8);
        } catch (Throwable t) {
            Log.w(TAG, "raw resource " + name + " missing", t);
            return "";
        }
    }

    private static String queryParam(String query, String key) {
        if (query == null || query.isEmpty()) return null;
        for (String part : query.split("&")) {
            int eq = part.indexOf('=');
            if (eq <= 0) continue;
            if (part.substring(0, eq).equals(key)) {
                try {
                    return URLDecoder.decode(part.substring(eq + 1), "UTF-8");
                } catch (Throwable t) {
                    return part.substring(eq + 1);
                }
            }
        }
        return null;
    }

    /** Accepts a plain URL or a base64url encoded one (both are used by the UI). */
    private static String decodeParam(String value) {
        if (value == null || value.isEmpty()) return "";
        if (value.startsWith("http://") || value.startsWith("https://")) return value;
        try {
            String b64 = value.replace('-', '+').replace('_', '/');
            while (b64.length() % 4 != 0) b64 += "=";
            byte[] data = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
            String s = new String(data, UTF8);
            if (s.startsWith("http://") || s.startsWith("https://")) return s;
        } catch (Throwable ignored) {
        }
        return value;
    }

    private static String jsonField(String json, String key) {
        if (json == null) return null;
        Matcher m = Pattern.compile("\""
                + Pattern.quote(key) + "\"\\s*:\\s*\"([^\"]*)\"").matcher(json);
        if (m.find()) {
            try {
                return m.group(1).replace("\\/", "/").replace("\\\"", "\"");
            } catch (Throwable ignored) {
            }
        }
        return null;
    }

    private static String hostOf(String url) {
        try {
            String h = new URL(url).getHost();
            return h == null ? "" : h;
        } catch (Throwable t) {
            return "";
        }
    }

    private static String absolute(String base, String loc) {
        try {
            return new URL(new URL(base), loc).toString();
        } catch (Throwable t) {
            return loc;
        }
    }

    private static String toYouTubeEmbed(String url) {
        Matcher m = Pattern.compile(
                "(?:youtube(?:-nocookie)?\\.com/(?:watch\\?(?:.*&)?v=|embed/|shorts/|live/|v/)|youtu\\.be/)([a-zA-Z0-9_-]{11})",
                Pattern.CASE_INSENSITIVE).matcher(url);
        if (!m.find()) return null;
        return "https://www.youtube-nocookie.com/embed/" + m.group(1)
                + "?autoplay=1&rel=0&playsinline=1";
    }

    private static byte[] fetchBytes(String url, int timeoutMs) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("User-Agent", UA);
            conn.setRequestProperty("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8");
            conn.setRequestProperty("Accept-Encoding", "gzip");
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return null;
            InputStream is = conn.getInputStream();
            if ("gzip".equalsIgnoreCase(conn.getContentEncoding())) {
                is = new GZIPInputStream(is);
            }
            byte[] data = readAll(is, null);
            return (data != null && data.length > 0) ? data : null;
        } catch (Throwable t) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static byte[] readAll(InputStream is, String contentEncoding) throws IOException {
        if (is == null) return new byte[0];
        InputStream src = is;
        if ("gzip".equalsIgnoreCase(contentEncoding)) {
            try {
                src = new GZIPInputStream(is);
            } catch (Throwable ignored) {
                src = is;
            }
        }
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[32 * 1024];
        int n;
        while ((n = src.read(buf)) > 0) {
            bos.write(buf, 0, n);
            if (bos.size() > MAX_BODY) break;
        }
        closeQuietly(src);
        return bos.toByteArray();
    }

    private static byte[] readFile(File f) throws IOException {
        InputStream is = new java.io.FileInputStream(f);
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        copy(is, bos);
        closeQuietly(is);
        return bos.toByteArray();
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        if (in == null) return;
        byte[] buf = new byte[32 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
        }
    }

    private static void closeQuietly(Object c) {
        if (c instanceof InputStream) {
            try {
                ((InputStream) c).close();
            } catch (Throwable ignored) {
            }
        } else if (c instanceof OutputStream) {
            try {
                ((OutputStream) c).close();
            } catch (Throwable ignored) {
            }
        }
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') bos.write(c);
            if (bos.size() > 8192) break;
        }
        if (c == -1 && bos.size() == 0) return null;
        return new String(bos.toByteArray(), UTF8);
    }

    private static byte[] readFully(InputStream in, int n) throws IOException {
        byte[] buf = new byte[n];
        int read = 0;
        while (read < n) {
            int r = in.read(buf, read, n - read);
            if (r < 0) break;
            read += r;
        }
        if (read == n) return buf;
        byte[] out = new byte[read];
        System.arraycopy(buf, 0, out, 0, read);
        return out;
    }

    private static void json(String body, OutputStream out, boolean keepAlive) throws IOException {
        respond(200, "application/json; charset=utf-8", body.getBytes(UTF8), out, keepAlive);
    }

    private static void jsonStatus(int code, String body, OutputStream out, boolean keepAlive)
            throws IOException {
        respond(code, "application/json; charset=utf-8", body.getBytes(UTF8), out, keepAlive);
    }

    /**
     * Server-sent events for the live online/offline badges.
     *
     * The stream stays open with a heartbeat comment, so the browser never
     * enters the "reconnect every 3 seconds" loop that a plain 404 would
     * trigger.
     */
    private void streamStatus(OutputStream out) throws IOException {
        String head = "HTTP/1.1 200 OK\r\n"
                + "Content-Type: text/event-stream; charset=utf-8\r\n"
                + "Cache-Control: no-cache, no-transform\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Connection: close\r\n"
                + "\r\n";
        out.write(head.getBytes(UTF8));
        out.write("event: snapshot\ndata: {}\n\n".getBytes(UTF8));
        out.flush();
        while (running) {
            try {
                Thread.sleep(15000);
            } catch (InterruptedException e) {
                throw new IOException("stream closed");
            }
            try {
                out.write(": ping\n\n".getBytes(UTF8));
                out.flush();
            } catch (IOException e) {
                throw new IOException("stream closed");
            }
        }
        throw new IOException("stream closed");
    }

    private static void notFound(OutputStream out, boolean keepAlive) throws IOException {
        respond(404, "text/plain; charset=utf-8", "not found".getBytes(UTF8), out, keepAlive);
    }

    private static void redirect(int code, String location, OutputStream out, boolean keepAlive)
            throws IOException {
        byte[] body = new byte[0];
        String head = "HTTP/1.1 " + code + " " + (code == 307 ? "Temporary Redirect" : "Found") + "\r\n"
                + "Location: " + location + "\r\n"
                + "Content-Length: 0\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Connection: " + (keepAlive ? "keep-alive" : "close") + "\r\n"
                + "\r\n";
        out.write(head.getBytes(UTF8));
    }

    private static void errorPage(OutputStream out, boolean keepAlive, String title, String detail,
                                  String target) throws IOException {
        String html = "<!doctype html><html><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<title>" + escapeHtml(title) + "</title><style>"
                + "*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;"
                + "align-items:center;justify-content:center;background:#080c14;color:#e6edf6;"
                + "font-family:system-ui,-apple-system,'Segoe UI',sans-serif;padding:40px}"
                + ".card{max-width:620px;width:100%;background:rgba(18,28,44,.82);"
                + "border:1px solid rgba(120,170,255,.22);border-radius:22px;padding:32px 28px;"
                + "box-shadow:0 24px 60px rgba(0,0,0,.5)}"
                + ".badge{display:inline-block;padding:6px 14px;border-radius:999px;"
                + "background:rgba(56,189,248,.14);border:1px solid rgba(56,189,248,.4);"
                + "color:#7dd3fc;font-size:12px;font-weight:700;letter-spacing:.14em}"
                + "h1{margin:18px 0 10px;font-size:26px}p{margin:0 0 18px;color:#9fb3c8;"
                + "line-height:1.6;font-size:15px}code{display:block;margin:0;padding:10px 12px;"
                + "border-radius:10px;background:rgba(0,0,0,.35);color:#8fb6d9;font-size:12px;"
                + "word-break:break-all}"
                + "</style></head><body><div class=\"card\">"
                + "<span class=\"badge\">VYORA TV BROWSER</span>"
                + "<h1>" + escapeHtml(title) + "</h1>"
                + "<p>" + escapeHtml(detail) + "</p>"
                + "<code>" + escapeHtml(target == null ? "" : target) + "</code>"
                + "</div></body></html>";
        respond(200, "text/html; charset=utf-8", html.getBytes(UTF8), out, keepAlive);
    }

    private static void respond(int code, String contentType, byte[] body, OutputStream out,
                                boolean keepAlive) throws IOException {
        respond(code, contentType, body, out, keepAlive, null);
    }

    private static void respond(int code, String contentType, byte[] body, OutputStream out,
                                boolean keepAlive, Map<String, String> extra) throws IOException {
        StringBuilder head = new StringBuilder();
        head.append("HTTP/1.1 ").append(code).append(' ')
                .append(code == 200 ? "OK" : code == 404 ? "Not Found" : "OK").append("\r\n");
        head.append("Content-Type: ").append(contentType).append("\r\n");
        head.append("Content-Length: ").append(body == null ? 0 : body.length).append("\r\n");
        head.append("Access-Control-Allow-Origin: *\r\n");
        if (extra != null) {
            for (Map.Entry<String, String> e : extra.entrySet()) {
                head.append(e.getKey()).append(": ").append(e.getValue()).append("\r\n");
            }
        }
        head.append("Connection: ").append(keepAlive ? "keep-alive" : "close").append("\r\n");
        head.append("\r\n");
        out.write(head.toString().getBytes(UTF8));
        if (body != null && body.length > 0) out.write(body);
    }
}
