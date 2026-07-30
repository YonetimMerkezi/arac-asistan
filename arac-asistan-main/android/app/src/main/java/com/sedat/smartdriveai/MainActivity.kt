package com.sedat.smartdriveai

import android.os.Bundle
import com.getcapacitor.BridgeActivity

/**
 * MainActivity
 * ---------------------------------------------------------------------------
 * Capacitor'un ana Activity'si. Özel yazdığımız eklentileri köprüye
 * (bridge) kaydeder - aksi halde JS tarafındaki Capacitor.registerPlugin(...)
 * çağrıları native karşılıklarını bulamaz.
 *
 * NOT: Bu dosya `npx cap add android` ile tam Android proje iskeleti
 * oluşturulduğunda otomatik üretilen MainActivity.kt'nin YERİNE
 * kullanılmalıdır (registerPlugin satırları eklenmiş hali).
 * ---------------------------------------------------------------------------
 */
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(BluetoothClassicPlugin::class.java)
        registerPlugin(BackgroundServicePlugin::class.java)
        registerPlugin(AppLauncherPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
