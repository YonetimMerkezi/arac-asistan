package com.sedat.smartdriveai

import android.content.Intent
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * AppLauncherPlugin
 * ---------------------------------------------------------------------------
 * Diger yuklu uygulamalari (ör. bir muzik uygulamasi) paket adina gore
 * baslatan minimal native eklenti.
 *
 * NEDEN GEREKLI: Capacitor'un standart API'si (ve web platformu genel
 * olarak) "başka bir uygulamayi ac" islemine izin vermez - bu yalnizca
 * native (Android Intent) katmaninda mumkundur. Sesli "muzik ac" komutunun
 * (bkz. voice/voice-commands.js) calisabilmesi icin bu kopru gerekli.
 *
 * Tek sorumluluk: yalnizca "paket adi -> baslat" ve "paket yukl u mu" -
 * hangi muzik uygulamasinin denenecegine JS tarafi (core/app-launcher.js)
 * karar verir.
 * ---------------------------------------------------------------------------
 */
@CapacitorPlugin(name = "AppLauncher")
class AppLauncherPlugin : Plugin() {

    /**
     * Verilen paket adina sahip uygulamayi, yuklu ve baslatilabilir bir
     * "launcher" niyeti varsa on plana getirir.
     */
    @PluginMethod
    fun launchApp(call: PluginCall) {
        val packageName = call.getString("packageName")
        if (packageName.isNullOrEmpty()) {
            call.reject("packageName parametresi zorunlu")
            return
        }

        try {
            val packageManager = context.packageManager
            val intent: Intent? = packageManager.getLaunchIntentForPackage(packageName)

            if (intent == null) {
                call.reject("Uygulama yuklu degil veya baslatilamiyor: $packageName")
                return
            }

            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)

            val result = JSObject()
            result.put("launched", true)
            call.resolve(result)
        } catch (e: Exception) {
            call.reject("Uygulama baslatilamadi: ${e.message}", e)
        }
    }

    /**
     * Verilen paket adinin cihazda yuklu olup olmadigini kontrol eder -
     * JS tarafi birden fazla aday muzik uygulamasi arasindan YUKLU olani
     * secmek icin bunu kullanir (bkz. core/app-launcher.js).
     */
    @PluginMethod
    fun isAppInstalled(call: PluginCall) {
        val packageName = call.getString("packageName")
        if (packageName.isNullOrEmpty()) {
            call.reject("packageName parametresi zorunlu")
            return
        }

        val installed = try {
            context.packageManager.getPackageInfo(packageName, 0)
            true
        } catch (e: Exception) {
            false
        }

        val result = JSObject()
        result.put("installed", installed)
        call.resolve(result)
    }
}
