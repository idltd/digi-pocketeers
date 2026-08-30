package uk.co.pocketeers.host

import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoWSD
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File

// What the served page may ask the phone to do. Only the host's own browser is
// allowed to call it, so guests cannot start or stop the hotspot they are on.
interface HostControl {
    fun startHotspot()
    fun stopHotspot()
    fun status(): JSONObject
    fun onRoster(roster: RoomManager.Roster)
    fun refreshAssets(): JSONObject
}

class PocketeersServer(private val webDir: File, port: Int, private val control: HostControl) : NanoWSD(port) {
    private val relay = RoomManager(changed = { control.onRoster(it) })
    private val sockets = mutableSetOf<Socket>()
    // Counted because a page can believe it is connected while the relay has
    // never heard from it, and there is no browser console on a pub phone.
    @Volatile var socketsOpened = 0; private set
    @Volatile var messagesSeen = 0; private set
    @Volatile var lastMessage: String? = null; private set

    override fun serveHttp(session: NanoHTTPD.IHTTPSession): NanoHTTPD.Response {
        val path = session.uri.substringBefore('?')
        if (path.startsWith("/host/")) return control(session, path)
        if (session.method != NanoHTTPD.Method.GET && session.method != NanoHTTPD.Method.HEAD) return newFixedLengthResponse(NanoHTTPD.Response.Status.METHOD_NOT_ALLOWED, "text/plain", "method not allowed")
        val asset = AssetRules.safePath(session.uri) ?: return newFixedLengthResponse(NanoHTTPD.Response.Status.BAD_REQUEST, "text/plain", "bad path")
        val file = File(webDir, asset)
        if (!file.isFile || !file.canonicalPath.startsWith(webDir.canonicalPath)) return newFixedLengthResponse(NanoHTTPD.Response.Status.NOT_FOUND, "text/plain", "not found")
        return try {
            var bytes = file.readBytes()
            if (asset == "index.html") bytes = injectOrigin(bytes, session)
            newFixedLengthResponse(NanoHTTPD.Response.Status.OK, AssetRules.mime(asset), ByteArrayInputStream(bytes), bytes.size.toLong())
            .apply { addHeader("Cache-Control", "no-store, must-revalidate") }
        } catch (_: Exception) { newFixedLengthResponse(NanoHTTPD.Response.Status.NOT_FOUND, "text/plain", "not found") }
    }

    // Each client is told the address it actually reached us on, so a guest QR
    // built from a guest's page is right even though the host itself is on
    // loopback. The value is taken from the request, never from a parameter.
    private fun injectOrigin(bytes: ByteArray, session: NanoHTTPD.IHTTPSession): ByteArray {
        val host = session.headers["host"]?.takeIf { AssetRules.HOST.matches(it) } ?: return bytes
        val origin = "http://$host".replace("&", "&amp;").replace("\"", "&quot;").replace("<", "&lt;").replace(">", "&gt;")
        return String(bytes, Charsets.UTF_8).replace("<head>", "<head><script>window.POCKETEERS_PUBLIC_ORIGIN=\"$origin\";</script>").toByteArray()
    }

    private fun control(session: NanoHTTPD.IHTTPSession, path: String): NanoHTTPD.Response {
        // A phone on the hotspot must not be able to close the hotspot, so the
        // control surface exists only for the host's own browser on loopback.
        val remote = session.remoteIpAddress
        if (remote != "127.0.0.1" && remote != "::1" && remote != "0:0:0:0:0:0:0:1")
            return json(NanoHTTPD.Response.Status.FORBIDDEN, JSONObject().put("error", "only the host phone may control hosting"))
        return when (path) {
            "/host/status" -> json(NanoHTTPD.Response.Status.OK, control.status())
            "/host/start" -> { control.startHotspot(); json(NanoHTTPD.Response.Status.ACCEPTED, control.status()) }
            "/host/stop" -> { control.stopHotspot(); json(NanoHTTPD.Response.Status.OK, control.status()) }
            "/host/refresh" -> json(NanoHTTPD.Response.Status.OK, control.refreshAssets())
            else -> json(NanoHTTPD.Response.Status.NOT_FOUND, JSONObject().put("error", "no such control"))
        }
    }

    private fun json(status: NanoHTTPD.Response.IStatus, body: JSONObject) =
        newFixedLengthResponse(status, "application/json; charset=utf-8", body.toString()).apply { addHeader("Cache-Control", "no-store") }

    override fun openWebSocket(handshake: NanoHTTPD.IHTTPSession): WebSocket = Socket(handshake).also { synchronized(sockets) { sockets += it } }
    inner class Socket(handshake: NanoHTTPD.IHTTPSession) : WebSocket(handshake), RoomManager.Client {
        override fun onOpen() { socketsOpened++ }
        override fun onClose(code: WebSocketFrame.CloseCode?, reason: String?, initiatedByRemote: Boolean) { relay.disconnected(this); synchronized(sockets) { sockets -= this } }
        override fun onMessage(frame: WebSocketFrame) { messagesSeen++; lastMessage = frame.textPayload.take(200); relay.receive(this, frame.textPayload) }
        override fun onPong(pong: WebSocketFrame) {}
        override fun onException(exception: java.io.IOException) { relay.disconnected(this) }
        override fun send(text: String) { try { super.send(text) } catch (_: Exception) {} }
        override fun close() { try { close(WebSocketFrame.CloseCode.GoingAway, "Host stopped", false) } catch (_: Exception) {} }
    }
    override fun stop() { relay.shutdown(); super.stop() }
}
