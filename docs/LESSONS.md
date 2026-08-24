# Lessons from the hotspot / QR experiment

Banked 2026-08-25, before master was reset to `64fd433` ("Racing Pigs:
multiplayer, one pig each") and rebuilt.

The seven commits that followed `64fd433` are preserved on branch
`experiment/hotspot-qr`, tagged `v1.1.0-experiment`. `host-app/` was kept in
the working tree as a reference model; everything web-side was reverted.

## What was being attempted

Turn one phone into the entire offline venue: a native Android APK raising a
local-only Wi-Fi hotspot, serving the web game from packaged assets, and
running a JVM port of the dev relay. Guests scan a Wi-Fi QR to join the
hotspot, scan a second QR to open the game, and install nothing.

## What was proven to work on hardware

Verified on a Lenovo TB328FU (Android 12) with real hotspot clients:

- **Local-only hotspot + embedded NanoWSD server + JVM relay** all work. The
  offline venue is achievable; this is not the part that failed.
- **A hotspot must be raised from a visible activity.** Android refuses a
  local-only hotspot to an app that is not in the foreground, and a foreground
  *service* does not count — it fails with a `SecurityException` that reads
  like a permission problem. ReadTheRoom does it from a transparent activity;
  copying that worked first time.
- **A page cannot start an Android activity from the background either.** A
  hotspot request made while the browser was in front stalled forever. A
  navigation to a custom scheme (`pocketeers://hotspot`) counts as a
  foreground start from a tap, and works.
- **A page cannot raise a permission dialog.** The activity must ask, then act
  on the answer, rather than returning advice the browser cannot act on.
- **Loopback is a secure origin; the hotspot address is not.** Tilt games work
  for the host on loopback and cannot work for guests over plain http on the
  hotspot. This is a real, permanent constraint on any http-served guest.
- **The guest QR cannot use `location.origin`.** The master's browser sits on
  loopback; the QR must carry the hotspot address the phone reports, derived
  per request from the `Host` header.
- **The relay must report a roster, not a count.** Room code plus id, name,
  host flag and presence per player, so a briefly locked phone shows as
  reconnecting rather than vanishing.
- **A missing player name arrives as the literal string `"null"`** if the
  client sends JSON null — `optString` survives it. Omit the field instead.

## What actually went wrong

**Two front doors.** The root failure, and the one the rebuild must not
repeat. The APK grew its own solo/multiplay chooser while the web hub already
had one, so launching the app asked the same question twice in two different
visual languages. Deleting the native chooser (`9c19978`) was correct but
arrived after several cycles had built on top of the duplication, and the
web hub was by then carrying hosting-control logic (`/host/status`,
`/host/start`, `/host/stop` polling, Wi-Fi step rendering) that made it hard
to reason about which surface owned the flow.

*Carry forward:* there is exactly one place the player chooses solo or
multiplayer, and it is decided before any code is written. A native shell, if
one ever returns, is a doorway and nothing else — permission, server, browser,
get out of the way.

**Caching burned more time than every real bug combined.** A service worker
registered on an origin by one build served that whole build forever,
*including an `index.html` too old to contain the code that would remove the
worker*. Every fix was being measured against an hour-old build, which made
working code look broken and sent several cycles chasing defects that did not
exist.

*Carry forward:*
- Under a host app, a service worker is pure liability — the APK already holds
  every file locally. It must unregister itself and drop its caches there, and
  only the public web build should register it.
- A worker must be able to kill itself without depending on the page that
  registered it being fresh.
- Never test against a cached origin. Cache-bust the launch URL, reuse the
  app's own tab, and move the dev server's port when an origin has been
  poisoned rather than trying to clean it.
- Responses `no-store`, not `no-cache`. Never cache `/host/*`.

**No console on a pub phone.** A page can insist it is connected while the
relay has never heard from it. The server reporting what it actually receives
— sockets, messages, last message — was the only thing that made this
diagnosable. Build that in from the start next time.

**A module that will not link runs nothing at all.** One stale import
(`hostedRoom`, deleted) blanked the entire app with no visible error. Worth
remembering when "everything is broken" after a small change.

**Room codes bought nothing.** One phone hosts, so there is exactly one room.
Codes only earn their place on the shared dev relay. The extra layer added
failure modes — notably a join for a nonexistent room silently opening an
empty one with the guest sitting in it as host.

## The shape to aim for next time

1. One front page, one choice, decided up front.
2. Guests get a URL and nothing else to read, type or install.
3. Whatever serves the game does not cache it.
4. The host's own view and the guest's view are different addresses — never
   assume one can describe the other.
5. Prove each step on hardware before building the next on top of it.
