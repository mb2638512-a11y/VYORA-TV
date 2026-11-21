package com.vyora.tv;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.SurfaceView;
import android.view.View;

import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

/**
 * Media3 live-TV player with bounded parallel source selection.
 *
 * At most two candidates are prepared at once. The first candidate to become
 * READY wins; the other player is released immediately. This avoids serial
 * dead-source delays without flooding a constrained connection with every
 * source in a channel.
 */
public class TvPlayer {

    private static final String TAG = "VyoraPlayer";
    private static final long READY_TIMEOUT_MS = 6000;
    private static final int MAX_PARALLEL_CANDIDATES = 2;

    private final Context ctx;
    private final SurfaceView surfaceView;
    private ExoPlayer player;
    private boolean active = false;
    private boolean winnerChosen = false;

    private String[] urls = new String[0];
    private String[] referers = new String[0];
    private String[] uas = new String[0];
    private int nextCandidateIndex = 0;
    private int activeAttempts = 0;
    private long playbackStartedAt;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<Integer, ExoPlayer> pendingPlayers = new HashMap<>();
    private final Map<Integer, Runnable> readyWatchdogs = new HashMap<>();

    public TvPlayer(Context ctx, SurfaceView surfaceView) {
        this.ctx = ctx;
        this.surfaceView = surfaceView;
    }

    public boolean isActive() {
        return active;
    }

    public void play(final String url, final String referer, final String ua) {
        if (url == null || url.isEmpty()) return;
        play(new String[]{url}, new String[]{referer}, new String[]{ua});
    }

    /** Start up to two sources together; first READY candidate becomes active. */
    public void play(String[] candidateUrls, String[] candidateReferers, String[] candidateUas) {
        if (candidateUrls == null || candidateUrls.length == 0) return;
        release();
        urls = candidateUrls.clone();
        referers = candidateReferers != null ? candidateReferers.clone() : new String[0];
        uas = candidateUas != null ? candidateUas.clone() : new String[0];
        nextCandidateIndex = 0;
        activeAttempts = 0;
        winnerChosen = false;
        active = false;
        playbackStartedAt = SystemClock.elapsedRealtime();
        startMoreCandidates();
    }

    private void startMoreCandidates() {
        if (winnerChosen) return;
        while (activeAttempts < MAX_PARALLEL_CANDIDATES && nextCandidateIndex < urls.length) {
            final int index = nextCandidateIndex++;
            startCandidate(index);
        }
        if (activeAttempts == 0 && nextCandidateIndex >= urls.length && !winnerChosen) {
            active = false;
            Log.w(TAG, "all sources exhausted after " +
                    (SystemClock.elapsedRealtime() - playbackStartedAt) + "ms");
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
                            .setConnectTimeoutMs(6000)
                            .setReadTimeoutMs(12000);

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
            DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                    .setBufferDurationsMs(1500, 15000, 800, 1500)
                    .setPrioritizeTimeOverSizeThresholds(true)
                    .setTargetBufferBytes(8 * 1024 * 1024)
                    .build();

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
                    candidateFailed(index, candidatePlayer);
                }

                @Override
                public void onRenderedFirstFrame() {
                    if (player == candidatePlayer) {
                        Log.i(TAG, "FIRST_FRAME source=" + index + " total_ms=" +
                                (SystemClock.elapsedRealtime() - playbackStartedAt));
                    }
                }
            });

            Runnable watchdog = new Runnable() {
                @Override
                public void run() {
                    if (!winnerChosen && pendingPlayers.get(index) == candidatePlayer) {
                        Log.w(TAG, "source " + index + " READY timeout after " +
                                READY_TIMEOUT_MS + "ms");
                        candidateFailed(index, candidatePlayer);
                    }
                }
            };
            readyWatchdogs.put(index, watchdog);
            main.postDelayed(watchdog, READY_TIMEOUT_MS);

            // Prepare in parallel, but do not start audio/video until a winner
            // is selected and attached to the visible surface.
            candidatePlayer.setPlayWhenReady(false);
            candidatePlayer.setMediaItem(MediaItem.fromUri(url));
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
            startMoreCandidates();
        }
    }

    private void chooseWinner(int index, ExoPlayer winningPlayer) {
        if (winnerChosen || pendingPlayers.get(index) != winningPlayer) return;
        winnerChosen = true;
        cancelWatchdog(index);
        pendingPlayers.remove(index);
        activeAttempts = Math.max(0, activeAttempts - 1);

        player = winningPlayer;
        try {
            player.setVideoSurfaceView(surfaceView);
            player.setPlayWhenReady(true);
            active = true;
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

        releasePendingCandidates();
    }

    private void candidateFailed(int index, ExoPlayer failedPlayer) {
        if (winnerChosen || pendingPlayers.get(index) != failedPlayer) return;
        pendingPlayers.remove(index);
        activeAttempts = Math.max(0, activeAttempts - 1);
        cancelWatchdog(index);
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
