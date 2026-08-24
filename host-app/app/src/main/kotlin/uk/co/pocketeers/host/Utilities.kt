package uk.co.pocketeers.host

object AssetRules {
    // Host headers are echoed back into the page as an origin, so only accept
    // the characters a host:port can legitimately contain.
    val HOST = Regex("""^[A-Za-z0-9._\[\]-]{1,60}(:[0-9]{1,5})?$""")
    private val mime = mapOf("html" to "text/html; charset=utf-8", "js" to "text/javascript; charset=utf-8", "css" to "text/css; charset=utf-8", "json" to "application/json; charset=utf-8", "png" to "image/png", "svg" to "image/svg+xml", "woff2" to "font/woff2", "mp3" to "audio/mpeg")
    fun safePath(rawPath: String): String? {
        val decoded = try { java.net.URLDecoder.decode(rawPath.substringBefore('?'), "UTF-8") } catch (_: IllegalArgumentException) { return null }
        val path = if (decoded == "/") "index.html" else decoded.removePrefix("/")
        if (path.isBlank() || path.startsWith('/') || path.contains('\\') || path.split('/').any { it == ".." || it == "." }) return null
        return path
    }
    fun mime(path: String) = mime[path.substringAfterLast('.', "").lowercase()] ?: "application/octet-stream"
}
