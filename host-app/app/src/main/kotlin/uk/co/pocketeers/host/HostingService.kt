package uk.co.pocketeers.host

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.Handler
import androidx.core.app.NotificationCompat
import androidx.annotation.RequiresApi
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.*
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URL

// Owns the server for the whole session and the hotspot for as long as someone
// is hosting. Both are asked for by the web hub through HostControl; this class
// is the only thing that touches Android.
class HostingService : Service(), HostControl {
    // How long to keep asking whether the server can be reached on the new
    // hotspot address before giving up on it: eight tries, half a second
    // apart, so roughly four seconds.
    private val VERIFY_ATTEMPTS = 8
    private val VERIFY_GAP_MS = 500L

    companion object {
        const val ACTION_START = "uk.co.pocketeers.host.START"
        const val ACTION_START_HOTSPOT = "uk.co.pocketeers.host.START_HOTSPOT"
        const val ACTION_STOP = "uk.co.pocketeers.host.STOP"
        private const val CHANNEL = "hosting"
        private const val NOTIFICATION = 42
        private const val LOOPBACK = "127.0.0.1"
        private const val SOCKET_READ_TIMEOUT = 0
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var reservation: WifiManager.LocalOnlyHotspotReservation? = null
    private var server: PocketeersServer? = null
    private var port = 0
    private var running = false
    private var stopping = false
    private var hotspotBusy = false
    private var addressesBeforeHotspot = emptySet<String>()

    override fun onCreate() { super.onCreate(); createChannel() }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> stopEverything()
            ACTION_START_HOTSPOT -> beginHotspot()
            else -> startServer()
        }
        return START_NOT_STICKY
    }

    // Launching the app only starts the server. Nothing touches Wi-Fi until
    // somebody chooses to become master in the game itself.
    private fun startServer() {
        if (running || stopping) return
        running = true
        HostingStateStore.state.value = HostingState.Starting("Starting the game server…")
        ServiceCompat.startForeground(this, NOTIFICATION, notification("Starting the game server…"),
            if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0)
        scope.launch {
            val chosen = bindServer() ?: return@launch fail("Ports 8080–8089 are unavailable.")
            port = chosen
            val url = "http://$LOOPBACK:$chosen/"
            if (!verify(url)) return@launch fail("The game server did not answer on this phone.")
            HostingStateStore.state.value = HostingState.Running(url, chosen)
            updateNotification("Playing • $url")
        }
    }

    // A service worker's scope is its origin, port included, so builds before
    // the host app stopped registering one left 8080 poisoned on any phone
    // that played then: it still answers with that day's app. Serving from a
    // port those workers never saw sidesteps every one of them, and the
    // shipped sw.js deletes itself if it ever wakes up on a host-app origin.
    private fun bindServer(): Int? {
        for (candidatePort in 8090..8099) {
            try {
                val candidate = PocketeersServer(assets, candidatePort, this)
                candidate.start(SOCKET_READ_TIMEOUT, false)
                server = candidate
                return candidatePort
            } catch (_: Exception) { }
        }
        return null
    }

    // --- HostControl, called from the server's request threads --------------

    override fun status(): JSONObject = HostingStateStore.state.value.toJson().also { out ->
        server?.let { out.put("sockets", it.socketsOpened).put("messages", it.messagesSeen).put("lastMessage", it.lastMessage ?: JSONObject.NULL) }
    }

    override fun onRoster(roster: RoomManager.Roster) = updateRunning { it.copy(room = roster.room, players = roster.players) }

    // Asked for by the page. Android's Wi-Fi service refuses a local-only
    // hotspot to an app that is not in the foreground, and a foreground
    // *service* does not count - the proven ReadTheRoom app raises its hotspot
    // from a visible activity, so we do the same. This only bounces the
    // request; MainActivity comes to the front, sends ACTION_START_HOTSPOT and
    // hands the phone straight back to the game.
    override fun startHotspot() {
        val current = HostingStateStore.state.value
        if (current !is HostingState.Running || hotspotBusy) return
        if (current.hotspot is HotspotState.On || current.hotspot is HotspotState.Starting) return
        updateHotspot(HotspotState.Starting("Opening the Wi-Fi…"))
        startActivity(Intent(this, HotspotActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        // Android may refuse that start outright when nothing of ours has been
        // on screen recently. Say so rather than leaving the page waiting.
        scope.launch {
            delay(20_000)
            val now = HostingStateStore.state.value
            if (now is HostingState.Running && now.hotspot is HotspotState.Starting && !hotspotBusy)
                updateHotspot(HotspotState.Failed("Android would not open the Wi-Fi. Open the Pocketeers app and try again."))
        }
    }

    // The real thing, and only ever from the activity so the app is visible.
    private fun beginHotspot() {
        val current = HostingStateStore.state.value
        if (current !is HostingState.Running || hotspotBusy) return
        if (current.hotspot is HotspotState.On) return
        if (!hasWifiPermission()) return failHotspot("This phone has not been allowed to open a Wi-Fi.")
        hotspotBusy = true
        updateHotspot(HotspotState.Starting("Opening the Wi-Fi…"))
        val wifi = applicationContext.getSystemService(WIFI_SERVICE) as WifiManager
        addressesBeforeHotspot = wifiIpv4Addresses().toSet()
        try {
            wifi.startLocalOnlyHotspot(object : WifiManager.LocalOnlyHotspotCallback() {
                override fun onStarted(value: WifiManager.LocalOnlyHotspotReservation) {
                    reservation = value
                    scope.launch { completeHotspot(value) }
                }
                override fun onStopped() { if (!stopping) failHotspot("The hotspot was stopped by Android.") }
                override fun onFailed(reason: Int) { failHotspot("Could not start the hotspot (reason $reason). Check Wi-Fi and Location settings.") }
            }, Handler(mainLooper))
        } catch (e: SecurityException) {
            // Almost always "not in the foreground" rather than a missing
            // permission, so do not send anyone off to the settings screen.
            failHotspot("Android would not open the Wi-Fi just now: ${e.message}")
        }
    }

    override fun stopHotspot() {
        reservation?.close(); reservation = null
        hotspotBusy = false
        addressesBeforeHotspot = emptySet()
        updateHotspot(HotspotState.Off)
        val state = HostingStateStore.state.value
        if (state is HostingState.Running) updateNotification("Playing • ${state.localUrl}")
    }

    @Suppress("DEPRECATION")
    private suspend fun completeHotspot(value: WifiManager.LocalOnlyHotspotReservation) {
        // (see verifyRepeatedly)
        updateHotspot(HotspotState.Starting("Finding the hotspot address…"))
        val (ssid, password) = if (Build.VERSION.SDK_INT >= 30) credentials(value)
            else Pair(value.wifiConfiguration?.SSID?.trim('"') ?: "Pocketeers", value.wifiConfiguration?.preSharedKey?.trim('"') ?: "")
        var address: String? = null
        repeat(20) { if (address == null) { address = hotspotAddress(); if (address == null) delay(500) } }
        val found = address ?: return failHotspot("The hotspot started, but no reachable address appeared.")
        val guestUrl = "http://$found:$port/"
        // An address appearing on the interface is not the same as being
        // routable through it. Asked once, immediately, this fails often
        // enough to look random - and a failure here tears the whole hotspot
        // down, so a moment of patience is worth more than a fast answer.
        if (!verifyRepeatedly(guestUrl)) return failHotspot("The server could not be reached at the hotspot address.")
        hotspotBusy = false
        updateHotspot(HotspotState.On(ssid, password, guestUrl))
        updateNotification("Hosting • $ssid • $guestUrl")
    }

    private fun failHotspot(message: String) {
        hotspotBusy = false
        reservation?.close(); reservation = null
        updateHotspot(HotspotState.Failed(message))
    }

    private fun updateHotspot(hotspot: HotspotState) = updateRunning { it.copy(hotspot = hotspot) }
    private inline fun updateRunning(change: (HostingState.Running) -> HostingState.Running) {
        val old = HostingStateStore.state.value
        if (old is HostingState.Running) HostingStateStore.state.value = change(old)
    }

    @RequiresApi(30)
    private fun credentials(value: WifiManager.LocalOnlyHotspotReservation): Pair<String, String> =
        Pair(value.softApConfiguration.ssid ?: "Pocketeers", value.softApConfiguration.passphrase ?: "")

    private fun hasWifiPermission(): Boolean {
        val needed = if (Build.VERSION.SDK_INT >= 33) android.Manifest.permission.NEARBY_WIFI_DEVICES else android.Manifest.permission.ACCESS_FINE_LOCATION
        return androidx.core.content.ContextCompat.checkSelfPermission(this, needed) == android.content.pm.PackageManager.PERMISSION_GRANTED
    }

    private fun wifiIpv4Addresses(): List<String> = try {
        NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback && (it.name.startsWith("wlan") || it.name.startsWith("wifi") || it.name.startsWith("ap")) }
            .flatMap { it.inetAddresses.toList() }
            .filterIsInstance<Inet4Address>()
            .filter { !it.isLoopbackAddress && !it.isLinkLocalAddress }
            .mapNotNull { it.hostAddress }
    } catch (_: Exception) { emptyList() }
    private fun hotspotAddress(): String? = wifiIpv4Addresses().firstOrNull { it !in addressesBeforeHotspot }
    private fun verify(url: String) = try { (URL(url).openConnection() as HttpURLConnection).run { connectTimeout = 1500; readTimeout = 1500; responseCode == 200 } } catch (_: Exception) { false }
    private suspend fun verifyRepeatedly(url: String): Boolean {
        repeat(VERIFY_ATTEMPTS) { attempt ->
            if (verify(url)) return true
            if (attempt < VERIFY_ATTEMPTS - 1) delay(VERIFY_GAP_MS)
        }
        return false
    }

    private fun fail(message: String) { HostingStateStore.state.value = HostingState.Failed(message); stopResources(); stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
    private fun stopEverything() { if (stopping) return; stopping = true; stopResources(); HostingStateStore.state.value = HostingState.Stopped; stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
    private fun stopResources() { running = false; hotspotBusy = false; server?.stop(); server = null; reservation?.close(); reservation = null; addressesBeforeHotspot = emptySet() }
    override fun onDestroy() { stopResources(); scope.cancel(); if (HostingStateStore.state.value !is HostingState.Failed) HostingStateStore.state.value = HostingState.Stopped; super.onDestroy() }

    private fun createChannel() { if (Build.VERSION.SDK_INT >= 26) (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(NotificationChannel(CHANNEL, "Pocketeers", NotificationManager.IMPORTANCE_LOW)) }
    private fun notification(text: String): Notification {
        val stop = PendingIntent.getService(this, 1, Intent(this, HostingService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val open = PendingIntent.getActivity(this, 2, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.stat_sys_upload).setContentTitle("Digi Pocketeers")
            .setContentText(text).setContentIntent(open).setOngoing(true).addAction(0, "Stop", stop).build()
    }
    private fun updateNotification(text: String) { (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIFICATION, notification(text)) }
}
