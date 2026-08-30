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

Install JDK 17 and the Android SDK required by `compileSdk` in
`app/build.gradle.kts`, then open `host-app/` in Android Studio or run the Gradle
wrapper from this directory:

```shell
# macOS or Linux
./gradlew test assembleDebug lintDebug

# Windows
gradlew.bat test assembleDebug lintDebug
```

The debug APK is written to
`app/build/outputs/apk/debug/app-debug.apk`. Install it on a connected device with:

```shell
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The build's `syncWebAssets` task copies `index.html`, `manifest.json`, `sw.js`,
`css/`, `js/`, and `assets/` from the repository root into generated app assets
before every build. Edit only the root web files; the synchronized tree is ignored
by Git. The root `gradlew` and `gradlew.bat` launchers delegate to `host-app/`, so
the same tasks may also be run from the repository root.

Debug builds use the Android tooling's local debug signing key. If an existing app
was installed from a differently signed debug build, uninstall it before installing
the new APK.

## Permissions

Android 13+ uses Nearby Wi-Fi Devices to create the hotspot. Android 12 and earlier use location permission and require Location services to be enabled because of Android's Wi-Fi API rules. Notification permission is requested on Android 13+, but denial does not prevent visible-app startup. The foreground connected-device service keeps hosting alive when the activity is backgrounded.

`ACCESS_WIFI_STATE` is deliberate. NanoWSD uses its port-only constructor. Address
discovery snapshots Wi-Fi/AP IPv4 addresses before startup and waits for a new address
on `wlan*`, `wifi*`, or `ap*`. Never assume a subnet.

Only one test app should own the hotspot. Android can share one LocalOnlyHotspot among
apps; if another app already holds it, no new address may appear for Pocketeers and
its clean-start address detector can time out.

## Physical test

Disable mobile data and upstream Wi-Fi. On the host, tap **Start Pocketeers**, grant permission, and check that an SSID, password, Wi-Fi QR, and guest URL QR appear. Open the game, select **MULTIPLAY → BECOME MASTER**, connect two guest phones to the shown Wi-Fi, then open the guest URL and scan the in-game room QR. Exercise Racing Pigs and both Target Range modes, briefly lock a guest, background/lock the host, then verify both notification **Stop** and in-app **Stop hosting** release the network. Repeat the cycle.

To compare relay behavior, start the APK on a reachable device, set `RELAY_URL=ws://<hotspot-ip>:<port>/ws`, and run `node dev-relay/smoke-test.js` from the repository root (after `npm install` in `dev-relay/`). The unit tests cover election, broadcast/direct relay, reconnect, promotion, malformed input, and cleanup.

Local-only hotspot routing and multi-phone behavior cannot be accepted from an emulator alone.

For release testing, cover both Android 12-or-earlier and Android 13-or-later so both
permission paths are exercised. Verify hotspot creation, address discovery, foreground
service behavior, notification and in-app stop actions, host background/lock survival,
guest reconnection, static and audio asset delivery, and multi-phone gameplay. A
host-local request or ADB port forwarding does not prove hotspot ingress.

The web canvas uses an explicit visual-viewport-fitted CSS size; its DPR backing
bitmap must never determine layout size.
