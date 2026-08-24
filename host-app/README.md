# Pocketeers Android host

This native Android app creates a local-only hotspot and serves the repository's browser game and WebSocket relay to nearby phones. It does not contain game logic and the hotspot deliberately has no internet access.

## What the screen does

Two tabs.

**Solo** starts the embedded server on `127.0.0.1` with no hotspot and opens the
phone's browser at it. Loopback is a secure origin, so tilt-driven games work in solo
where they cannot over the hotspot's plain `http://`.

**Multiplay** starts the local-only hotspot and the server, then shows three numbered
steps: *1 Join the Wi-Fi* (credentials and a Wi-Fi QR), *2 Open the game* (guest URL
and its QR), and *3 Signed up* — the room code the host's browser created plus a
numbered list of everyone in it, taken live from the relay. A guest whose phone locks
stays on the list dimmed as *reconnecting* for the relay's grace period rather than
disappearing. Tapping either QR fills the screen with it.

Only one mode runs at a time; the other tab's start button explains why it is disabled.

## Prerequisites and build

Install JDK 17 and Android SDK 36, then open `host-app/` in Android Studio or run:

```powershell
gradlew.bat test
gradlew.bat assembleDebug
gradlew.bat lintDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

The build's `syncWebAssets` task copies `index.html`, `manifest.json`, `sw.js`, `css/`, `js/`, and `assets/` from the repository root into generated app assets before every build. Edit only the root web files; the synchronized tree is ignored by Git.

### Superserver / `.devbuild`

From the repository root, run `.devbuild -Path . -Type android`. The root
`gradlew` files intentionally delegate to `host-app/`; building from the root lets
devbuild sync the web sources too. Passing `host-app/` directly omits them remotely.

Known workflow issues as of 2026-08-23:

- Superserver is reached over ZeroTier. Verify `ssh superserver "echo ok"` first.
- Artifact retrieval can fail after a successful build with `rsync chgrp ... (13)`.
  The APK remains at `~/devbuild-runs/pocketeers/src/host-app/app/build/outputs/apk/debug/app-debug.apk` and can be retrieved with `scp`.
- Disposable containers currently generate fresh debug signing keys, so a later APK
  may require uninstalling the old debug package. A persistent remote debug key is the
  proper workflow fix.

## Permissions

Android 13+ uses Nearby Wi-Fi Devices to create the hotspot. Android 12 and earlier use location permission and require Location services to be enabled because of Android's Wi-Fi API rules. Notification permission is requested on Android 13+, but denial does not prevent visible-app startup. The foreground connected-device service keeps hosting alive when the activity is backgrounded.

`ACCESS_WIFI_STATE` is deliberate. NanoWSD uses its port-only constructor, matching
the physically proven ReadTheRoom listener. Address discovery snapshots Wi-Fi/AP IPv4
addresses before startup and waits for a new address on `wlan*`, `wifi*`, or `ap*`.
Never assume a subnet.

Only one test app should own the hotspot. Android can share one LocalOnlyHotspot among
apps; if ReadTheRoom already holds it, no new address appears for Pocketeers and its
clean-start address detector can time out.

## Physical test

Disable mobile data and upstream Wi-Fi. On the host, tap **Start Pocketeers**, grant permission, and check that an SSID, password, Wi-Fi QR, and guest URL QR appear. Open the game, select **MULTIPLAY → BECOME MASTER**, connect two guest phones to the shown Wi-Fi, then open the guest URL and scan the in-game room QR. Exercise Racing Pigs and both Target Range modes, briefly lock a guest, background/lock the host, then verify both notification **Stop** and in-app **Stop hosting** release the network. Repeat the cycle.

To compare relay behavior, start the APK on a reachable device, set `RELAY_URL=ws://<hotspot-ip>:<port>/ws`, and run `node dev-relay/smoke-test.js` from the repository root (after `npm install` in `dev-relay/`). The unit tests cover election, broadcast/direct relay, reconnect, promotion, malformed input, and cleanup.

Local-only hotspot routing and multi-phone behavior cannot be accepted from an emulator alone.

## Verified actuality (2026-08-23)

- Lenovo TB328FU / Android 12: permission flow, hotspot, credentials, `wlan0`
  address discovery, foreground service, notification, HTTP/MP3 assets, origin
  injection, `/ws` smoke test, background survival, and in-app stop were exercised.
- The current ReadTheRoom APK was the known-good network reference. Do not infer
  hotspot ingress from an old diagnostic APK, a host-local request, or ADB forwarding.
- The web canvas now receives an explicit visual-viewport-fitted CSS size; its DPR
  backing bitmap must never determine layout size.
- Three-phone gameplay, notification Stop, host lock, guest reconnect timing, and an
  Android 13+ physical permission run remain outstanding.
