package com.sedat.smartdriveai

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

/**
 * BootReceiver
 * ---------------------------------------------------------------------------
 * Telefon açılınca (BOOT_COMPLETED) - kullanıcı Ayarlar'dan bu özelliği
 * AÇIKÇA etkinleştirdiyse (bkz. BootPreference) - "Smart Drive AI'a bağlan"
 * bildirimini gösterir.
 *
 * DÜRÜSTLÜK NOTU (ÖNEMLİ MİMARİ SINIR): Bu, uygulamayı TAMAMEN GÖRÜNMEZ
 * şekilde otomatik başlatıp Bluetooth'a bağlamaz - Android 10+ arka plan
 * aktivite başlatma kısıtlamaları (background activity launch restrictions)
 * bunu güvenilir şekilde imkansız kılıyor; bunu "çalışıyormuş gibi" yapıp
 * kararsız/tutarsız bir davranış sunmak yerine DÜRÜSTÇE tek dokunuşla açılan
 * bir bildirim sunuyoruz - kullanıcı uygulamayı aramak zorunda kalmıyor,
 * yalnızca bildirime bir kez dokunuyor.
 * ---------------------------------------------------------------------------
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val CHANNEL_ID = "smart_drive_ai_boot"
        private const val NOTIFICATION_ID = 2001
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        if (!BootPreference.isAutoStartEnabled(context)) return

        showOpenNotification(context)
    }

    private fun showOpenNotification(context: Context) {
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Açılış Bildirimi",
                NotificationManager.IMPORTANCE_DEFAULT,
            )
            notificationManager.createNotificationChannel(channel)
        }

        val openAppIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            0,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setContentTitle("Smart Drive AI")
            .setContentText("Araca bağlanmak için dokunun")
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()

        notificationManager.notify(NOTIFICATION_ID, notification)
    }
}
