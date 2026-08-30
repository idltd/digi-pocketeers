package uk.co.pocketeers.host

import android.content.Context
import org.json.JSONArray
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

private const val ORIGIN = "https://idltd.github.io/digi-pocketeers"
private const val CONNECT_TIMEOUT = 8_000
private const val READ_TIMEOUT = 15_000

class WebAssets(context: Context) {
    val dir: File = File(context.filesDir, "web")
    private val versionFile = File(dir, ".version")

    fun cached(): Boolean = versionFile.exists()

    fun forceRedownload(versionCode: Int, onProgress: (done: Int, total: Int) -> Unit) {
        if (versionFile.exists()) versionFile.delete()
        download(versionCode, onProgress)
    }

    // Fetch files.json from GitHub Pages, download every file it lists, write
    // a version stamp when done. The stamp is the build's version code so an
    // APK update re-downloads (picking up any new games the deployed site has).
    fun download(versionCode: Int, onProgress: (done: Int, total: Int) -> Unit) {
        if (versionFile.exists() && versionFile.readText().trim() == versionCode.toString()) return

        val manifest = fetch("$ORIGIN/files.json")
            ?: throw RuntimeException("Could not reach $ORIGIN/files.json")
        val paths = JSONArray(String(manifest))
        val total = paths.length()

        dir.mkdirs()
        for (i in 0 until total) {
            val path = paths.getString(i)
            val dest = File(dir, path)
            dest.parentFile?.mkdirs()
            val bytes = fetch("$ORIGIN/$path")
                ?: throw RuntimeException("Failed to download $path")
            dest.writeBytes(bytes)
            onProgress(i + 1, total)
        }

        versionFile.writeText(versionCode.toString())
    }

    private fun fetch(url: String): ByteArray? = try {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = CONNECT_TIMEOUT
        conn.readTimeout = READ_TIMEOUT
        conn.instanceFollowRedirects = true
        if (conn.responseCode == 200) conn.inputStream.use { it.readBytes() } else null
    } catch (_: Exception) { null }
}
