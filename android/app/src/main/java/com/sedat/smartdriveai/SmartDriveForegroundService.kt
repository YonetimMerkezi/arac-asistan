package com.sedat.smartdriveai

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

/**
 * SmartDriveForegroundService
 * ---------------------------------------------------------------------------
 * Telefon kilitliyken / uygulama arka plandayken JS tarafının (bluetooth-manager.js,
 * gps-tracker.js, sesli asistan) çalışmaya devam edebilmesi için Android'in
 * süreci öldürmesini engelleyen bir "canlı tutma" (keep-alive) servisi.
 *
 * BİLİNÇLİ MİMARİ KARARI: Bu servis Bluetooth'a KENDİSİ DOKUNMAZ. Eğer hem
 * bu native servis hem de JS tarafındaki BluetoothClassicPlugin aynı anda
 * ELM327'ye bağlanmaya çalışırsa iki ayrı soket çakışır ve bağlantı
 * kararsızlaşır. Bu yüzden servisin TEK işi:
 *   1. Android'e "önemli bir iş yapıyorum" sinyali veren kalıcı bir bildirim
 *      göstermek (foreground service şartı),
 *   2. Kısmi bir WakeLock tutarak CPU'nun uyumasını engellemek,
 * - böylece WebView içindeki JS (setInterval'lar, Bluetooth yeniden bağlanma
 * mantığı, GPS izleme) ekran kilitliyken de çalışmaya devam edebilir.
 *
 * JS tarafı bu servisi core/background-service.js üzerinden başlatıp
 * durdurur ve bildirim metnini (ör. "Bağlandı: ELM327") günceller.
 * ---------------------------------------------------------------------------
 */
class SmartDriveForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "smart_drive_ai_background"
        const val NOTIFICATION_ID = 1001
        const val ACTION_UPDATE_STATUS = "com.sedat.smartdriveai.UPDATE_STATUS"
        const val EXTRA_STATUS_TEXT = "status_text"
        const val VEHICLE_CHANNEL_ID = "smart_drive_ai_vehicle"
        const val VEHICLE_NOTIFICATION_ID = 1002

        fun showVehicleConnectedNotification(context: Context, deviceName: String) {
            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(
                    VEHICLE_CHANNEL_ID,
                    "Araç bağlantısı",
                    NotificationManager.IMPORTANCE_DEFAULT,
                ).apply { description = "Araç/OBD bağlantısı bildirimi" }
                manager.createNotificationChannel(channel)
            }
            val openIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            val pendingIntent = PendingIntent.getActivity(
                context, 1002, openIntent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val notification = NotificationCompat.Builder(context, VEHICLE_CHANNEL_ID)
                .setContentTitle("Smart Drive AI")
                .setContentText("Araç bağlantısı hazır: $deviceName")
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .build()
            manager.notify(VEHICLE_NOTIFICATION_ID, notification)
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val statusText = intent?.getStringExtra(EXTRA_STATUS_TEXT)
            ?: "Araç bağlantısı bekleniyor..."

        if (intent?.action == ACTION_UPDATE_STATUS) {
            // Servis zaten çalışıyor, yalnızca bildirim metnini güncelle.
            updateNotification(statusText)
            return START_STICKY
        }

        startForeground(NOTIFICATION_ID, buildNotification(statusText))
        acquireWakeLock()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        releaseWakeLock()
        super.onDestroy()
    }

    /**
     * Kısmi WakeLock alır - yalnızca CPU'yu uyanık tutar, ekranı AÇMAZ.
     * Pil tüketimini sınırlı tutmak için "acilse" mantığıyla, kullanıcı
     * Ayarlar'dan bu servisi açtığında (opt-in) devrededir.
     */
    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "SmartDriveAI::BackgroundConnectionLock",
        )
        wakeLock?.acquire(12 * 60 * 60 * 1000L) // Azami 12 saat - sonsuz tutmamak için güvenlik sınırı.
    }

    private fun releaseWakeLock() {
        if (wakeLock?.isHeld == true) {
            wakeLock?.release()
        }
        wakeLock = null
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            "Smart Drive AI Arka Plan",
            NotificationManager.IMPORTANCE_LOW, // Ses/uyarı olmadan sessiz sekme.
        ).apply {
            description = "Araç bağlantısı arka planda korunurken gösterilir."
        }

        val manager = getSystemService(NotificationManager::class.java)
        manager?.createNotificationChannel(channel)
    }

    private fun buildNotification(statusText: String): Notification {
        val openAppIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, openAppIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Smart Drive AI")
            .setContentText(statusText)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun updateNotification(statusText: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager?.notify(NOTIFICATION_ID, buildNotification(statusText))
    }
}
