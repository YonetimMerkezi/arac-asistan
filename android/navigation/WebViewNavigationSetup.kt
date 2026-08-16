package com.smartdriveai.navigation

import android.webkit.WebView

object WebViewNavigationSetup {
    fun install(
        webView: WebView,
        ttsBridge: SmartDriveTTSBridge,
        notificationBridge: SmartDriveNotificationBridge
    ) {
        webView.settings.javaScriptEnabled = true

        webView.addJavascriptInterface(
            SmartDriveNavigationBridge(webView),
            "SmartDriveNavigation"
        )
        webView.addJavascriptInterface(
            ttsBridge,
            "SmartDriveTTS"
        )
        webView.addJavascriptInterface(
            notificationBridge,
            "SmartDriveNotifications"
        )
    }
}
