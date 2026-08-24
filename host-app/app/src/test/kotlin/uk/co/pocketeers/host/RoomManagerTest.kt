package uk.co.pocketeers.host

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class RoomManagerTest {
    class Fake : RoomManager.Client { val messages = mutableListOf<JSONObject>(); var closed = false; override fun send(text: String) { messages += JSONObject(text) }; override fun close() { closed = true } }
    private fun join(manager: RoomManager, client: Fake, token: String, name: String = token, create: Boolean = true) { manager.receive(client, """{"t":"join","room":"test","name":"$name","token":"$token","create":$create}""") }
    private fun welcome(c: Fake) = c.messages.first { it.getString("t") == "welcome" }
    @Test fun hostElectionBroadcastAndDirect() {
        val manager = RoomManager(20); val host = Fake(); val guest = Fake(); join(manager, host, "h"); join(manager, guest, "g")
        assertTrue(welcome(host).getBoolean("host")); assertFalse(welcome(guest).getBoolean("host"))
        manager.receive(guest, """{"t":"relay","to":"all","data":{"ping":1}}"""); assertEquals(1, host.messages.last { it.optString("t") == "msg" }.getJSONObject("data").getInt("ping"))
        val hostId = welcome(host).getInt("id"); manager.receive(guest, """{"t":"relay","to":$hostId,"data":{"direct":true}}"""); assertTrue(host.messages.last().getJSONObject("data").getBoolean("direct")); manager.shutdown()
    }
    @Test fun reconnectRetainsIdAndHost() {
        val manager = RoomManager(50); val first = Fake(); join(manager, first, "same"); val id = welcome(first).getInt("id"); manager.disconnected(first); val back = Fake(); join(manager, back, "same")
        assertEquals(id, welcome(back).getInt("id")); assertTrue(welcome(back).getBoolean("host")); manager.shutdown()
    }
    @Test fun promotionMalformedAndCleanup() {
        val manager = RoomManager(1); val host = Fake(); val guest = Fake(); join(manager, host, "h"); join(manager, guest, "g"); manager.receive(host, "not-json"); manager.disconnected(host); Thread.sleep(25)
        assertTrue(guest.messages.last { it.optString("t") == "players" }.getJSONArray("players").getJSONObject(0).getBoolean("host")); manager.disconnected(guest); Thread.sleep(25); assertEquals(0, manager.roomCount()); manager.shutdown()
    }
    @Test fun guestCannotOpenARoomOfTheirOwn() {
        // A stale or mistyped code must be refused, not silently turned into a
        // fresh empty room with the guest sitting in it as host.
        val manager = RoomManager(); val guest = Fake()
        join(manager, guest, "g", create = false)
        assertEquals("error", guest.messages.single().getString("t"))
        assertEquals(0, manager.roomCount())
        val host = Fake(); join(manager, host, "h")
        val late = Fake(); join(manager, late, "l", create = false)
        assertTrue(late.messages.any { it.getString("t") == "welcome" })
        manager.shutdown()
    }
    @Test fun rosterNamesTheRoomAndTracksPresence() {
        val seen = mutableListOf<RoomManager.Roster>()
        val manager = RoomManager(5_000) { seen += it }
        val host = Fake(); val guest = Fake(); join(manager, host, "h"); join(manager, guest, "g")
        val roster = manager.roster()
        assertEquals("TEST", roster.room)
        assertEquals(listOf("h", "g"), roster.players.map { it.name })
        assertTrue(roster.players.first().host)
        assertTrue(roster.players.all { it.present })
        // A guest whose phone locks is still on the list, just marked absent,
        // so the master does not watch players vanish and reappear.
        manager.disconnected(guest)
        assertEquals(2, manager.roster().players.size)
        assertFalse(manager.roster().players.last().present)
        assertTrue(seen.isNotEmpty())
        manager.shutdown()
        assertNull(manager.roster().room)
    }
    @Test fun nameAndRoomValidation() { val manager = RoomManager(); val bad = Fake(); manager.receive(bad, """{"t":"join","room":"x"}"""); assertEquals("error", bad.messages.single().getString("t")); val ok = Fake(); join(manager, ok, "t", "123456789012345"); assertEquals(12, welcome(ok).getJSONArray("players").getJSONObject(0).getString("name").length); manager.shutdown() }
}
