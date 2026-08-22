# Digi Pocketeers

**A cutesy, candy-colored tribute to classic Tomy Pocketeers handheld games, reborn for your phone.**

[![Play now](https://img.shields.io/badge/play-digi%20pocketeers-ff3d81?style=for-the-badge)](https://idltd.github.io/digi-pocketeers/)
[![Games](https://img.shields.io/badge/games-7-00e5ff)](#whats-in-the-box)
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

One hub app, seven games, all sharing the same rendering/audio/input engine:

| Game | Mechanic | Control |
| --- | --- | --- |
| Amazing Maze | Roll a ball through a procedurally generated maze to the goal, avoiding trap holes, against a timer | Tilt |
| Secret Passage | Same maze engine, but fog-of-war hides everything outside a small radius around the ball; a faint compass points toward the goal | Tilt |
| Pocket Pachinko | Drop a ball through a peg field into scoring pockets — edges pay more than the easy center drain | Tilt |
| Derby | Endless-runner style race, dodging obstacles, with a tap-to-dash boost | Tilt + tap |
| Target Range | Targets pop up and expire; tap them before they vanish | Tap |
| Baseball | Pitches fall down the screen; swipe at the right moment to hit | Swipe |
| Pocket Slot | Three-reel fruit machine, spend credits to spin | Tap |

## Architecture

- Pure vanilla JS, ES6 modules, no build step, no dependencies.
- Fixed internal canvas resolution (240×320 portrait), scaled with
  `object-fit: contain` + `image-rendering: pixelated`.
- All graphics are drawn procedurally on canvas — no image assets except the
  generated PWA icons. Text uses a hand-drawn pixel bitmap font (`fillText` is never
  used, since it anti-aliases and blurs under pixelated scaling). A shared particle
  system and screen-shake give hits/wins some juice.
- All audio is procedural (Web Audio API oscillators/noise), no sound files.
- Progressive Web App: `manifest.json` + `sw.js` (cache-first, offline-capable).

```text
digi-pocketeers/
├── js/core/       # shared engine: constants (incl. the candy color palette),
│                  # renderer (+ pixel font, particles, screen shake), audio,
│                  # input (touch/tap/swipe + tilt with iOS permission handling
│                  # and a drag-to-steer fallback), storage (localStorage high
│                  # scores), hub.js (title screen + game switcher + loop)
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

## Future work

- **Multiplayer**: one device becomes "master", spins up a local access point, and
  shows a QR code for others to join. Per-game decision still to be worked out between
  joint/simultaneous play and everyone spectating the current player's screen.

## Status

All 7 games are implemented and playable, running on the candy-colored palette with
particle/screen-shake feedback. Verified working on Android over HTTPS. Not yet
verified on iOS — worth checking the tilt-permission flow and touch-target sizing
there before calling any game "done".

## License

[GNU AGPL v3.0](LICENSE) — if you run a modified version as a network service, the
source for your modifications must also be made available to its users.
