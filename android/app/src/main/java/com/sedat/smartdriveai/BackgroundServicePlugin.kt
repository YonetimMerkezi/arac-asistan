package com.sedat.smartdriveai

import android.content.Intent
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * BackgroundServicePlugin
 * ---------------------------------------------------------------------------
 * SmartDriveForegroundService'i JS tarafından (core/background-service.js)
 * başlatmak/durdurmak/bildirim metnini güncellemek için ince Capacitor köprüsü.
 * ---------------------------------------------------------------------------
 */
@CapacitorPlugin(
    name = "BackgroundService",
    permissions = [
        Permission(strings = [android.Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
    ],
)
class BackgroundServicePlugin : Plugin() {

    @PluginMethod
    fun start(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && getPermissionState("notifications") != com.getcapacitor.PermissionState.GRANTED
        ) {
            requestPermissionForAlias("notifications", call, "startCallback")
            return
        }
        startServiceInternal(call)
    }

    @PermissionCallback
    private fun startCallback(call: PluginCall) {
        // Bildirim izni reddedilse bile servis başlatılabilir (Android 12 ve altı
        // için izin gerekmez, üstünde bildirim görünmeyebilir ama servis çalışır).
        startServiceInternal(call)
    }

    private fun startServiceInternal(call: PluginCall) {
        val statusText = call.getString("statusText") ?: "Araç bağlantısı bekleniyor..."
        val intent = Intent(context, SmartDriveForegroundService::class.java).apply {
            putExtra(SmartDriveForegroundService.EXTRA_STATUS_TEXT, statusText)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }

        val result = JSObject()
        result.put("started", true)
        call.resolve(result)
    }

    @PluginMethod
    fun updateStatus(call: PluginCall) {
        val statusText = call.getString("statusText") ?: return call.reject("statusText zorunlu")
        val intent = Intent(context, SmartDriveForegroundService::class.java).apply {
            action = SmartDriveForegroundService.ACTION_UPDATE_STATUS
            putExtra(SmartDriveForegroundService.EXTRA_STATUS_TEXT, statusText)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
        call.resolve()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        context.stopService(Intent(context, SmartDriveForegroundService::class.java))
        call.resolve()
    }
}
