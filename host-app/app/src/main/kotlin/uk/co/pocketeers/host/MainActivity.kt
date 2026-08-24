package uk.co.pocketeers.host

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.Lifecycle
import kotlinx.coroutines.launch
import uk.co.pocketeers.host.databinding.ActivityMainBinding

// There is no native front page. This is a doorway: get permission, start the
// server, hand the phone to the game's own screen. Everything the player
// chooses - solo, hosting, who joins - happens in the web hub from there.
class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private var opened = false
    // True while a permission dialog is up: the browser must wait, or it takes
    // the screen and the dialog goes with it.
    private var asking = false

    // Asked for here so hosting later works without interrupting a game. If it
    // is refused, HotspotActivity asks again at the moment it is actually
    // needed - refusing now only costs hosting, not playing.
    private val permission = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        asking = false
        startService(HostingService.ACTION_START)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        binding.retry.setOnClickListener { opened = false; requestThenStart() }
        binding.retry.setOnLongClickListener {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))); true
        }
        binding.stop.setOnClickListener { startService(HostingService.ACTION_STOP) }
        lifecycleScope.launch { repeatOnLifecycle(Lifecycle.State.STARTED) { HostingStateStore.state.collect(::render) } }
        take(intent)
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); take(intent) }

    private fun take(intent: Intent?) {
        opened = false
        requestThenStart()
    }

    private fun wifiPermission() = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.NEARBY_WIFI_DEVICES else Manifest.permission.ACCESS_FINE_LOCATION

    private fun requestThenStart() {
        val needed = mutableListOf(wifiPermission())
        if (Build.VERSION.SDK_INT <= 32) needed += Manifest.permission.ACCESS_COARSE_LOCATION
        if (Build.VERSION.SDK_INT >= 33) needed += Manifest.permission.POST_NOTIFICATIONS
        // A refusal only costs hosting, so start the server either way and let
        // the hub explain it if somebody later tries to become master.
        if (needed.all { ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED }) {
            asking = false
            startService(HostingService.ACTION_START)
        } else { asking = true; permission.launch(needed.toTypedArray()) }
    }

    private fun startService(action: String) =
        ContextCompat.startForegroundService(this, Intent(this, HostingService::class.java).setAction(action))

    private fun render(state: HostingState) = with(binding) {
        val hotspot = (state as? HostingState.Running)?.hotspot
        val failed = state is HostingState.Failed
        progress.visibility = if (failed) View.GONE else View.VISIBLE
        retry.visibility = if (failed) View.VISIBLE else View.GONE
        stop.visibility = if (state is HostingState.Running) View.VISIBLE else View.GONE
        status.text = when {
            state is HostingState.Failed -> state.message
            state is HostingState.Starting -> state.message
            hotspot is HotspotState.Starting -> hotspot.message
            hotspot is HotspotState.Failed -> hotspot.message
            hotspot is HotspotState.On -> "Hosting on ${hotspot.ssid}"
            state is HostingState.Running -> "Playing at ${state.localUrl}"
            else -> "Starting…"
        }
        if (state is HostingState.Running && !opened && !asking) {
            opened = true
            // A service worker registered by an older build owns this origin
            // and would answer from its cache - including with an index.html
            // too old to contain the code that unregisters it. A URL it has
            // never cached cannot be answered from that cache.
            // EXTRA_APPLICATION_ID makes the browser reuse this app's own tab
            // instead of stacking a new one on every launch - and stops old
            // tabs living on in the background, reconnecting to the relay with
            // whatever build they were loaded from.
            val url = "${state.localUrl}?build=${BuildConfig.VERSION_CODE}.${System.currentTimeMillis() / 1000}"
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))
                .putExtra(android.provider.Browser.EXTRA_APPLICATION_ID, packageName)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            // Leave no doorway behind the game: anything that finishes on top
            // of it - the hotspot activity, a permission dialog - should drop
            // the player straight back into the tab they were playing in.
            // Stopping lives in the ongoing notification.
            finish()
        }
    }
}
