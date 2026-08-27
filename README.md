# Digi Pocketeers

**A cutesy, candy-colored tribute to classic Tomy Pocketeers handheld games, reborn for your phone.**

[![Play now](https://img.shields.io/badge/play-digi%20pocketeers-ff3d81?style=for-the-badge)](https://idltd.github.io/digi-pocketeers/)
[![Games](https://img.shields.io/badge/games-8%20solo%20%2B%203%20multiplayer-00e5ff)](#whats-in-the-box)
[![PWA](https://img.shields.io/badge/PWA-offline--capable-7cff6b)](#architecture)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-b69cff)](LICENSE)

Tomy's originals (sold in the UK as "Pocketeers", in the US as "Pocket Games") were
mostly mechanical ball-bearing toys played by physically tilting the unit — which maps
almost 1:1 onto a phone's accelerometer/gyroscope, so tilt is used here as a real
control scheme, not bolted on for novelty. All code, art, and audio are original;
nothing is copied from Tomy's products. This is a personal, non-commercial fan tribute,
not an official Tomy product.

**[Open the live app →](https://idltd.github.io/digi-pocketeers/)**

## What's in the box

One hub app, eight solo games and three multiplayer modes, all sharing the same
rendering/audio/input engine:

| Game | Mechanic | Control | MP |
| --- | --- | --- | --- |
| Amazing Maze | Roll a ball through a procedurally generated maze to the goal, avoiding trap holes, against a timer | Tilt | |
| Secret Passage | Same maze engine, but fog-of-war hides everything outside a small radius around the ball; a faint compass points toward the goal | Tilt | |
| Pocket Pachinko | Drop a ball through a peg field into scoring pockets — edges pay more than the easy center drain | Tilt | |
| Derby | Endless-runner style race, dodging obstacles, with a tap-to-dash boost | Tilt + tap | |
| Target Range | Targets pop up and expire; tap them before they vanish | Tap | |
| Targets (Own) | Each player's phone runs its own target range simultaneously; highest score wins | Tap | Race |
| Targets (Shared) | All players tap the same targets on every screen; first to hit scores the point | Tap | Custom |
| Baseball | Pitches fall down the screen; swipe at the right moment to hit | Swipe | |
| Pocket Slot | Three-reel fruit machine, spend credits to spin | Tap | |
| Racing Pigs | Pick a pig; lanes of pigs waddle-stop-snort their way up the screen at random, first to the line wins | Tap to pick | Custom |

## Architecture

- Pure vanilla JS, ES6 modules, no build step, no dependencies.
- Canvas resolution is 240 wide, height computed from the actual device's aspect
  ratio at load time (clamped to a sane range) so `object-fit: contain` doesn't
  letterbox the game on phone screens much taller/narrower than a fixed 3:4 box.
  Rendered at a HiDPI backing resolution (device pixel ratio, capped at 3x) so
  text and shapes stay crisp instead of nearest-neighbor upscaled.
- All graphics are drawn procedurally on canvas — no image assets except the
  generated PWA icons. Text is rendered with a real font (Google Fonts "Fredoka",
  a rounded playful face matching the candy palette) rather than a bitmap font. A
  shared particle system and screen-shake give hits/wins some juice.
- All audio is procedural (Web Audio API oscillators/noise), no sound files.
- Progressive Web App: `manifest.json` + `sw.js` (cache-first, offline-capable).

```text
digi-pocketeers/
├── js/core/       # shared engine: constants (incl. the candy color palette),
│                  # renderer (+ particles, screen shake), audio, input
│                  # (touch/tap/swipe + tilt with iOS permission handling and a
│                  # drag-to-steer fallback), storage (localStorage high scores),
│                  # multiplayer.js (session/lobby), net.js (WebSocket relay
│                  # transport), hostphone.js (Android host-app bridge),
│                  # hub.js (title screen + game switcher + loop)
├── js/games/      # one file per game, registered in index.js
├── css/style.css, index.html, manifest.json, sw.js, generate-icons.js
```

### Adding or removing a game

Each game is a self-contained class (`enter/update/render`) that only talks to the
shared `core/` singletons — games never reference each other. To add one: drop a new
file in `js/games/`, add one entry to `GAME_LIST` in `js/core/constants.js` (id, title,
subtitle, whether it uses tilt), and one line in the `BUILT` map in `js/games/index.js`.
To remove one: delete the file and its two entries. Anything listed in `GAME_LIST` but
not yet in `BUILT` shows an automatic "coming soon" placeholder instead of breaking the
hub.

### Tilt input notes

- Device orientation/motion sensors are gated behind a **secure context** in modern
  browsers (Chrome and Safari alike) — tilt silently does nothing over plain `http://`
  on a LAN. It works over `https://` or `localhost`. The tilt-permission screen shows a
  live "SECURE PAGE: YES/NO" diagnostic so this is obvious instead of looking like a
  broken control.
- **Brave browser blocks Motion Sensors by default, per-site, with no permission
  prompt at all.** `chrome://settings/content/sensors` (or search Settings for
  "Motion sensors") — if it's set to "Not allowed" for the site, `deviceorientation`
  events never fire and `DeviceOrientationEvent.requestPermission()` (where it exists)
  still resolves "granted", so nothing in the web platform API surface signals that
  anything is wrong. This was the actual root cause the one time tilt "didn't work"
  despite HTTPS and a correct permission flow. `input.js` now tracks
  `tiltEventReceived` (set the first time a `deviceorientation` event actually fires)
  and the in-game HUD swaps its tilt-value readout for "TILT BLOCKED - CHECK SITE
  PERMS" if permission reports granted but ~1.5s pass with zero events received.
- iOS 13+ additionally requires an explicit user-gesture permission prompt for
  `DeviceOrientationEvent`; the hub shows a one-time "tap to allow tilt" screen before
  entering any tilt-based game, with a fallback ("tap here to use drag-to-steer
  instead") for when permission is denied or the device has no gyroscope (e.g. desktop
  testing).
- `navigator.vibrate()` (used for hit/collision haptics) works on Android Chrome but is
  not supported by iOS Safari — it silently no-ops there.
- `display: fullscreen` in the manifest only applies once the app is added to the home
  screen; opened as a plain browser tab it always shows browser chrome. The hub's `[ ]`
  icon (top right of the title screen) calls the Fullscreen API and attempts a
  portrait orientation lock as a same-session alternative.
- Tilting the phone to play is exactly the motion that can trigger an OS-level screen
  rotation, so the hub shows a one-time dismissible tip suggesting auto-rotate be
  turned off.

## Running it

```text
00-startup.bat          # Windows: serves the app at http://localhost:8080
```

or manually: `npx http-server -p 8080`, then open the printed URL. To regenerate the
PWA icons after changing `generate-icons.js`, run `node generate-icons.js`. Tilt games
need a secure context (see above) — plain `http://` on a LAN won't drive the sensors,
so use the deployed `https://idltd.github.io/digi-pocketeers/` build or a local HTTPS
tunnel for full testing.

## Multiplayer

The host phone's Android app creates a Wi-Fi access point and runs a WebSocket relay
(plain `http://`, no internet required). Guests scan the host's QR code to join — no
install, no typing, just a browser tab on the hotspot.

The host is authoritative for all shared state. Guests send intents ("I pick lane 3",
"I tapped here") and render whatever the host broadcasts. This keeps cheating
impossible and means new games ship without an APK rebuild — all code arrives over
the wire.

Four multiplayer modes are defined; a game declares which it supports:

- **Turns** — one shared state, screen passes round the table.
- **Race** — everyone plays simultaneously on their own device, best outcome wins.
- **Mega** — simultaneous play where you can see everyone's screen.
- **Custom** — bespoke per-game logic (Racing Pigs picking, Shared Targets).

Currently implemented: Racing Pigs (Custom), Targets Own (Race), Targets Shared
(Custom).

### Mixed-device groups

Devices report their canvas height to the host on connect. The host uses the
minimum across all players, so game fields (pig race tracks, target ranges) are
sized to fit every screen — a tablet joining a group of phones shrinks the field
rather than rendering content off-screen.

## Future work

- **More multiplayer modes**: Turns and Mega are defined but not yet used by any game.
- **iOS verification**: tilt-permission flow and touch-target sizing not yet confirmed
  on iOS Safari.

## Status

All 8 solo games and 3 multiplayer modes are implemented and playable. Verified
working on Android over HTTPS (including tilt) and over the host app's HTTP hotspot
(multiplayer). Canvas matches the device's aspect ratio instead of letterboxing.

## License

[GNU AGPL v3.0](LICENSE) — if you run a modified version as a network service, the
source for your modifications must also be made available to its users.
