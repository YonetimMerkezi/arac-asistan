package com.smartdriveai.navigation

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import android.webkit.JavascriptInterface

class SmartDriveNotificationBridge(
    private val context: Context
) {
    private val channelId = "sda_vehicle"

    @JavascriptInterface
    fun vehicleAvailable(title: String, body: String) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(
                    channelId,
                    "Araç bağlantısı",
                    NotificationManager.IMPORTANCE_DEFAULT
                )
            )
        }

        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .build()

        manager.notify(24017, notification)
    }
}
