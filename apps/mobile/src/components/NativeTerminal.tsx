// ============================================================
// NativeTerminal — Native terminal surface
// ============================================================
// On Android: renders the Fabric NativeTerminalView (Termux
// TerminalView). Imperative write/resize/reset commands are
// forwarded via codegen Commands to the native view.
//
// On iOS: falls back to a ScrollView + TextInput surface while
// the SwiftTerm integration is in development.
//
// The plugin layer always sees the same NativeTerminalRef API.

import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { colors, spacing, typography } from '../theme';
import NativeTerminalViewComponent, {
  Commands,
  type NativeTerminalViewProps,
} from '../specs/NativeTerminalViewNativeComponent';

// ----------------------------------------------------------
// Public types
// ----------------------------------------------------------

export interface NativeTerminalRef {
  /** Write output data (from server) into the terminal emulator */
  write: (data: string) => void;
  /** Resize the terminal to given cols/rows */
  resize: (cols: number, rows: number) => void;
  /** Hard-reset the terminal (clear scrollback, reapply colors) */
  reset: () => void;
}

interface NativeTerminalProps {
  style?: StyleProp<ViewStyle>;
  /** Fired when user types (keyboard/IME or special keys) */
  onTerminalInput?: (data: string) => void;
  /** Fired when terminal dimensions change */
  onTerminalResize?: (cols: number, rows: number) => void;
  /** Fired once after session init with initial cols/rows */
  onTerminalReady?: (cols: number, rows: number) => void;
  /** Fired on BEL character */
  onTerminalBell?: () => void;
}

// ----------------------------------------------------------
// Android — real Termux TerminalView via Fabric
// ----------------------------------------------------------

const AndroidTerminal = forwardRef<NativeTerminalRef, NativeTerminalProps>(
  ({ style, onTerminalInput, onTerminalResize, onTerminalReady, onTerminalBell }, ref) => {
    const nativeRef = useRef<React.ElementRef<typeof NativeTerminalViewComponent>>(null);

    useImperativeHandle(
      ref,
      () => ({
        write: (data: string) => {
          if (nativeRef.current) {
            Commands.write(nativeRef.current, data);
          }
        },
        resize: (cols: number, rows: number) => {
          if (nativeRef.current) {
            Commands.resize(nativeRef.current, cols, rows);
          }
        },
        reset: () => {
          if (nativeRef.current) {
            Commands.reset(nativeRef.current);
          }
        },
      }),
      [],
    );

    return (
      <NativeTerminalViewComponent
        ref={nativeRef}
        style={[styles.nativeTerminal, style]}
        onTerminalInput={(event) => {
          onTerminalInput?.(event.nativeEvent.data);
        }}
        onTerminalResize={(event) => {
          onTerminalResize?.(event.nativeEvent.cols, event.nativeEvent.rows);
        }}
        onTerminalReady={(event) => {
          onTerminalReady?.(event.nativeEvent.cols, event.nativeEvent.rows);
        }}
        onTerminalBell={() => {
          onTerminalBell?.();
        }}
      />
    );
  },
);

AndroidTerminal.displayName = 'AndroidTerminal';

// ----------------------------------------------------------
// iOS fallback — ScrollView + TextInput
// (SwiftTerm integration pending)
// ----------------------------------------------------------

const IOSTerminalFallback = forwardRef<NativeTerminalRef, NativeTerminalProps>(
  ({ style, onTerminalInput, onTerminalResize, onTerminalReady, onTerminalBell }, ref) => {
    const [buffer, setBuffer] = useState('');
    const [input, setInput] = useState('');
    const scrollRef = useRef<ScrollView>(null);

    const append = useCallback((data: string) => {
      setBuffer((prev) => prev + data);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        write: (data: string) => {
          append(data);
          if (data.includes('\u0007')) {
            onTerminalBell?.();
          }
        },
        resize: (cols: number, rows: number) => {
          onTerminalResize?.(cols, rows);
        },
        reset: () => {
          setBuffer('');
        },
      }),
      [append, onTerminalBell, onTerminalResize],
    );

    useEffect(() => {
      onTerminalReady?.(80, 24);
    }, [onTerminalReady]);

    useEffect(() => {
      scrollRef.current?.scrollToEnd({ animated: false });
    }, [buffer]);

    const handleSubmit = useCallback(() => {
      if (!input) return;
      onTerminalInput?.(`${input}\r`);
      setInput('');
    }, [input, onTerminalInput]);

    return (
      <View style={[styles.fallbackContainer, style]}>
        <ScrollView
          ref={scrollRef}
          style={styles.fallbackOutput}
          contentContainerStyle={styles.fallbackOutputBody}
        >
          <Text style={styles.fallbackText}>{buffer || 'Terminal ready.\n'}</Text>
        </ScrollView>
        <TextInput
          style={styles.fallbackInput}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={handleSubmit}
          placeholder="Type a command and press return"
          placeholderTextColor={colors.fg.muted}
          autoCapitalize="none"
          autoCorrect={false}
          blurOnSubmit={false}
          returnKeyType="send"
        />
      </View>
    );
  },
);

IOSTerminalFallback.displayName = 'IOSTerminalFallback';

// ----------------------------------------------------------
// Platform-switched export
// ----------------------------------------------------------

const NativeTerminal = Platform.OS === 'android' ? AndroidTerminal : IOSTerminalFallback;

export default NativeTerminal;
export type { NativeTerminalProps };

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  nativeTerminal: {
    flex: 1,
    backgroundColor: '#161616', // bg.base — must match Kotlin initSession background
  },

  // iOS fallback
  fallbackContainer: {
    flex: 1,
    backgroundColor: colors.bg.base,
  },
  fallbackOutput: {
    flex: 1,
  },
  fallbackOutputBody: {
    padding: spacing[3],
  },
  fallbackText: {
    color: colors.fg.primary,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.xs,
    lineHeight: 18,
  },
  fallbackInput: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    color: colors.fg.primary,
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.sm,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
  },
});
