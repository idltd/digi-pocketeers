package uk.co.pocketeers.host

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.launch

// Android refuses a local-only hotspot to an app that is not in the foreground,
// and a foreground service does not count - the proven ReadTheRoom app raises
// its hotspot from a visible activity. This is that activity, and nothing else:
// it is transparent and finishes the moment the Wi-Fi is up or refused, so the
// master's game stays exactly where it was, in the tab it was already in.
//
// Being an activity, it is also the right place to ask for the Wi-Fi permission
// if it is missing - a page cannot raise that dialog.
class HotspotActivity : AppCompatActivity() {
    private val permission = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
        if (grants[wifiPermission()] == true || granted()) raise() else finish()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                HostingStateStore.state.collect { state ->
                    val hotspot = (state as? HostingState.Running)?.hotspot
                    // Off is not an outcome here: the service sets Starting
                    // before sending us up, so only these two mean it is done.
                    if (hotspot is HotspotState.On || hotspot is HotspotState.Failed) finish()
                    if (state is HostingState.Failed || state is HostingState.Stopped) finish()
                }
            }
        }
        if (granted()) raise() else permission.launch(needed())
    }

    private fun raise() =
        ContextCompat.startForegroundService(this, Intent(this, HostingService::class.java).setAction(HostingService.ACTION_START_HOTSPOT))

    private fun wifiPermission() = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.NEARBY_WIFI_DEVICES else Manifest.permission.ACCESS_FINE_LOCATION
    private fun needed(): Array<String> {
        val list = mutableListOf(wifiPermission())
        if (Build.VERSION.SDK_INT <= 32) list += Manifest.permission.ACCESS_COARSE_LOCATION
        return list.toTypedArray()
    }
    private fun granted() = ContextCompat.checkSelfPermission(this, wifiPermission()) == PackageManager.PERMISSION_GRANTED

    override fun finish() { super.finish(); overridePendingTransition(0, 0) }
}
