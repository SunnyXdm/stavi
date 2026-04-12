package com.stavi.terminal

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext

// ─────────────────────────────────────────────────────────────
//  NativeTerminalViewManager — native ViewManager
//
//  Kept on the legacy registration path so Android builds cleanly
//  while the JS terminal surface is used in development. The
//  manager still exposes the direct events expected by the old
//  native terminal implementation.
// ─────────────────────────────────────────────────────────────

@ReactModule(name = NativeTerminalViewManager.REACT_CLASS)
class NativeTerminalViewManager :
    SimpleViewManager<NativeTerminalView>() {

    companion object {
        const val REACT_CLASS = "NativeTerminalView"
    }

    override fun getName(): String = REACT_CLASS

    override fun createViewInstance(context: ThemedReactContext): NativeTerminalView {
        return NativeTerminalView(context, context)
    }

    // ── Event registration ───────────────────────────────────
    // Fabric uses "top" prefix convention. The codegen spec
    // declares DirectEventHandlers which map to these names.

    override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any>? {
        return mapOf(
            "topTerminalInput" to mapOf("registrationName" to "onTerminalInput"),
            "topTerminalResize" to mapOf("registrationName" to "onTerminalResize"),
            "topTerminalReady" to mapOf("registrationName" to "onTerminalReady"),
            "topTerminalBell" to mapOf("registrationName" to "onTerminalBell"),
        )
    }

    override fun receiveCommand(view: NativeTerminalView, commandId: String, args: ReadableArray?) {
        when (commandId) {
            "write" -> view.writeOutput(args?.getString(0) ?: "")
            "resize" -> {
                val cols = args?.getInt(0) ?: return
                val rows = args.getInt(1)
                view.resizeTerminal(cols, rows)
            }
            "reset" -> view.resetTerminal()
        }
    }

    // ── Cleanup ──────────────────────────────────────────────

    override fun onDropViewInstance(view: NativeTerminalView) {
        view.cleanup()
        super.onDropViewInstance(view)
    }
}
