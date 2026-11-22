package com.vyora.tv;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.content.SharedPreferences;
import android.util.Log;
import android.view.SurfaceView;
import android.view.View;

import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.upstream.DefaultBandwidthMeter;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.security.MessageDigest;

/**
 * Media3 live-TV player with bounded parallel source selection.
 *
 * At most two candidates are prepared at once, with a stagger to protect slow links. The first candidate to become
 * READY wins; the other player is released immediately. This avoids serial
 * dead-source delays without flooding a constrained connection with every
 * source in a channel.
 */
public class TvPlayer {

    public interface PlaybackListener {
        void onFirstFrame(String url, long startupMs);
        void onSourceFailed(String url, long elapsedMs);
        void onAllSourcesFailed();
    }

    private static final String TAG = "VyoraPlayer";
    private static final long READY_TIMEOUT_MS = 15000;
    private static final long FIRST_FRAME_TIMEOUT_MS = 20000;
    private static final int MAX_PARALLEL_CANDIDATES = 2;

    private final Context ctx;
    private final SurfaceView surfaceView;
    private ExoPlayer player;
    private boolean active = false;
    private boolean winnerChosen = false;
    private int lastNotifiedSourceIndex = -1;
    private boolean failureNotified = false;
    private PlaybackListener playbackListener;

    private String[] urls = new String[0];
    private String[] referers = new String[0];
    private String[] uas = new String[0];
    private int nextCandidateIndex = 0;
    private int activeAttempts = 0;
    private long playbackStartedAt;
    private Runnable firstFrameWatchdog;
    private Runnable staggeredCandidateStart;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final DefaultBandwidthMeter bandwidthMeter;
    private final SharedPreferences streamPreferences;
    private String candidateSetKey = "";
    private volatile long lastBandwidthSampleAt;
    private final Map<Integer, ExoPlayer> pendingPlayers = new HashMap<>();
    private final Map<Integer, Runnable> readyWatchdogs = new HashMap<>();

    public TvPlayer(Context ctx, SurfaceView surfaceView) {
        this.ctx = ctx;
        this.surfaceView = surfaceView;
        this.bandwidthMeter = DefaultBandwidthMeter.getSingletonInstance(ctx);
        this.streamPreferences = ctx.getApplicationContext().getSharedPreferences("vyora_stream_health", Context.MODE_PRIVATE);
        this.bandwidthMeter.addEventListener(main, (elapsedMs, bytes, bitrate) -> {
            lastBandwidthSampleAt = SystemClock.elapsedRealtime();
            Log.d(TAG, "bandwidth sample kbps=" + (bitrate / 1000));
        });
    }

    public boolean isActive() {
        return active;
    }

    public void setPlaybackListener(PlaybackListener listener) {
        this.playbackListener = listener;
    }

    /** Returns a real Media3 throughput estimate; zero until bytes were measured. */
    public String networkInfoJson() {
        long now = SystemClock.elapsedRealtime();
        long sampleAge = lastBandwidthSampleAt == 0 ? Long.MAX_VALUE : now - lastBandwidthSampleAt;
        long bitsPerSecond = bandwidthMeter.getBitrateEstimate();
        boolean measured = lastBandwidthSampleAt > 0 && sampleAge < 30000 && bitsPerSecond > 0;
        int kbps = measured ? (int) Math.min(Integer.MAX_VALUE, bitsPerSecond / 1000) : 0;
        String quality;
        int maxLevel;
        if (!measured) {
            quality = "auto"; maxLevel = 0;
        } else if (kbps >= 30000) {
            quality = "2160p"; maxLevel = 2160;
        } else if (kbps >= 16000) {
            quality = "1440p"; maxLevel = 1440;
        } else if (kbps >= 8000) {
            quality = "1080p"; maxLevel = 1080;
        } else if (kbps >= 3500) {
            quality = "720p"; maxLevel = 720;
        } else if (kbps >= 1600) {
            quality = "480p"; maxLevel = 480;
        } else {
            quality = "360p"; maxLevel = 360;
        }
        return "{\"kbps\":" + kbps + ",\"quality\":\"" + quality +
                "\",\"maxLevel\":" + maxLevel + ",\"measured\":" + measured +
                ",\"sampleAgeMs\":" + (sampleAge == Long.MAX_VALUE ? -1 : sampleAge) + "}";
    }

    public void play(final String url, final String referer, final String ua) {
        if (url == null || url.isEmpty()) return;
        play(new String[]{url}, new String[]{referer}, new String[]{ua});
    }

    /** Start with one source, then stagger one alternate if the first is slow. */
    public void play(String[] candidateUrls, String[] candidateReferers, String[] candidateUas) {
        if (candidateUrls == null || candidateUrls.length == 0) return;
        release();
        urls = candidateUrls.clone();
        referers = candidateReferers != null ? candidateReferers.clone() : new String[0];
        uas = candidateUas != null ? candidateUas.clone() : new String[0];
        candidateSetKey = buildCandidateSetKey(urls);
        applyRememberedSourceOrder();
        nextCandidateIndex = 0;
        activeAttempts = 0;
        winnerChosen = false;
        lastNotifiedSourceIndex = -1;
        failureNotified = false;
        active = false;
        playbackStartedAt = SystemClock.elapsedRealtime();
        startMoreCandidates();
    }

    private String buildCandidateSetKey(String[] candidateUrls) {
        try {
            String[] stable = candidateUrls.clone();
            Arrays.sort(stable);
            StringBuilder joined = new StringBuilder();
            for (String value : stable) {
                if (value != null) joined.append(value).append('\n');
            }
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(joined.toString().getBytes("UTF-8"));
            StringBuilder hex = new StringBuilder();
            for (byte b : digest) hex.append(String.format("%02x", b & 0xff));
            return "source-set-" + hex.toString();
        } catch (Throwable ignored) {
            return "source-set-" + Integer.toHexString(Arrays.hashCode(candidateUrls));
        }
    }

    private void applyRememberedSourceOrder() {
        if (candidateSetKey.isEmpty()) return;
        long savedAt = streamPreferences.getLong(candidateSetKey + "-time", 0L);
        String remembered = streamPreferences.getString(candidateSetKey + "-url", null);
        if (remembered == null || savedAt == 0L ||
                System.currentTimeMillis() - savedAt > 6L * 60L * 60L * 1000L) return;
        int preferred = -1;
        for (int i = 0; i < urls.length; i++) {
            if (remembered.equals(urls[i])) {
                preferred = i;
                break;
            }
        }
        if (preferred <= 0) return;
        rotateToFront(urls, preferred);
        rotateToFront(referers, preferred);
        rotateToFront(uas, preferred);
        Log.i(TAG, "remembered healthy source promoted to first position");
    }

    private void rotateToFront(String[] values, int index) {
        if (values == null || index <= 0 || index >= values.length) return;
        String first = values[index];
        System.arraycopy(values, 0, values, 1, index);
        values[0] = first;
    }

    private void rememberSuccessfulSource(int index) {
        if (candidateSetKey.isEmpty() || index < 0 || index >= urls.length) return;
        streamPreferences.edit()
                .putString(candidateSetKey + "-url", urls[index])
                .putLong(candidateSetKey + "-time", System.currentTimeMillis())
                .apply();
    }

    private void startMoreCandidates() {
        if (winnerChosen) return;

        // Start one source immediately. Only spend bandwidth on a second
        // candidate if the first has not become READY after a short grace
        // period. If the first fails, advance immediately instead.
        if (activeAttempts == 0 && nextCandidateIndex < urls.length) {
            cancelStaggeredCandidateStart();
            startCandidate(nextCandidateIndex++);
        }

        if (!winnerChosen && activeAttempts > 0 &&
                activeAttempts < MAX_PARALLEL_CANDIDATES &&
                nextCandidateIndex < urls.length && staggeredCandidateStart == null) {
            staggeredCandidateStart = new Runnable() {
                @Override
                public void run() {
                    staggeredCandidateStart = null;
                    if (!winnerChosen && activeAttempts > 0 &&
                            activeAttempts < MAX_PARALLEL_CANDIDATES &&
                            nextCandidateIndex < urls.length) {
                        startCandidate(nextCandidateIndex++);
                    }
                }
            };
            main.postDelayed(staggeredCandidateStart, 450);
        }

        if (activeAttempts == 0 && nextCandidateIndex >= urls.length && !winnerChosen) {
            active = false;
            Log.w(TAG, "all sources exhausted after " +
                    (SystemClock.elapsedRealtime() - playbackStartedAt) + "ms");
            if (!failureNotified && playbackListener != null) {
                failureNotified = true;
                playbackListener.onAllSourcesFailed();
            }
        }
    }

    private void cancelStaggeredCandidateStart() {
        if (staggeredCandidateStart != null) {
            main.removeCallbacks(staggeredCandidateStart);
            staggeredCandidateStart = null;
        }
    }

    private void startCandidate(final int index) {
        final String url = urls[index];
        if (url == null || url.trim().isEmpty()) {
            Log.w(TAG, "source " + index + " skipped: empty URL");
            startMoreCandidates();
            return;
        }

        final long candidateStartedAt = SystemClock.elapsedRealtime();
        try {
            String referer = index < referers.length ? referers[index] : "";
            String ua = index < uas.length ? uas[index] : "";

            DefaultHttpDataSource.Factory httpFactory =
                    new DefaultHttpDataSource.Factory()
                            .setAllowCrossProtocolRedirects(true)
                            .setConnectTimeoutMs(8000)
                            .setReadTimeoutMs(20000)
                            .setTransferListener(bandwidthMeter);

            if (ua != null && !ua.isEmpty()) {
                httpFactory.setUserAgent(ua);
            } else {
                httpFactory.setUserAgent("Mozilla/5.0 (Linux; Android TV) AppleWebKit/537.36 Chrome/126 Safari/537.36");
            }
            if (referer != null && !referer.isEmpty()) {
                Map<String, String> headers = new HashMap<>();
                headers.put("Referer", referer);
                try {
                    Uri parsed = Uri.parse(referer);
                    if (parsed.getScheme() != null && parsed.getAuthority() != null) {
                        headers.put("Origin", parsed.getScheme() + "://" + parsed.getAuthority());
                    }
                } catch (Exception ignored) {
                }
                httpFactory.setDefaultRequestProperties(headers);
            }

            DefaultDataSource.Factory dataFactory = new DefaultDataSource.Factory(ctx, httpFactory);
            long sampleAge = lastBandwidthSampleAt == 0
                    ? Long.MAX_VALUE : SystemClock.elapsedRealtime() - lastBandwidthSampleAt;
            boolean hasRecentEstimate = sampleAge < 30000;
            long estimatedBps = bandwidthMeter.getBitrateEstimate();
            DefaultLoadControl.Builder bufferBuilder = new DefaultLoadControl.Builder()
                    .setPrioritizeTimeOverSizeThresholds(true);

            if (hasRecentEstimate && estimatedBps < 1800000) {
                // Slow line: keep a larger reserve after startup to reduce rebuffering.
                bufferBuilder.setBufferDurationsMs(2500, 30000, 1200, 3000)
                        .setTargetBufferBytes(12 * 1024 * 1024);
                Log.i(TAG, "buffer profile=slow measured_bps=" + estimatedBps);
            } else if (hasRecentEstimate && estimatedBps < 6000000) {
                // Mid-range line: balanced startup and rebuffer reserve.
                bufferBuilder.setBufferDurationsMs(2000, 24000, 1000, 2200)
                        .setTargetBufferBytes(10 * 1024 * 1024);
                Log.i(TAG, "buffer profile=balanced measured_bps=" + estimatedBps);
            } else if (hasRecentEstimate) {
                // Only use the quick-start profile when throughput was actually measured.
                bufferBuilder.setBufferDurationsMs(1500, 18000, 800, 1600)
                        .setTargetBufferBytes(8 * 1024 * 1024);
                Log.i(TAG, "buffer profile=fast measured_bps=" + estimatedBps);
            } else {
                // Unknown is not the same as fast. Use a conservative middle profile
                // until this device has a fresh throughput sample.
                bufferBuilder.setBufferDurationsMs(2000, 24000, 1000, 2400)
                        .setTargetBufferBytes(10 * 1024 * 1024);
                Log.i(TAG, "buffer profile=unknown-conservative");
            }
            DefaultLoadControl loadControl = bufferBuilder.build();

            final ExoPlayer candidatePlayer = new ExoPlayer.Builder(ctx)
                    .setMediaSourceFactory(new DefaultMediaSourceFactory(dataFactory))
                    .setLoadControl(loadControl)
                    .build();

            pendingPlayers.put(index, candidatePlayer);
            activeAttempts++;

            candidatePlayer.addListener(new Player.Listener() {
                @Override
                public void onPlaybackStateChanged(int state) {
                    if (state == Player.STATE_READY) {
                        if (pendingPlayers.get(index) == candidatePlayer) {
                            Log.i(TAG, "source " + index + " READY in " +
                                    (SystemClock.elapsedRealtime() - candidateStartedAt) + "ms");
                            chooseWinner(index, candidatePlayer);
                        }
                    }
                }

                @Override
                public void onPlayerError(PlaybackException error) {
                    Log.w(TAG, "source " + index + " failed after " +
                            (SystemClock.elapsedRealtime() - candidateStartedAt) + "ms: " +
                            error.getErrorCodeName());
                    if (player == candidatePlayer && winnerChosen) {
                        activeSourceFailed(index, candidatePlayer, "decoder/network error");
                    } else {
                        candidateFailed(index, candidatePlayer, candidateStartedAt);
                    }
                }

                @Override
                public void onRenderedFirstFrame() {
                    if (player == candidatePlayer) {
                        cancelFirstFrameWatchdog();
                        rememberSuccessfulSource(index);
                        long startupMs = SystemClock.elapsedRealtime() - playbackStartedAt;
                        Log.i(TAG, "FIRST_FRAME source=" + index + " total_ms=" + startupMs);
                        if (lastNotifiedSourceIndex != index && playbackListener != null) {
                            lastNotifiedSourceIndex = index;
                            playbackListener.onFirstFrame(urls[index], startupMs);
                        }
                        // Keep a prepared alternate only until the selected source
                        // proves it can render. Once the first frame is visible,
                        // release the standby to return bandwidth and decoder resources.
                        releasePendingCandidates();
                    }
                }
            });

            Runnable watchdog = new Runnable() {
                @Override
                public void run() {
                    if (!winnerChosen && pendingPlayers.get(index) == candidatePlayer) {
                        Log.w(TAG, "source " + index + " READY timeout after " +
                                READY_TIMEOUT_MS + "ms");
                        candidateFailed(index, candidatePlayer, candidateStartedAt);
                    }
                }
            };
            readyWatchdogs.put(index, watchdog);
            main.postDelayed(watchdog, READY_TIMEOUT_MS);

            // Prepare in parallel, but do not start audio/video until a winner
            // is selected and attached to the visible surface.
            candidatePlayer.setPlayWhenReady(false);
            MediaItem.Builder mediaItem = new MediaItem.Builder().setUri(url);
            String lowerUrl = url.toLowerCase(java.util.Locale.US);
            if (lowerUrl.contains(".m3u8") || lowerUrl.contains("format=m3u8")) {
                mediaItem.setMimeType(MimeTypes.APPLICATION_M3U8);
            } else if (lowerUrl.contains(".mpd")) {
                // DASH needs the optional Media3 DASH module. If it is not
                // packaged, the candidate will fail quickly and fail over.
                mediaItem.setMimeType(MimeTypes.APPLICATION_MPD);
            }
            candidatePlayer.setMediaItem(mediaItem.build());
            candidatePlayer.prepare();
            Log.i(TAG, "source " + index + " preparing");
        } catch (Throwable t) {
            Log.e(TAG, "source " + index + " setup failed", t);
            ExoPlayer pending = pendingPlayers.remove(index);
            if (pending != null) {
                activeAttempts = Math.max(0, activeAttempts - 1);
                safeRelease(pending);
            }
            cancelWatchdog(index);
            if (playbackListener != null && index >= 0 && index < urls.length) {
                playbackListener.onSourceFailed(urls[index],
                        SystemClock.elapsedRealtime() - candidateStartedAt);
            }
            startMoreCandidates();
        }
    }

    private void chooseWinner(int index, ExoPlayer winningPlayer) {
        if (winnerChosen || pendingPlayers.get(index) != winningPlayer) return;
        winnerChosen = true;
        cancelStaggeredCandidateStart();
        cancelWatchdog(index);
        pendingPlayers.remove(index);
        activeAttempts = Math.max(0, activeAttempts - 1);

        player = winningPlayer;
        try {
            player.setVideoSurfaceView(surfaceView);
            player.setPlayWhenReady(true);
            active = true;
            armFirstFrameWatchdog(index, player);
            Log.i(TAG, "WINNER source=" + index + " selected_ms=" +
                    (SystemClock.elapsedRealtime() - playbackStartedAt));
        } catch (Throwable t) {
            Log.e(TAG, "winner attach failed", t);
            safeRelease(player);
            player = null;
            active = false;
            winnerChosen = false;
            startMoreCandidates();
            return;
        }

        // Do not discard a prepared standby yet. If this source reaches READY
        // but never renders a frame, the standby can take over without another
        // network round trip. It is released by onRenderedFirstFrame().
    }

    private void armFirstFrameWatchdog(final int index, final ExoPlayer target) {
        cancelFirstFrameWatchdog();
        firstFrameWatchdog = new Runnable() {
            @Override
            public void run() {
                if (player == target && winnerChosen) {
                    Log.w(TAG, "source " + index + " produced no first frame within " +
                            FIRST_FRAME_TIMEOUT_MS + "ms; failing over");
                    activeSourceFailed(index, target, "first-frame timeout");
                }
            }
        };
        main.postDelayed(firstFrameWatchdog, FIRST_FRAME_TIMEOUT_MS);
    }

    private void cancelFirstFrameWatchdog() {
        if (firstFrameWatchdog != null) {
            main.removeCallbacks(firstFrameWatchdog);
            firstFrameWatchdog = null;
        }
    }

    private void activeSourceFailed(int index, ExoPlayer failedPlayer, String reason) {
        if (player != failedPlayer || !winnerChosen) return;
        Log.w(TAG, "active source " + index + " failed: " + reason);
        if (playbackListener != null && index >= 0 && index < urls.length) {
            playbackListener.onSourceFailed(urls[index], 0L);
        }
        cancelFirstFrameWatchdog();
        player = null;
        active = false;
        winnerChosen = false;
        safeRelease(failedPlayer);
        if (promoteReadyStandby()) return;
        startMoreCandidates();
    }

    /**
     * Promote an alternate that already reached READY while the previous
     * winner was waiting for its first frame. Returns true when promoted.
     */
    private boolean promoteReadyStandby() {
        for (Map.Entry<Integer, ExoPlayer> entry : new ArrayList<>(pendingPlayers.entrySet())) {
            final int index = entry.getKey();
            final ExoPlayer standby = entry.getValue();
            if (standby == null || standby.getPlaybackState() != Player.STATE_READY) continue;

            pendingPlayers.remove(index);
            activeAttempts = Math.max(0, activeAttempts - 1);
            cancelWatchdog(index);
            winnerChosen = true;
            player = standby;
            try {
                player.setVideoSurfaceView(surfaceView);
                player.setPlayWhenReady(true);
                active = true;
                armFirstFrameWatchdog(index, standby);
                Log.i(TAG, "FAILOVER_READY source=" + index + " promoted without reprepare");
                return true;
            } catch (Throwable error) {
                Log.w(TAG, "ready standby attach failed for source " + index, error);
                player = null;
                active = false;
                winnerChosen = false;
                safeRelease(standby);
                return false;
            }
        }
        return false;
    }

    private void candidateFailed(int index, ExoPlayer failedPlayer, long candidateStartedAt) {
        // A standby can fail while another candidate is already selected as
        // winner. Always remove/release that failed standby; winnerChosen only
        // prevents starting another candidate, not cleaning up this one.
        if (pendingPlayers.get(index) != failedPlayer) return;
        pendingPlayers.remove(index);
        activeAttempts = Math.max(0, activeAttempts - 1);
        cancelWatchdog(index);
        if (playbackListener != null && index >= 0 && index < urls.length) {
            playbackListener.onSourceFailed(urls[index],
                    SystemClock.elapsedRealtime() - candidateStartedAt);
        }
        safeRelease(failedPlayer);
        startMoreCandidates();
    }

    private void cancelWatchdog(int index) {
        Runnable watchdog = readyWatchdogs.remove(index);
        if (watchdog != null) main.removeCallbacks(watchdog);
    }

    private void releasePendingCandidates() {
        for (Integer index : new ArrayList<>(pendingPlayers.keySet())) {
            cancelWatchdog(index);
            ExoPlayer pending = pendingPlayers.remove(index);
            if (pending != null) safeRelease(pending);
        }
        activeAttempts = 0;
    }

    private void safeRelease(ExoPlayer target) {
        if (target == null) return;
        try {
            target.stop();
        } catch (Throwable ignored) {
        }
        try {
            target.release();
        } catch (Throwable ignored) {
        }
    }

    private void release() {
        cancelFirstFrameWatchdog();
        cancelStaggeredCandidateStart();
        for (Integer index : new ArrayList<>(readyWatchdogs.keySet())) {
            cancelWatchdog(index);
        }
        releasePendingCandidates();
        if (player != null) {
            safeRelease(player);
            player = null;
        }
        active = false;
        winnerChosen = false;
    }

    public void pause() {
        if (player != null) player.pause();
    }

    public void resume() {
        if (player != null) player.play();
    }

    public void stop() {
        release();
        urls = new String[0];
        referers = new String[0];
        uas = new String[0];
        nextCandidateIndex = 0;
    }

    public void setVolume(float v) {
        if (player != null) player.setVolume(v);
    }

    public float getVolume() {
        if (player == null) return 1f;
        return player.getVolume();
    }

    public void showSurface(boolean visible) {
        surfaceView.setVisibility(visible ? View.VISIBLE : View.GONE);
        if (visible) surfaceView.bringToFront();
    }
}
