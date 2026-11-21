# Vyora TV

Android TV ke liye production-grade IPTV client — real duniya ke channels, real
flags, real channel logos, aur D-pad (remote) se poora control.

**14,297 channels • 180 countries • 29 themes • 21,121 stream sources**

---

## 1. Kya kya hai (What is inside)

| Feature | Detail |
|---|---|
| Real catalogue | iptv-org public directory + official `index.m3u` playlist (11,464 entries) merged |
| Real logos | 98.6% channels ka asli logo (Wikimedia, Pluto, broadcaster CDN, imgur…) |
| Real flags | 176 country flags **bundled locally** (72 KB) - koi CDN latency nahi |
| Online / Offline | Har channel ka live status: **ONLINE badge upar**, **OFFLINE badge neeche**, offline cards dim |
| Status engine | Server actually probes the playlist, proxy reports what really played, low-priority catalogue sweeper covers all 14k+ channels |
| Filters | Country (180), Theme/category (29), search, favourites, Global list |
| Quality | 720p / 1080p / 1440p (2K) / 2160p (4K) + **auto quality** (network speed ke hisaab se) |
| Remote first | Spatial D-pad navigation, OK = open, BACK = back, CH± = channel, ◀▶ = quality, **M = channel drawer** |
| Mouse ready | Hover/click on every card, on-screen keypad, player close + menu buttons |
| Channel drawer | Player ke andar sidebar: number, logo, name, quality, status - up/down se choose karein |
| Fast start | Manifest + first 3 segments prefetched & cached → picture opens instantly |
| Auto fallback | Dead/slow source pe automatically next stream try hoti hai |
| Waiting queue | Offline channel queue me daalein - har minute khud check hota hai |
| Accessibility | Audio description (TTS), focus announcements, large text, high contrast |
| Android TV | Native app (ExoPlayer/Media3 + WebView), leanback launcher, built without Gradle |
| Player selection | 10 playback options; VYORA Player is default; independent defaults for Live TV, Movies, Series and Downloads; Android external-player handoff for VLC, MX, mpv, Kodi, Nova and Just Player |

---

## 2. Folder layout

```
E:\Vyora TV
├─ package.json              # root scripts (data / build / start / apk)
├─ scripts/
│  ├─ build-data.mjs         # raw dump  -> production dataset
│  ├─ analyze-m3u.mjs        # M3U structure analysis
│  └─ stats.mjs              # logo / quality coverage report
├─ server/
│  ├─ src/
│  │  ├─ index.js            # zero-dependency Node HTTP server + API + static
│  │  ├─ config.js           # env driven configuration
│  │  └─ lib/
│  │     ├─ store.js         # dataset index, search, filters
│  │     ├─ proxy.js         # HLS proxy, playlist rewrite, DNS/segment cache
│  │     ├─ http.js          # json/gzip/cache helpers, LRU cache
│  │     └─ logger.js        # structured JSON logs
│  └─ data/                  # generated dataset (index.json + channels/*.json)
├─ web/                      # React + TS + Vite TV front-end
│  ├─ src/
│  │  ├─ App.tsx             # screens, state, remote handling
│  │  ├─ lib/{api,bridge,nav,i18n}.ts
│  │  └─ components/         # Cards, PlayerOverlay, SearchOverlay, SettingsOverlay
│  └─ public/data/           # dataset copy for the static build
├─ android/                  # native Android TV app (no Gradle)
│  ├─ app/                   # manifest, java, res
│  ├─ libs/                  # Media3/ExoPlayer AARs
│  ├─ tools/pack_apk.py
│  ├─ build-apk.ps1          # aapt2 -> javac -> d8 -> zipalign -> apksigner
│  └─ out/VyoraTV-1.0.0.apk
└─ data/raw/                 # downloaded source data (channels, streams, logos, m3u)
```

---

## 3. Run it

```powershell
cd 'E:\Vyora TV'
npm install          # sirf web ke liye (react, vite, hls.js)
npm run data         # dataset banao (pehli baar)
npm run build        # web build (dist/)
npm start            # server chalao -> http://127.0.0.1:8787
```

Ya one-click: `start-vyora.bat`

### API

| Route | Kaam |
|---|---|
| `GET /api/health` | server + dataset + health status |
| `GET /api/bootstrap` | countries, themes, totals (app ka pehla call) |
| `GET /api/top?limit=84` | top channels (sab countries) |
| `GET /api/channels?country=PK&category=news&search=geo&offset=0&limit=240` | filtered channels (paged) |
| `GET /api/channels?ids=a,b,c` | exact channels (favourites / recently watched) |
| `GET /api/channels/:id` | ek channel ki poori detail |
| `GET /api/search?q=bbc` | search |
| `GET /api/status?ids=a,b,c` | live online/offline status |
| `GET /api/status/track?ids=...` | in-view channels ko probe priority do |
| `GET /api/network` | measured bandwidth → auto quality |
| `GET /api/logo?u=<b64url>` | cached channel-logo proxy (disk cache) |
| `GET /api/proxy?u=<b64url>&r=<referer>&cid=<channelId>` | HLS/DASH proxy (CORS + headers + playlist rewrite) |
| `GET /api/prefetch?u=<b64url>` | manifest + first segments warm karo (fast start) |

---

## 4. Android TV APK

```powershell
npm run apk
```

Output: `android\out\VyoraTV-1.0.0.apk`

Build **Gradle ke baghair** hota hai — `aapt2` (resources) → `javac` → `d8`
(dex) → `zip` → `zipalign` → `apksigner`. Media3/ExoPlayer AARs `android\libs`
mein hain (Google Maven se).

TV par install:

```powershell
adb connect <tv-ip>:5555
adb install -r android\out\VyoraTV-1.0.0.apk
```

App mein:
- Leanback launcher (TV home screen par app icon)
- ExoPlayer native playback (HLS + MPEG-DASH, Referer/User-Agent support)
- Channel Up/Down key → next/previous channel
- BACK → player se nikal kar list par
- TTS se audio description (blind users ke liye)

---

## 5. Playback players

VYORA Player is the default in-platform player. Settings lets users choose a default
player and override it independently for Live TV channels, Movies, Series and
Downloads. The ten choices are VYORA Player, ExoPlayer/Media3, HLS.js, HTML5,
VLC, MX Player, mpv, Kodi, Nova Video Player and Just Player.

VLC, MX, mpv, Kodi, Nova and Just Player are external Android apps: the selected
app must already be installed. VYORA checks package availability and falls back
to its built-in player with a message when the selected app is unavailable.
The browser-only HLS.js and HTML5 choices remain in-app. External app support
depends on the app accepting the stream URL and format; device-level playback
must be verified on the target Android TV.

---
 
## 6. Data pipeline

`npm run data` yeh karta hai:

1. `data/raw/channels.json`, `streams.json`, `logos.json` (directory) padhta hai
2. `data/raw/index.m3u` (official playlist) parse karta hai —
   `tvg-logo` → asli logo, `group-title` → theme, `(1080p)` → quality,
   id suffix (`.pk`, `.us`) → country
3. Dono merge karke har channel ke streams quality-wise rank karta hai
   (HLS prefer, phir highest resolution)
4. NSWF / adult channels skip
5. `server/data/` + `web/public/data/` me JSON likhta hai

Source data refresh karne ke liye (proxy ke through):

```powershell
curl.exe -L --proxy http://127.0.0.1:8080 -o data\raw\index.m3u https://iptv-org.github.io/iptv/index.m3u
```

---

## 7. Remote (D-pad) map

| Button | Kaam |
|---|---|
| Arrows | Spatial navigation (geometry based, TV jaisa feel) |
| OK / Enter | Channel kholo / select karo |
| BACK / Esc | Ek peeche, player se list par |
| Channel Up/Down | Agla / pichla channel (player me) |
| Left/Right (player me) | Quality / source switch |
| M / Tab (player me) | Channel drawer (number, status, quality) kholo |
| 0-9 | Seedha channel number (OK = open) |
| Volume +/−, Mute | Native player |

---

## 8. Note (legal)

Catalogue sirf **publicly published free-to-air streams** ka reference hai
(iptv-org ka open directory). Kuch streams broadcaster ki side se geo-blocked ya
offline hote hain — app unhe "source unavailable" dikhata hai aur agla source
try karta hai. Apni licensed playlist (M3U) use karna ho to usse import karein.
