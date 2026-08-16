package com.smartdriveai.navigation

import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

/**
 * Android WebView bridge.
 *
 * Bu sınıf UI/JS ile native navigasyon motoru arasında sözleşmeyi tanımlar.
 * Gerçek offline routing motoru projeye eklendiğinde route() içindeki
 * calculateOfflineRoute çağrısı o motorla değiştirilir.
 */
class SmartDriveNavigationBridge(
    private val webView: WebView
) {

    @JavascriptInterface
    fun route(json: String) {
        val request = JSONObject(json)
        val requestId = request.optString("requestId")
        val callback = request.optString("callback")

        // TODO: Buraya seçilen offline routing motorunun çağrısı bağlanacak.
        // Bu aşamada sessizce "motor yok" demek yerine JS'e kontrollü hata döndürülür.
        val result = JSONObject()
            .put("error", "Offline rota motoru Android bundle'a henüz eklenmedi.")

        webView.post {
            val script = "window[" + JSONObject.quote(callback) + "](" +
                result.toString() + ");"
            webView.evaluateJavascript(script, null)
        }
    }
}
