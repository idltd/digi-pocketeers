package uk.co.pocketeers.host

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.net.URL

@RunWith(AndroidJUnit4::class)
class PocketeersServerTest {
    private lateinit var server: PocketeersServer
    private lateinit var webDir: File
    private var port = 0
    @Before fun start() {
        port = ServerSocket(0).use { it.localPort }
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        webDir = File(context.cacheDir, "test-web").apply {
            mkdirs()
            File(this, "index.html").writeText("<html><head></head><body>test</body></html>")
            File(this, "js/core").mkdirs()
            File(this, "js/core/net.js").writeText("// test")
        }
        server = PocketeersServer(webDir, port, object : HostControl {
            override fun startHotspot() {}
            override fun stopHotspot() {}
            override fun status() = org.json.JSONObject().put("server", "running")
            override fun onRoster(roster: RoomManager.Roster) {}
        })
        server.start(2_000, false)
    }
    @After fun stop() { server.stop(); webDir.deleteRecursively() }
    private fun get(path: String): Pair<Int, String?> = (URL("http://127.0.0.1:$port$path").openConnection() as HttpURLConnection).run { responseCode to contentType }
    @Test fun servesExpectedAssetsAndMissingResponse() {
        assertEquals(200, get("/").first); assertEquals("text/html; charset=utf-8", get("/").second)
        assertEquals("text/javascript; charset=utf-8", get("/js/core/net.js").second)
        assertEquals(404, get("/does-not-exist").first)
    }
    @Test fun controlSurfaceAnswersOnLoopback() {
        assertEquals(200, get("/host/status").first)
        assertEquals("application/json; charset=utf-8", get("/host/status").second)
        assertEquals(404, get("/host/nonsense").first)
    }
}
