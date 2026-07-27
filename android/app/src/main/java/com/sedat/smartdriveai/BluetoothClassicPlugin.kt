package com.sedat.smartdriveai

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.PermissionState
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * BluetoothClassicPlugin
 * ---------------------------------------------------------------------------
 * Bluetooth Classic (SPP - Serial Port Profile) uzerinden ELM327 OBD2
 * adaptorleriyle haberlesme saglayan ozel Capacitor eklentisi.
 *
 * Neden gerekli: Piyasadaki ucuz ELM327 adaptorlerinin buyuk cogunlugu
 * BLE degil, klasik Bluetooth SPP kullanir. Capacitor'un resmi/topluluk
 * eklentileri (@capacitor-community/bluetooth-le) yalnizca BLE'yi
 * destekler, bu yuzden BluetoothSocket tabanli bu native kopru yazildi.
 *
 * JS tarafi: src/bluetooth/native-bridge.js bu eklentiyi
 * Capacitor.registerPlugin('BluetoothClassic') ile cagirir.
 *
 * Tek sorumluluk: yalnizca ham byte okuma/yazma ve baglanti yasam dongusu.
 * ELM327 komut mantigi, PID ayristirma vb. JS tarafinda (obd/elm327.js)
 * yapilir - native taraf "aptal boru" (dumb pipe) olarak kalir.
 * ---------------------------------------------------------------------------
 */
@CapacitorPlugin(
    name = "BluetoothClassic",
    permissions = [
        Permission(strings = [android.Manifest.permission.BLUETOOTH_CONNECT], alias = "bluetooth"),
        Permission(strings = [android.Manifest.permission.BLUETOOTH_SCAN], alias = "bluetoothScan")
    ]
)
class BluetoothClassicPlugin : Plugin() {

    companion object {
        private const val TAG = "BluetoothClassicPlugin"

        /** Standart Seri Port Profili (SPP) UUID'si - tum ELM327 klonlarinda ortaktir. */
        private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }

    private var socket: BluetoothSocket? = null
    private var inputStream: InputStream? = null
    private var outputStream: OutputStream? = null
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()

    @Volatile
    private var readLoopActive = false

    /**
     * Eslestirilmis (paired) cihazlari dondurur. Kullanici once Android
     * sistem ayarlarindan ELM327 adaptorunu eslestirmis olmalidir.
     */
    @PluginMethod
    fun listPairedDevices(call: PluginCall) {
        if (getPermissionState("bluetooth") != PermissionState.GRANTED) {
            requestPermissionForAlias("bluetooth", call, "listPairedDevicesCallback")
            return
        }
        resolvePairedDevices(call)
    }

    @PermissionCallback
    private fun listPairedDevicesCallback(call: PluginCall) {
        if (getPermissionState("bluetooth") == PermissionState.GRANTED) {
            resolvePairedDevices(call)
        } else {
            call.reject("BLUETOOTH_CONNECT izni verilmedi")
        }
    }

    private fun resolvePairedDevices(call: PluginCall) {
        val adapter = BluetoothAdapter.getDefaultAdapter()
        if (adapter == null) {
            call.reject("Bu cihazda Bluetooth donanimi bulunamadi")
            return
        }
        if (!adapter.isEnabled) {
            call.reject("BLUETOOTH_DISABLED")
            return
        }

        try {
            val devices = JSArray()
            for (device: BluetoothDevice in adapter.bondedDevices) {
                val entry = JSObject()
                entry.put("name", device.name)
                entry.put("address", device.address)
                devices.put(entry)
            }
            val result = JSObject()
            result.put("devices", devices)
            call.resolve(result)
        } catch (e: SecurityException) {
            call.reject("Bluetooth izni eksik", e)
        }
    }

    /**
     * Verilen MAC adresine SPP uzerinden baglanir. Baglanti kurulduktan
     * sonra bir okuma dongusu baslatir ve gelen veriyi "read" event'i
     * olarak JS tarafina iletir (notifyListeners).
     */
    @PluginMethod
    fun connect(call: PluginCall) {
        val address = call.getString("address")
        if (address.isNullOrEmpty()) {
            call.reject("address parametresi zorunlu")
            return
        }

        executor.execute {
            try {
                val adapter = BluetoothAdapter.getDefaultAdapter()
                val device = adapter.getRemoteDevice(address)

                // Kesif (discovery) acikken baglanti yavaslar/basarisiz olur - once durduruyoruz.
                if (adapter.isDiscovering) {
                    adapter.cancelDiscovery()
                }

                val newSocket = device.createRfcommSocketToServiceRecord(SPP_UUID)
                newSocket.connect()
                socket = newSocket
                inputStream = newSocket.inputStream
                outputStream = newSocket.outputStream

                startReadLoop()

                val result = JSObject()
                result.put("connected", true)
                result.put("address", address)
                call.resolve(result)

                notifyListeners("connectionChange", connectionState(true, address))
            } catch (e: Exception) {
                // IOException ve SecurityException'i tek noktada yakala.
                Log.e(TAG, "Baglanti hatasi: $address", e)
                closeQuietly()
                call.reject("Baglanti kurulamadi: ${e.message}", e)
                notifyListeners("connectionChange", connectionState(false, address))
            }
        }
    }

    /**
     * ELM327'ye ham komut byte dizisi gonderir (or. "ATZ\r").
     * Komut olusturma/parse etme mantigi JS tarafindadir; bu metot
     * yalnizca aktarim katmanidir.
     */
    @PluginMethod
    fun write(call: PluginCall) {
        val data = call.getString("data")
        if (data == null) {
            call.reject("data parametresi zorunlu")
            return
        }
        val stream = outputStream
        if (stream == null) {
            call.reject("Aktif baglanti yok")
            return
        }

        executor.execute {
            try {
                stream.write(data.toByteArray())
                stream.flush()
                call.resolve()
            } catch (e: IOException) {
                Log.e(TAG, "Yazma hatasi", e)
                call.reject("Veri gonderilemedi: ${e.message}", e)
                handleUnexpectedDisconnect()
            }
        }
    }

    /**
     * Baglantiyi kapatir ve tum kaynaklari serbest birakir (bellek
     * sizintisini onlemek icin akis/soket referanslari null'a cekilir).
     */
    @PluginMethod
    fun disconnect(call: PluginCall) {
        readLoopActive = false
        closeQuietly()
        call.resolve()
        notifyListeners("connectionChange", connectionState(false, null))
    }

    /**
     * Soketten surekli okuma yapan arka plan dongusu. Gelen her veri
     * parcasi "read" event'i olarak JS tarafina gonderilir; ham byte
     * akisini komutlara ayirma (ELM327 "\r>" sonlandiricisina gore)
     * JS tarafinda (obd/elm327.js) yapilir.
     */
    private fun startReadLoop() {
        readLoopActive = true
        executor.execute {
            val buffer = ByteArray(1024)
            while (readLoopActive) {
                try {
                    val stream = inputStream ?: throw IOException("inputStream null")
                    val bytesRead = stream.read(buffer)
                    if (bytesRead == -1) {
                        throw IOException("Akis kapandi (bytesRead == -1)")
                    }
                    val chunk = String(buffer, 0, bytesRead)
                    val payload = JSObject()
                    payload.put("data", chunk)
                    notifyListeners("read", payload)
                } catch (e: IOException) {
                    if (readLoopActive) {
                        Log.w(TAG, "Okuma donguesunde baglanti koptu", e)
                        handleUnexpectedDisconnect()
                    }
                    break
                }
            }
        }
    }

    /**
     * Beklenmedik bir kopma tespit edildiginde cagrilir. JS tarafindaki
     * bluetooth-manager.js "connectionChange" event'ini dinleyerek
     * otomatik yeniden baglanma mantigini tetikler.
     */
    private fun handleUnexpectedDisconnect() {
        readLoopActive = false
        closeQuietly()
        notifyListeners("connectionChange", connectionState(false, null))
    }

    private fun connectionState(connected: Boolean, address: String?): JSObject {
        val state = JSObject()
        state.put("connected", connected)
        if (address != null) {
            state.put("address", address)
        }
        return state
    }

    /**
     * Tum akis/soket kaynaklarini guvenli bicimde kapatir. Bellek
     * sizintisini onlemek icin referanslar her durumda null'a cekilir.
     */
    private fun closeQuietly() {
        try {
            inputStream?.close()
        } catch (ignored: IOException) {
        }
        try {
            outputStream?.close()
        } catch (ignored: IOException) {
        }
        try {
            socket?.close()
        } catch (ignored: IOException) {
        }
        inputStream = null
        outputStream = null
        socket = null
    }

    override fun handleOnDestroy() {
        readLoopActive = false
        closeQuietly()
        executor.shutdownNow()
        super.handleOnDestroy()
    }
}
