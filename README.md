# Pocketeers

A single installable PWA that recreates classic Tomy Pocketeers handheld games for
mobile phones. Tomy's originals (sold in the UK as "Pocketeers", in the US as "Pocket
Games") were mostly mechanical ball-bearing toys played by physically tilting the unit —
which maps almost 1:1 onto a phone's accelerometer/gyroscope, so tilt is used as a real
control scheme here rather than bolted on for novelty.

## What's in the box

One hub app, seven games, all sharing the same rendering/audio/input engine:

| Game | Mechanic | Control |
| --- | --- | --- |
| Amazing Maze | Roll a ball through a procedurally generated maze to the goal, avoiding trap holes, against a timer | Tilt |
| Secret Passage | Same maze engine, but fog-of-war hides everything outside a small radius around the ball; a faint compass points toward the goal | Tilt |
| Pocket Pachinko | Drop a ball through a peg field into scoring pockets | Tilt |
| Derby | Endless-runner style race, dodging obstacles, with a tap-to-dash boost | Tilt + tap |
| Target Range | Targets pop up and expire; tap them before they vanish | Tap |
| Baseball | Pitches fall down the screen; swipe at the right moment to hit | Swipe |
| Pocket Slot | Three-reel fruit machine, spend credits to spin | Tap |

## Architecture

- Pure vanilla JS, ES6 modules, no build step, no dependencies.
- Fixed internal canvas resolution (240x320 portrait), scaled with
  `object-fit: contain` + `image-rendering: pixelated`.
- All graphics are drawn procedurally on canvas — no image assets except the
  generated PWA icons. Text uses a hand-drawn pixel bitmap font (`fillText` is never
  used, since it anti-aliases and blurs under pixelated scaling).
- All audio is procedural (Web Audio API oscillators/noise), no sound files.
- Progressive Web App: `manifest.json` + `sw.js` (cache-first, offline-capable).

```
pocketeers/
├── js/core/       # shared engine: constants, renderer (+pixel font), audio, input
│                  # (touch/tap/swipe + tilt with iOS permission handling and a
│                  # drag-to-steer fallback for tilt-less devices), storage
│                  # (localStorage high scores), hub.js (title screen + game switcher
│                  # + fixed-timestep game loop)
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

- iOS 13+ requires an explicit user-gesture permission prompt for
  `DeviceOrientationEvent`; the hub shows a one-time "tap to allow tilt" screen before
  entering any tilt-based game, with a fallback ("tap here to use drag-to-steer
  instead") for when permission is denied or the device has no gyroscope (e.g. desktop
  testing).
- `navigator.vibrate()` (used for hit/collision haptics) works on Android Chrome but is
  not supported by iOS Safari — it silently no-ops there.

## Running it

```
00-startup.bat          # Windows: serves the app at http://localhost:8080
```

or manually: `npx http-server -p 8080`, then open the printed URL. To regenerate the
PWA icons after changing `generate-icons.js`, run `node generate-icons.js`.

## Status

All 7 games are implemented and playable. Not yet tested on a physical phone —
worth checking tilt calibration feel and touch-target sizing on real hardware before
calling any game "done".
