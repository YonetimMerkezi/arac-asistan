package com.sedat.smartdriveai

import android.os.Bundle
import com.getcapacitor.BridgeActivity

/**
 * MainActivity
 * ---------------------------------------------------------------------------
 * Capacitor'un ana Activity'si. Tek eklediğimiz şey, özel yazdığımız
 * BluetoothClassicPlugin'i köprüye (bridge) kaydetmek - aksi halde JS
 * tarafındaki Capacitor.registerPlugin('BluetoothClassic') çağrısı
 * native karşılığını bulamaz.
 *
 * NOT: Bu dosya `npx cap add android` ile tam Android proje iskeleti
 * oluşturulduğunda otomatik üretilen MainActivity.kt'nin YERİNE
 * kullanılmalıdır (registerPlugin satırı eklenmiş hali).
 * ---------------------------------------------------------------------------
 */
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(BluetoothClassicPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
