package uk.co.pocketeers.host

import org.json.JSONObject
import java.util.Timer
import java.util.TimerTask
import java.util.concurrent.atomic.AtomicInteger

class RoomManager(private val graceMs: Long = 10_000, private val changed: (Roster) -> Unit = {}) {
    interface Client { fun send(text: String); fun close() }
    // What the native screen shows while people sign up: the room the host's
    // browser created, and everyone in it in join order.
    data class Guest(val id: Int, val name: String, val host: Boolean, val present: Boolean)
    data class Roster(val room: String?, val players: List<Guest>)
    data class Player(val id: Int, var name: String, val token: String, var client: Client?, var removal: TimerTask? = null)
    data class Room(val players: LinkedHashMap<Int, Player> = linkedMapOf(), var hostId: Int? = null)
    private val rooms = mutableMapOf<String, Room>()
    private val ids = AtomicInteger(1)
    private val timer = Timer("relay-grace", true)

    @Synchronized fun receive(client: Client, text: String) {
        if (text.toByteArray().size > 65_536) { error(client, "message too large"); return }
        val m = try { JSONObject(text) } catch (_: Exception) { return }
        when (m.optString("t")) {
            "join" -> join(client, m)
            "relay" -> relay(client, m)
        }
    }

    private fun join(client: Client, m: JSONObject) {
        val code = m.optString("room").uppercase()
        if (!Regex("^[A-Z0-9]{4}$").matches(code)) { error(client, "room code must be four characters"); return }
        disconnectClient(client, immediate = true)
        // Only the master creates rooms. Without this a guest who scans a stale
        // code silently opens an empty room of their own and sits there as its
        // host, looking like the code was simply ignored.
        val room = if (m.optBoolean("create")) rooms.getOrPut(code) { Room() }
            else rooms[code] ?: return error(client, "the host has not opened a game yet")
        val token = m.optString("token")
        val existing = token.takeIf { it.isNotEmpty() }?.let { room.players.values.find { p -> p.token == it } }
        val player = existing ?: Player(ids.getAndIncrement(), "", token, null).also { room.players[it.id] = it }
        player.removal?.cancel(); player.removal = null; player.client = client
        // A client that sends no name - or a null one - is numbered by us.
        val fallback = "P${player.id}"
        val offered = if (m.isNull("name")) "" else m.optString("name")
        player.name = offered.take(12).ifBlank { fallback }
        if (room.hostId == null) room.hostId = player.id
        client.send(JSONObject().put("t", "welcome").put("id", player.id).put("host", player.id == room.hostId).put("players", players(room)).toString())
        broadcast(room, JSONObject().put("t", "players").put("players", players(room)).toString())
        changed(roster())
    }

    private fun relay(client: Client, m: JSONObject) {
        val found = find(client) ?: return
        val (room, player) = found
        val out = JSONObject().put("t", "msg").put("from", player.id).put("data", m.opt("data")).toString()
        if (m.opt("to") == "all") room.players.values.filter { it.id != player.id }.forEach { it.client?.send(out) }
        else room.players[m.optInt("to", -1)]?.client?.send(out)
    }

    @Synchronized fun disconnected(client: Client) = disconnectClient(client, immediate = false)
    private fun disconnectClient(client: Client, immediate: Boolean) {
        val found = find(client) ?: return
        val (room, player) = found
        player.client = null
        val task = object : TimerTask() { override fun run() = removeIfAbsent(room, player) }
        player.removal = task
        if (immediate) task.run() else timer.schedule(task, graceMs)
        changed(roster())
    }

    @Synchronized private fun removeIfAbsent(room: Room, player: Player) {
        if (player.client != null) return
        room.players.remove(player.id)
        if (room.hostId == player.id) room.hostId = room.players.keys.firstOrNull()
        if (room.players.isEmpty()) rooms.entries.removeIf { it.value === room }
        else broadcast(room, JSONObject().put("t", "players").put("players", players(room)).toString())
        changed(roster())
    }

    @Synchronized fun shutdown() {
        rooms.values.flatMap { it.players.values }.forEach { it.client?.close(); it.removal?.cancel() }
        rooms.clear(); timer.cancel(); changed(Roster(null, emptyList()))
    }
    // Only ever one room in practice - the host's browser makes it and every
    // guest QR points at it - so the busiest room is the one worth showing.
    @Synchronized fun roster(): Roster {
        val entry = rooms.entries.maxByOrNull { it.value.players.size } ?: return Roster(null, emptyList())
        val room = entry.value
        return Roster(entry.key, room.players.values.map { Guest(it.id, it.name, it.id == room.hostId, it.client != null) })
    }
    @Synchronized fun connectedCount() = rooms.values.sumOf { room -> room.players.values.count { it.client != null } }
    @Synchronized fun roomCount() = rooms.size
    private fun find(client: Client) = rooms.values.firstNotNullOfOrNull { room -> room.players.values.find { it.client === client }?.let { room to it } }
    private fun players(room: Room) = org.json.JSONArray().also { a -> room.players.values.forEach { p -> a.put(JSONObject().put("id", p.id).put("name", p.name).put("host", p.id == room.hostId)) } }
    private fun broadcast(room: Room, text: String) = room.players.values.forEach { it.client?.send(text) }
    private fun error(client: Client, message: String) = client.send(JSONObject().put("t", "error").put("message", message).toString())
}
