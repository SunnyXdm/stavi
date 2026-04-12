package com.stavi.terminal

import android.content.Context
import android.content.SharedPreferences
import android.graphics.Color
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.inputmethod.InputMethodManager
import android.widget.FrameLayout
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import com.termux.terminal.TerminalColors
import com.termux.terminal.TerminalEmulator
import com.termux.terminal.TerminalSession
import com.termux.terminal.TerminalSessionClient
import com.termux.terminal.TextStyle
import com.termux.view.TerminalView
import com.termux.view.TerminalViewClient
import java.util.Properties

// ─────────────────────────────────────────────────────────────
//  NativeTerminalView — Fabric Native Component
//
//  Wraps Termux's TerminalView as a React Native Fabric UI
//  component. Ported from CCR mobile's Old Architecture version,
//  migrated to Fabric event system.
//
//  Data flow:
//    OUTPUT  WebSocket → JS → write() command → emulator.append() → screen
//    INPUT   keyboard/IME → onCodePoint/onKeyDown → emit event → JS → WebSocket
//
//  No real shell is attached. A long-running `sleep` process
//  keeps the PTY alive so the Termux internals stay clean.
// ─────────────────────────────────────────────────────────────

class NativeTerminalView(
    context: Context,
    private val reactContext: ThemedReactContext,
) : FrameLayout(context), TerminalSessionClient, TerminalViewClient {

    // ── View ─────────────────────────────────────────────────
    private val terminalView: TerminalView = TerminalView(context, null)
    private var session: TerminalSession? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    companion object {
        private const val PREFS_NAME = "stavi_terminal_prefs"
        private const val PREF_FONT_SIZE = "font_size"
        private const val FONT_SIZE_DEFAULT = 14
        private const val FONT_SIZE_MIN = 6
        private const val FONT_SIZE_MAX = 36
    }

    // ── Preferences ──────────────────────────────────────────
    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun saveFontSize(size: Int) = prefs.edit().putInt(PREF_FONT_SIZE, size).apply()

    // ── Font / zoom ───────────────────────────────────────────
    // currentFontSize is kept as Float so the scale accumulates smoothly.
    // We only call setTextSize() (which is expensive — rebuilds the renderer
    // and recalculates cols/rows) when the integer value actually changes.
    private var currentFontSize: Float = prefs.getInt(PREF_FONT_SIZE, FONT_SIZE_DEFAULT).toFloat()
    private var lastAppliedFontSizeInt: Int = currentFontSize.toInt()
    // TerminalView passes the CUMULATIVE mScaleFactor (not the incremental
    // delta) to onScale(). We track the last value to derive the per-frame delta.
    private var lastScaleFactor: Float = 1.0f

    // ── Init ─────────────────────────────────────────────────
    init {
        terminalView.setTerminalViewClient(this)
        terminalView.setTextSize(currentFontSize.toInt())
        terminalView.setTypeface(Typeface.MONOSPACE)
        // Stavi bg.base = #161616
        terminalView.setBackgroundColor(Color.parseColor("#161616"))
        terminalView.isFocusable = true
        terminalView.isFocusableInTouchMode = true
        addView(terminalView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (session == null) {
            // Post so the view has been laid out and has real width/height
            terminalView.post { initSession() }
        }
    }

    // ── Session setup ─────────────────────────────────────────
    private fun initSession() {
        // `sleep` keeps the process alive so the PTY stays functional.
        // We never actually use this process for I/O.
        session = TerminalSession(
            "/bin/sleep", "/",
            arrayOf("999999999"),
            arrayOf(),
            null, // use default transcript rows
            this,
        )
        session!!.initializeEmulator(80, 24)
        terminalView.attachSession(session!!)
        applyColorScheme()

        terminalView.post {
            // TerminalView.updateSize() uses its own font metrics to compute
            // the correct cols/rows for the current view size.
            terminalView.updateSize()
            emitReady()
        }
    }

    // ── Stavi color scheme ───────────────────────────────────
    // Mint teal palette matching theme/tokens.ts
    private fun applyColorScheme() {
        val emu = session?.emulator ?: return
        val props = Properties().apply {
            // ANSI normal colors (colors.terminal.*)
            setProperty("color0",  "#1e1e1e") // black (bg.input)
            setProperty("color1",  "#f87171") // red (semantic.error)
            setProperty("color2",  "#4ade80") // green (semantic.success)
            setProperty("color3",  "#fbbf24") // yellow (semantic.warning)
            setProperty("color4",  "#60a5fa") // blue (semantic.info)
            setProperty("color5",  "#c084fc") // magenta
            setProperty("color6",  "#22d3ee") // cyan
            setProperty("color7",  "#e5e5e5") // white

            // ANSI bright colors
            setProperty("color8",  "#4a4a4a") // brightBlack
            setProperty("color9",  "#fca5a5") // brightRed
            setProperty("color10", "#86efac") // brightGreen
            setProperty("color11", "#fde68a") // brightYellow
            setProperty("color12", "#93c5fd") // brightBlue
            setProperty("color13", "#d8b4fe") // brightMagenta
            setProperty("color14", "#67e8f9") // brightCyan
            setProperty("color15", "#fafafa") // brightWhite (fg.primary)

            // Global colors
            setProperty("foreground", "#fafafa") // fg.primary
            setProperty("background", "#161616") // bg.base
            setProperty("cursor",     "#5fccb0") // accent.primary (mint teal)
        }
        TerminalColors.COLOR_SCHEME.updateWith(props)
        emu.mColors.reset()
        // Override directly so they survive any palette reset
        emu.mColors.mCurrentColors[TextStyle.COLOR_INDEX_FOREGROUND] = Color.parseColor("#fafafa")
        emu.mColors.mCurrentColors[TextStyle.COLOR_INDEX_BACKGROUND] = Color.parseColor("#161616")
        emu.mColors.mCurrentColors[TextStyle.COLOR_INDEX_CURSOR]     = Color.parseColor("#5fccb0")
    }

    // ── Public API (called from ViewManager via native commands) ──

    /** Render output bytes received from the WebSocket into the emulator. */
    fun writeOutput(data: String) {
        mainHandler.post {
            val emu = session?.emulator ?: return@post
            val bytes = data.toByteArray(Charsets.UTF_8)
            emu.append(bytes, bytes.size)
            terminalView.onScreenUpdated()
        }
    }

    /** Resize the emulator — called when JS sends explicit cols/rows. */
    fun resizeTerminal(cols: Int, rows: Int) {
        mainHandler.post {
            session?.updateSize(cols, rows)
            terminalView.updateSize()
        }
    }

    /** Hard-reset the emulator (clear scrollback, reapply colors). */
    fun resetTerminal() {
        mainHandler.post {
            session?.emulator?.reset()
            applyColorScheme()
            terminalView.onScreenUpdated()
        }
    }

    fun cleanup() {
        session?.finishIfRunning()
        session = null
    }

    // ── Font size helper ──────────────────────────────────────
    private fun applyFontSizeIfChanged(newSizeInt: Int) {
        if (newSizeInt == lastAppliedFontSizeInt) return
        lastAppliedFontSizeInt = newSizeInt
        terminalView.setTextSize(newSizeInt) // also calls updateSize() internally
        emitResize()
    }

    // ── Fabric Event emitters ─────────────────────────────────
    // Fabric uses the surfaceId + UIManagerHelper dispatch pattern
    // instead of the old RCTEventEmitter.receiveEvent().

    private fun emitReady() {
        val emu = session?.emulator ?: return
        val eventDispatcher = UIManagerHelper.getEventDispatcherForReactTag(reactContext, id)
        eventDispatcher?.dispatchEvent(
            TerminalSizeEvent(UIManagerHelper.getSurfaceId(reactContext), id, "topTerminalReady", emu.mColumns, emu.mRows)
        )
    }

    private fun emitResize() {
        val emu = session?.emulator ?: return
        val eventDispatcher = UIManagerHelper.getEventDispatcherForReactTag(reactContext, id)
        eventDispatcher?.dispatchEvent(
            TerminalSizeEvent(UIManagerHelper.getSurfaceId(reactContext), id, "topTerminalResize", emu.mColumns, emu.mRows)
        )
    }

    private fun emitInput(data: String) {
        val eventDispatcher = UIManagerHelper.getEventDispatcherForReactTag(reactContext, id)
        eventDispatcher?.dispatchEvent(
            TerminalInputEvent(UIManagerHelper.getSurfaceId(reactContext), id, data)
        )
    }

    private fun emitBell() {
        val eventDispatcher = UIManagerHelper.getEventDispatcherForReactTag(reactContext, id)
        eventDispatcher?.dispatchEvent(
            TerminalBellEvent(UIManagerHelper.getSurfaceId(reactContext), id)
        )
    }

    // ── TerminalSessionClient ─────────────────────────────────

    override fun onTextChanged(changedSession: TerminalSession) {
        terminalView.onScreenUpdated()
    }

    override fun onTitleChanged(changedSession: TerminalSession) {}
    override fun onSessionFinished(finishedSession: TerminalSession) {}
    override fun onCopyTextToClipboard(session: TerminalSession, text: String?) {}
    override fun onPasteTextFromClipboard(session: TerminalSession?) {}

    override fun onBell(session: TerminalSession) {
        emitBell()
    }

    override fun onColorsChanged(session: TerminalSession) {
        terminalView.postInvalidate()
    }

    override fun onTerminalCursorStateChange(state: Boolean) {}
    override fun getTerminalCursorStyle(): Int = TerminalEmulator.TERMINAL_CURSOR_STYLE_BLOCK

    override fun logError(tag: String?, message: String?) {}
    override fun logWarn(tag: String?, message: String?) {}
    override fun logInfo(tag: String?, message: String?) {}
    override fun logDebug(tag: String?, message: String?) {}
    override fun logVerbose(tag: String?, message: String?) {}
    override fun logStackTraceWithMessage(tag: String?, message: String?, e: Exception?) {}
    override fun logStackTrace(tag: String?, e: Exception?) {}

    // ── TerminalViewClient ────────────────────────────────────

    /**
     * Pinch-to-zoom handler.
     *
     * `scale` is the CUMULATIVE mScaleFactor, not a per-frame delta.
     * We derive the true delta by dividing by lastScaleFactor.
     */
    override fun onScale(scale: Float): Float {
        val delta = if (lastScaleFactor != 0f) scale / lastScaleFactor else 1f
        lastScaleFactor = scale
        currentFontSize = (currentFontSize * delta)
            .coerceIn(FONT_SIZE_MIN.toFloat(), FONT_SIZE_MAX.toFloat())
        val newInt = currentFontSize.toInt()
        if (newInt != lastAppliedFontSizeInt) {
            applyFontSizeIfChanged(newInt)
            saveFontSize(newInt)
        }
        return scale
    }

    override fun onSingleTapUp(e: MotionEvent?) {
        terminalView.requestFocus()
        val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        imm.showSoftInput(terminalView, InputMethodManager.SHOW_IMPLICIT)
    }

    override fun shouldBackButtonBeMappedToEscape(): Boolean = false
    override fun shouldEnforceCharBasedInput(): Boolean = true
    override fun shouldUseCtrlSpaceWorkaround(): Boolean = false
    override fun isTerminalViewSelected(): Boolean = true
    override fun copyModeChanged(copyMode: Boolean) {}

    /**
     * Intercept special keys BEFORE TerminalView writes them to the PTY queue.
     */
    override fun onKeyDown(keyCode: Int, e: KeyEvent?, session: TerminalSession?): Boolean {
        val seq = when (keyCode) {
            KeyEvent.KEYCODE_ENTER       -> "\r"
            KeyEvent.KEYCODE_DEL         -> "\u007f"        // Backspace
            KeyEvent.KEYCODE_FORWARD_DEL -> "\u001b[3~"     // Delete
            KeyEvent.KEYCODE_TAB         -> "\t"
            KeyEvent.KEYCODE_ESCAPE      -> "\u001b"
            KeyEvent.KEYCODE_DPAD_UP     -> "\u001b[A"
            KeyEvent.KEYCODE_DPAD_DOWN   -> "\u001b[B"
            KeyEvent.KEYCODE_DPAD_RIGHT  -> "\u001b[C"
            KeyEvent.KEYCODE_DPAD_LEFT   -> "\u001b[D"
            KeyEvent.KEYCODE_MOVE_HOME   -> "\u001b[H"
            KeyEvent.KEYCODE_MOVE_END    -> "\u001b[F"
            KeyEvent.KEYCODE_PAGE_UP     -> "\u001b[5~"
            KeyEvent.KEYCODE_PAGE_DOWN   -> "\u001b[6~"
            KeyEvent.KEYCODE_INSERT      -> "\u001b[2~"
            KeyEvent.KEYCODE_F1          -> "\u001bOP"
            KeyEvent.KEYCODE_F2          -> "\u001bOQ"
            KeyEvent.KEYCODE_F3          -> "\u001bOR"
            KeyEvent.KEYCODE_F4          -> "\u001bOS"
            KeyEvent.KEYCODE_F5          -> "\u001b[15~"
            KeyEvent.KEYCODE_F6          -> "\u001b[17~"
            KeyEvent.KEYCODE_F7          -> "\u001b[18~"
            KeyEvent.KEYCODE_F8          -> "\u001b[19~"
            KeyEvent.KEYCODE_F9          -> "\u001b[20~"
            KeyEvent.KEYCODE_F10         -> "\u001b[21~"
            KeyEvent.KEYCODE_F11         -> "\u001b[23~"
            KeyEvent.KEYCODE_F12         -> "\u001b[24~"
            else -> null
        }
        if (seq != null) {
            emitInput(seq)
            return true
        }
        return false
    }

    override fun onKeyUp(keyCode: Int, e: KeyEvent?): Boolean = false
    override fun onLongPress(event: MotionEvent?): Boolean = false

    override fun readControlKey(): Boolean = false
    override fun readAltKey(): Boolean = false
    override fun readShiftKey(): Boolean = false
    override fun readFnKey(): Boolean = false

    /**
     * Intercept ALL printable input from the IME. Returning true prevents
     * any write to the PTY queue — we route everything through WebSocket.
     */
    override fun onCodePoint(codePoint: Int, ctrlDown: Boolean, session: TerminalSession?): Boolean {
        val data = if (ctrlDown) {
            when (codePoint) {
                in 'a'.code..'z'.code -> (codePoint - 'a'.code + 1).toChar().toString()
                in 'A'.code..'Z'.code -> (codePoint - 'A'.code + 1).toChar().toString()
                else -> String(Character.toChars(codePoint))
            }
        } else {
            String(Character.toChars(codePoint))
        }
        emitInput(data)
        return true
    }

    override fun onEmulatorSet() {
        terminalView.post { terminalView.updateSize() }
    }
}

// ─────────────────────────────────────────────────────────────
//  Fabric Event classes
// ─────────────────────────────────────────────────────────────

/** Terminal input event (user typed something) */
class TerminalInputEvent(
    surfaceId: Int,
    viewId: Int,
    private val data: String,
) : Event<TerminalInputEvent>(surfaceId, viewId) {
    override fun getEventName() = "topTerminalInput"
    override fun getEventData(): WritableMap = Arguments.createMap().apply {
        putString("data", data)
    }
}

/** Terminal size event (ready or resize) */
class TerminalSizeEvent(
    surfaceId: Int,
    viewId: Int,
    private val terminalEventName: String,
    private val cols: Int,
    private val rows: Int,
) : Event<TerminalSizeEvent>(surfaceId, viewId) {
    override fun getEventName() = terminalEventName
    override fun getEventData(): WritableMap = Arguments.createMap().apply {
        putInt("cols", cols)
        putInt("rows", rows)
    }
}

/** Terminal bell event */
class TerminalBellEvent(
    surfaceId: Int,
    viewId: Int,
) : Event<TerminalBellEvent>(surfaceId, viewId) {
    override fun getEventName() = "topTerminalBell"
    override fun getEventData(): WritableMap = Arguments.createMap()
}
