package uk.co.pocketeers.host

import org.junit.Assert.*
import org.junit.Test

class UtilitiesTest {
    @Test fun safePaths() {
        assertEquals("index.html", AssetRules.safePath("/")); assertEquals("js/core/net.js", AssetRules.safePath("/js/core/net.js?x=1"))
        assertNull(AssetRules.safePath("/../secret")); assertNull(AssetRules.safePath("/%2e%2e/secret")); assertNull(AssetRules.safePath("/js\\secret")); assertNull(AssetRules.safePath("/%ZZ"))
    }
    @Test fun mimeTypes() { assertEquals("text/javascript; charset=utf-8", AssetRules.mime("a.js")); assertEquals("audio/mpeg", AssetRules.mime("a.mp3")); assertEquals("application/octet-stream", AssetRules.mime("a.bin")) }
}
