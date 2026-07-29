package com.sedat.smartdriveai

import android.content.Context

/**
 * BootPreference
 * ---------------------------------------------------------------------------
 * "Telefon açılışında bildirim göster" tercihini saklayan KÜÇÜK, BAĞIMSIZ
 * bir native SharedPreferences deposu.
 *
 * NEDEN AYRI (Capacitor'ın kendi Preferences eklentisini KULLANMIYORUZ):
 * BootReceiver, bir BroadcastReceiver içinde çalışır - Capacitor köprüsü
 * (WebView, JS) henüz BAŞLAMAMIŞ olabilir, bu yüzden Capacitor'ın Preferences
 * eklentisine erişemez. Capacitor'ın kendi iç depolama dosya adı/biçimine
 * güvenmek (test edilmeden) kırılgan olurdu - bunun yerine BackgroundServicePlugin
 * (JS tarafından çağrılabilir) ve BootReceiver'ın İKİSİNİN DE erişebildiği
 * kendi basit dosyasını kullanıyoruz.
 * ---------------------------------------------------------------------------
 */
object BootPreference {
    private const val PREFS_NAME = "smart_drive_ai_boot_prefs"
    private const val KEY_AUTOSTART_ENABLED = "autostart_notification_enabled"

    fun isAutoStartEnabled(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_AUTOSTART_ENABLED, false) // varsayılan: KAPALI - kullanıcı açıkça açmalı.
    }

    fun setAutoStartEnabled(context: Context, enabled: Boolean) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(KEY_AUTOSTART_ENABLED, enabled).apply()
    }
}
