# ZERO//DAY — Firewall Defense Protocol

A matrix/cyberpunk pixel-art tower defense game built for phones (tuned for Pixel, portrait).
Pure HTML5 Canvas + ES modules — no build step, no dependencies at runtime. Installs as a
fullscreen, offline-capable PWA.

Everything is generated: all sprites are drawn procedurally by `tools/generate_sprites.py`
into a spritesheet atlas, and all music/SFX are synthesized live with WebAudio.

## Features

- **8 defenses × 3 upgrade levels**: Pulse Cannon, Trace Laser (ramping armor-piercing beam), ICE Node
  (AOE slow/freeze), Logic Bomb (lobbed splash + corruption burn), Arc Relay (chain lightning),
  Daemon Sniper (long range, crits, detection), Overclock Hub (fire-rate aura + radar), Crypto Miner (income).
- **10 malware types**: crawlers, fast worms, spam floods, armored Trojans that split, teleporting
  Glitches, cloaked Phantoms, healing Patchers, shield-casting Aegis Drones, the ROOTKIT boss and the
  KERNEL PANIC final boss (disables towers at 66% / 33% HP).
- **4 sectors** (20–30 waves, 1 or 2 uplinks), Normal / Hard difficulty, star ratings, unlocks, and
  **Endless** mode with best-wave records.
- **Abilities**: EMP (global stun + shield strip), PURGE (tap-to-target orbital strike), OVERCLOCK.
- Targeting modes (First / Last / Strong / Close), early wave calls for bonus bits, 1×/2×/3× speed.
- Mobile UX: tap-tap or drag-to-deploy with a ghost + range preview, haptics, screen wake lock,
  Android back-button support, auto-pause when backgrounded, run auto-save between waves.
- Juice: digital rain, data packets flowing along the bus, pixel derez deaths, explosions, screen
  shake, flashes, damage numbers, CRT scanlines (toggleable).
- Database screen (malware entries unlock when first encountered), How-to-Play, Settings.

## Run it

```bash
cd towerDefenseGame
python3 -m http.server 8642
# open http://localhost:8642
```

Add `?debug` to the URL to expose `window.__zd` and skip the service worker.

## Put it on your Pixel

A PWA can only be *installed* from a secure origin (HTTPS or `localhost`).

**A. Host it (recommended).** Upload the folder to any static HTTPS host — GitHub Pages,
Cloudflare Pages, Netlify (drag-and-drop the folder). Open the URL in Chrome on the Pixel →
⋮ menu → **Install app** (or *Add to Home screen*). It launches fullscreen in portrait and plays offline.

**B. USB, no hosting.** Enable USB debugging on the phone, plug it in, open `chrome://inspect` in
desktop Chrome → *Port forwarding* → add `8642 → localhost:8642`. On the phone open
`http://localhost:8642` and install it from the ⋮ menu.

**C. Same Wi-Fi (quick test only).** Serve with `--bind 0.0.0.0` and open `http://<PC-IP>:8642` on the
phone. Playable, but not installable/offline (plain HTTP). Under WSL2 you may need to forward the
port from Windows.

**Native APK (optional).** Once hosted, wrap it with Bubblewrap (Trusted Web Activity) or Capacitor.

## Controls

| Action | How |
| --- | --- |
| Deploy | Tap a defense in the dock, tap a dark tile, tap again to confirm — or drag it onto the map |
| Upgrade / sell / target | Tap a tower (sell asks for confirmation) |
| Send wave | START / NEXT (yellow = early call bonus) |
| Abilities | EMP, PURGE (then tap a zone), BOOST |
| Pause | ‖ button or Android back |

## Project layout

```
index.html, css/style.css      screens & HUD (DOM) + pixel UI styling
manifest.webmanifest, sw.js    PWA install + offline cache (bump VERSION in sw.js after changes)
js/main.js                     boot, main loop, menu backdrop
js/engine/                     atlas (sprites), audio (synth), save (localStorage), util
js/data/                       towers, enemies, maps, waves (+ TUNE difficulty knobs)
js/game/                       game (sim + renderer), map, tower, enemy, fx, rain
js/ui/ui.js                    menus, dock, tower panel, input, modals, tutorial
tools/generate_sprites.py      procedural pixel-art generator → assets/sprites.png/.json, icons
assets/fonts/                  VT323 + Press Start 2P (SIL Open Font License)
```

## Reskinning & tuning

- **Regenerate art**: `python3 tools/generate_sprites.py` (needs Pillow). Pass an output path to also
  write a 3× preview: `python3 tools/generate_sprites.py preview.png`.
- **Use your own spritesheets**: `assets/sprites.json` maps names → `[x, y, w, h]` and animations →
  frame lists. Keep the names (e.g. `crawler_0..3`, `base_pulse_1`, `head_pulse_1_0`, `path_0..15`)
  and swap in hand-drawn art. Tiles are 16×16; turret heads face right (they rotate at runtime).
- **Balance**: `TUNE` in `js/data/waves.js` (HP curve, wave budget, economy), per-sector `hpMul` in
  `js/data/maps.js`, tower stats in `js/data/towers.js`, malware stats in `js/data/enemies.js`.
  The defaults were tuned against a headless bot that plays without abilities.
- **New sector**: add an entry to `MAPS` (9×16 grid; `S`/`T` spawns, `C` core, `#` bus, `x` hardware).
