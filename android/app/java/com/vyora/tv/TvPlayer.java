package com.vyora.tv;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
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

import java.util.HashMap;
import java.util.Map;

/**
 * ExoPlayer (Media3) wrapper with Turbo start.
 *
 *   - several sources can be handed over at once; the first one that becomes
 *     READY wins. A dead CDN is skipped after 3.5s instead of blocking the
 *     picture for 20+ seconds.
 *   - the buffer is tuned for live TV: playback starts as soon as the first
 *     fragment is available instead of filling a big buffer.
 */
public class TvPlayer {

    private static final String TAG = "VyoraPlayer";
    private static final long READY_TIMEOUT_MS = 3500;

    private final Context ctx;
    private final SurfaceView surfaceView;
    private ExoPlayer player;
    private boolean active = false;

    private String[] urls = new String[0];
    private String[] referers = new String[0];
    private String[] uas = new String[0];
    private int candidate = 0;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Runnable readyWatchdog;

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

    /** Play the first source that answers; the rest are automatic backups. */
    public void play(String[] candidateUrls, String[] candidateReferers, String[] candidateUas) {
        if (candidateUrls == null || candidateUrls.length == 0) return;
        release();
        urls = candidateUrls;
        referers = candidateReferers != null ? candidateReferers : new String[0];
        uas = candidateUas != null ? candidateUas : new String[0];
        candidate = 0;
        startCandidate();
    }

    private void startCandidate() {
        if (candidate >= urls.length) {
            Log.w(TAG, "every source failed");
            active = false;
            return;
        }
        final String url = urls[candidate];
        final String referer = candidate < referers.length ? referers[candidate] : "";
        final String ua = candidate < uas.length ? uas[candidate] : "";

        try {
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
                    headers.put("Origin", Uri.parse(referer).getScheme() + "://" + Uri.parse(referer).getAuthority());
                } catch (Exception ignored) {
                }
                httpFactory.setDefaultRequestProperties(headers);
            }

            DefaultDataSource.Factory dataFactory = new DefaultDataSource.Factory(ctx, httpFactory);

            // Live TV tuning: start playing on the first fragment instead of
            // waiting for a big buffer to fill up.
            DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                    .setBufferDurationsMs(1500, 15000, 800, 1500)
                    .setPrioritizeTimeOverSizeThresholds(true)
                    .setTargetBufferBytes(8 * 1024 * 1024)
                    .build();

            player = new ExoPlayer.Builder(ctx)
                    .setMediaSourceFactory(new DefaultMediaSourceFactory(dataFactory))
                    .setLoadControl(loadControl)
                    .build();
            player.setVideoSurfaceView(surfaceView);
            player.setMediaItem(MediaItem.fromUri(url));
            player.addListener(new Player.Listener() {
                @Override
                public void onPlaybackStateChanged(int state) {
                    if (state == Player.STATE_READY) {
                        cancelWatchdog();
                        Log.i(TAG, "source " + candidate + " ready");
                    }
                }

                @Override
                public void onPlayerError(PlaybackException error) {
                    Log.w(TAG, "source " + candidate + " error: " + error.getErrorCodeName());
                    nextCandidate();
                }
            });
            player.prepare();
            player.play();
            active = true;

            // If this source does not become READY in time, jump to the next.
            readyWatchdog = new Runnable() {
                @Override
                public void run() {
                    if (player != null && player.getPlaybackState() != Player.STATE_READY) {
                        Log.i(TAG, "source " + candidate + " too slow, switching");
                        nextCandidate();
                    }
                }
            };
            main.postDelayed(readyWatchdog, READY_TIMEOUT_MS);
        } catch (Throwable t) {
            Log.e(TAG, "play failed", t);
            nextCandidate();
        }
    }

    private void nextCandidate() {
        cancelWatchdog();
        release();
        if (candidate + 1 < urls.length) {
            candidate++;
            startCandidate();
        } else {
            Log.w(TAG, "all sources exhausted");
            active = false;
        }
    }

    private void cancelWatchdog() {
        if (readyWatchdog != null) {
            main.removeCallbacks(readyWatchdog);
            readyWatchdog = null;
        }
    }

    private void release() {
        cancelWatchdog();
        if (player != null) {
            try {
                player.stop();
                player.release();
            } catch (Throwable ignored) {
            }
            player = null;
        }
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
        active = false;
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
