# Vyora TV — project notes

IPTV app: React/TS/Vite web UI + Android TV shell (WebView + ExoPlayer) + Go engine.

## What actually runs

| Piece | Path | Notes |
|---|---|---|
| **Live server** | `server-go/vyora-tv.exe` | The **Go** engine is what serves the app on `:8787`. |
| Legacy Node server | `server/src/` | Dev/alternative only — it is **not** the running server. |
| Web build | `web/dist` | Served by the Go engine (`-web web/dist`). |
| Android APK | `android/out/VyoraTV-1.0.0.apk` | Built by `android/build-apk.ps1` (no Gradle). |

After changing anything under `server-go/` you must **rebuild and restart the Go binary**, or the running app keeps the old behaviour:

```powershell
cd 'E:\Vyora TV\server-go'; go build -o vyora-tv.exe .
Get-CimInstance Win32_Process -Filter "Name='vyora-tv.exe'" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Process -FilePath 'E:\Vyora TV\server-go\vyora-tv.exe' -ArgumentList '-port','8787','-data','server/data','-web','web/dist' -WorkingDirectory 'E:\Vyora TV' -RedirectStandardOutput 'E:\Vyora TV\server-go\server.out.log' -RedirectStandardError 'E:\Vyora TV\server-go\server.err.log' -WindowStyle Hidden
```

## Dataset — do not shrink it

* `scripts/merge-all-playlists.mjs` builds the **full** catalogue: **14,297 channels / 21,122 streams / 180 countries**.
* `scripts/build-data.mjs` only merges the iptv-org directory + `index.m3u` → **10,378 channels**. Running it "to refresh" *loses ~4,000 channels*. Use the merge script, or edit the dataset in place.
* `scripts/build-data.mjs` still owns the `FEATURED` country list (home hero flags) and the local flag download.

## Turbo playback architecture (2026-11-15)

Goal: the channel must already be running when the user presses OK (first frame in milliseconds, never a blank screen).

* `server-go/proxy.go` — RAM cache for manifests + media segments.
  * `warmManifestLane(..., fast, withSegments)`: background lane (`warmSem`, 6 slots) vs user lane (`warmFastSem`, 4 slots); `withSegments=false` = manifest only (standby pre-warmer). Hover/focus/click use the fast lane; batch warming uses the background lane. **Never warm without a throttle** — an unthrottled burst saturates the host network and drags `/api/status` from 2 ms to 3-4 s.
  * `manifestTTLs()`: master playlist 60 s (+3 min stale), VOD 2 h, **live 2 s fresh + 15 s stale-while-revalidate** (the stale window is what makes a rolling live stream instant).
  * `fetchWithDualRace()` races **direct + tunnel** on the **first body byte**, not on headers: a route can answer with headers instantly and then stall forever (that alone cost 15 s per segment). `firstByteTimeout = 2.5 s`.
  * `RaceStreams()`: several sources of one channel are fetched in parallel, first success wins (3.5 s each).
  * `sampleBandwidth()` measures the real throughput of the media segments -> `/api/network` returns the measured kbps + the quality tier it can carry.
* `server-go/variants.go` — **dead variant pruning**. Many broadcasters publish a master playlist whose child variants are already dead; the player then burns 3 level-load attempts on 404s (this was the "Attempt 4/2 ... opens late" bug). The proxy probes the children in parallel and removes the dead ones; if all are dead it answers `502 all-variants-dead` so the client fails over to the next source at once.
* Endpoints: `/api/play?cid=` (302 → winning source), `/api/resolve/<cid>` (JSON winner), `/api/warm?ids=&depth=` (batch warm, returns in ~4 ms), `/api/network` (measured throughput).
* `web/src/components/PlayerOverlay.tsx` waits for the resolver (max 1.2 s) before starting hls.js, so the winner is loaded once instead of restarting the pipeline. The ABR estimate starts from the *measured* bandwidth (not a fixed 3 Mbps) and the stall watchdog drops straight to the lowest variant.
* `android/app/java/com/vyora/tv/TvPlayer.java` — ExoPlayer takes **all** sources of a channel (`playMulti` via `TvBridge`) and switches to the next one if the current one is not READY within 3.5 s. Buffer tuned for live (`setBufferDurationsMs(1500, 15000, 800, 1500)`).

### Measured reality on this host (2026-11-16)

The host line itself is fine (iptv-org ≈ 3359 kbps), but several broadcaster CDNs are origin-limited: `cdn4.mjunoon.tv` delivers only **~240 kbps** for the Pakistani feeds (direct and via the local proxy alike). A 1080p stream needs ~4-6 Mbps, so no app can make that smooth — the app must *adapt* (drop to 360p/240p) instead of freezing. Measure with `scripts/test-egress2.mjs` before blaming the player.


## Player UI (2026-11-16)

* `web/src/styles/player-pro.css` — the "Pro" look: glass info bar, pill badges, clean drawer (search + filter chips + footer hints). Imported after `styles.css` so it wins on specificity/order.
* The drawer is **virtualised**: `DRAWER_ROW_H = 52` and only a window of rows is rendered (`drawerWindow` in `PlayerOverlay.tsx`). Rendering all 2000 channels of a country froze the screen. The drawer also **auto-scrolls to the channel that is playing** and keeps the highlighted row in view while arrowing.
* The loading line reads `Connecting to live broadcast... • 720p (2/2)` — never a hardcoded `/2` denominator (that produced "Attempt 4/2").

## Build commands

```powershell
cd 'E:\Vyora TV\web'; npm run build                                  # web bundle
powershell -NoProfile -ExecutionPolicy Bypass -File 'E:\Vyora TV\android\build-apk.ps1' -MinSdk 24
```

## Verification scripts

`scripts/test-turbo.ps1`, `scripts/test-prebuffer.ps1`, `scripts/test-final.ps1` — measure race latency, RAM-cache hits (`X-Vyora-Cache: HIT`) and UI latency under load.
