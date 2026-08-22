# Digi Pocketeers

**A cutesy, candy-colored tribute to classic Tomy Pocketeers handheld games, reborn for your phone.**

[![Play now](https://img.shields.io/badge/play-digi%20pocketeers-ff3d81?style=for-the-badge)](https://idltd.github.io/digi-pocketeers/)
[![Games](https://img.shields.io/badge/games-8-00e5ff)](#whats-in-the-box)
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

One hub app, eight games, all sharing the same rendering/audio/input engine:

| Game | Mechanic | Control |
| --- | --- | --- |
| Amazing Maze | Roll a ball through a procedurally generated maze to the goal, avoiding trap holes, against a timer | Tilt |
| Secret Passage | Same maze engine, but fog-of-war hides everything outside a small radius around the ball; a faint compass points toward the goal | Tilt |
| Pocket Pachinko | Drop a ball through a peg field into scoring pockets — edges pay more than the easy center drain | Tilt |
| Derby | Endless-runner style race, dodging obstacles, with a tap-to-dash boost | Tilt + tap |
| Target Range | Targets pop up and expire; tap them before they vanish | Tap |
| Baseball | Pitches fall down the screen; swipe at the right moment to hit | Swipe |
| Pocket Slot | Three-reel fruit machine, spend credits to spin | Tap |
| Racing Pigs | Pick a pig; lanes of pigs waddle-stop-snort their way up the screen at random, first to the line wins | Tap to pick |

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

## Future work

- **Multiplayer**: one device becomes "master", spins up a local access point, and
  shows a QR code for others to join. Rather than one bespoke networking model per
  game, the plan is a small set of generic modes any game can opt into:
  - **Turns** — one shared game state; everyone watches the current player's screen,
    turn passes around the group.
  - **Race** — everyone plays the same game simultaneously, each on their own device,
    racing for the best outcome (leaderboard-style).
  - **Mega** — everyone plays simultaneously and can see everyone else's screen too
    (needs a way to visually tell players apart — pig color, player initials, etc).
  - **Custom** — bespoke per-game multiplayer logic that doesn't fit the generic
    modes, e.g. a later Racing Pigs version where you can actively help your own pig
    or hinder someone else's rather than just picking and watching.
  Racing Pigs (see below) is the natural first candidate once this lands, since it's
  already structured around per-player pig ownership.

## Status

All 8 games are implemented and playable, running on the candy-colored palette with
particle/screen-shake feedback, a real font (Fredoka) instead of a bitmap font, and a
canvas that matches the device's aspect ratio instead of letterboxing. Verified working
on Android over HTTPS, including tilt. Not yet verified on iOS — worth checking the
tilt-permission flow and touch-target sizing there before calling any game "done".
Racing Pigs is solo-only v1: pick a pig, watch it waddle/stop/snort its way to the
finish line at random — no active skill yet, that's the "custom" multiplayer mode
candidate above.

## License

[GNU AGPL v3.0](LICENSE) — if you run a modified version as a network service, the
source for your modifications must also be made available to its users.
