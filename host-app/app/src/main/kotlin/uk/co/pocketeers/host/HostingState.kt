package uk.co.pocketeers.host

import kotlinx.coroutines.flow.MutableStateFlow
import org.json.JSONArray
import org.json.JSONObject

// The app has one screen and it is the game's own. The server comes up on
// launch and the browser opens at it; the hotspot is a separate step the web
// hub asks for when somebody chooses to become master.
sealed interface HostingState {
    data object Stopped : HostingState
    data class Starting(val message: String) : HostingState
    data class Failed(val message: String) : HostingState
    data class Running(
        val localUrl: String,
        val port: Int,
        val hotspot: HotspotState = HotspotState.Off,
        val room: String? = null,
        val players: List<RoomManager.Guest> = emptyList(),
    ) : HostingState
}

sealed interface HotspotState {
    data object Off : HotspotState
    data class Starting(val message: String) : HotspotState
    data class On(val ssid: String, val password: String, val guestUrl: String) : HotspotState
    data class Failed(val message: String) : HotspotState
}

object HostingStateStore { val state = MutableStateFlow<HostingState>(HostingState.Stopped) }

// What GET /host/status answers. The web hub draws its own screens from this,
// so everything it needs to show is here and nothing else is.
fun HostingState.toJson(): JSONObject {
    val out = JSONObject()
    when (this) {
        is HostingState.Running -> {
            out.put("server", "running").put("localUrl", localUrl)
            out.put("hotspot", hotspot.toJson())
            out.put("room", room ?: JSONObject.NULL)
            out.put("players", JSONArray().also { array ->
                players.forEach { array.put(JSONObject().put("id", it.id).put("name", it.name).put("host", it.host).put("present", it.present)) }
            })
        }
        is HostingState.Starting -> out.put("server", "starting").put("message", message)
        is HostingState.Failed -> out.put("server", "failed").put("message", message)
        HostingState.Stopped -> out.put("server", "stopped")
    }
    return out
}

private fun HotspotState.toJson(): JSONObject = when (this) {
    HotspotState.Off -> JSONObject().put("state", "off")
    is HotspotState.Starting -> JSONObject().put("state", "starting").put("message", message)
    is HotspotState.Failed -> JSONObject().put("state", "failed").put("message", message)
    is HotspotState.On -> JSONObject().put("state", "on").put("ssid", ssid).put("password", password).put("guestUrl", guestUrl)
}
