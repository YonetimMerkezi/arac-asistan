package com.smartdriveai.navigation

import android.speech.tts.TextToSpeech
import android.webkit.JavascriptInterface
import java.util.Locale

class SmartDriveTTSBridge(
    private val tts: TextToSpeech
) {
    @JavascriptInterface
    fun speak(text: String, language: String) {
        tts.language = Locale("tr", "TR")
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "SDA_NAV")
    }

    @JavascriptInterface
    fun stop() {
        tts.stop()
    }
}
