package com.stavi.terminal

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

// ─────────────────────────────────────────────────────────────
//  TerminalPackage — Registers native terminal components
// ─────────────────────────────────────────────────────────────

class TerminalPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return emptyList()
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return listOf(NativeTerminalViewManager())
    }
}
