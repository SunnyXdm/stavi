// ============================================================
// Core Plugin: Terminal
// ============================================================
// Renders native terminal views (Termux on Android, SwiftTerm
// on iOS) and wires them to Stavi's terminal RPC.
//
// Data flow:
//   Server output → subscribeTerminalEvents → write() → native emulator
//   User input → onTerminalInput → terminal.write RPC → server
//
// Sessions are registered with SessionRegistry for PluginHeader
// and WorkspaceSidebarChats to display per-instance tabs.

import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Platform, Text, View, StyleSheet } from 'react-native';
import { SquareTerminal, AlertTriangle } from 'lucide-react-native';
import type {
  WorkspacePluginDefinition,
  WorkspacePluginPanelProps,
} from '@stavi/shared';
import type { TerminalPluginAPI } from '@stavi/shared';
import { useTheme, spacing, typography } from '../../../theme';
import { EmptyView, ErrorView, LoadingView } from '../../../components/StateViews';
import NativeTerminal, { type NativeTerminalRef } from '../../../components/NativeTerminal';
import { TerminalToolbar } from '../../../components/TerminalToolbar';
import { useConnectionStore } from '../../../stores/connection';
import { useSessionRegistry } from '../../../stores/session-registry';
import { usePluginSetting } from '../../../stores/plugin-settings-store';
import { eventBus } from '../../../services/event-bus';
import { logEvent } from '../../../services/telemetry';
import { SkiaTerminalView } from './components/SkiaTerminalView';

// ----------------------------------------------------------
// Backend selection
// ----------------------------------------------------------
//
// 'webview' → xterm.js in a WebView (battle-tested, cross-platform)
// 'skia'    → GPU-rendered via @shopify/react-native-skia (iOS-only this release)
// 'native'  → Termux/SwiftTerm (not yet wired — falls through to 'webview')
//
// Android + 'skia' is not supported yet; we fall back to 'webview' and show a
// dismissible-style notice banner above the terminal.

type TerminalBackend = 'webview' | 'skia' | 'native';

function resolveEffectiveBackend(choice: TerminalBackend): 'webview' | 'skia' {
  // 'native' is declared in the schema but not implemented — fall through.
  if (choice === 'native') return 'webview';
  // Skia is iOS-only in this release.
  if (choice === 'skia' && Platform.OS !== 'ios') return 'webview';
  return choice;
}

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

interface TerminalSession {
  threadId: string;
  terminalId: string;
  label: string;
  status: 'connecting' | 'running' | 'exited' | 'error';
}

// ----------------------------------------------------------
// Module-level state (outside React for persistence across opacity-swap)
// ----------------------------------------------------------

const terminalRefs = new Map<string, React.RefObject<NativeTerminalRef | null>>();
const sessionUnsubscribes = new Map<string, () => void>();
// Pending history to write once terminal reports ready (onTerminalReady)
const pendingHistory = new Map<string, string>();
let sessionCounter = 0;
let serverCwd = '.';

// ----------------------------------------------------------
// Panel Component
// ----------------------------------------------------------

function TerminalPanel({ session }: WorkspacePluginPanelProps) {
  const { colors } = useTheme();
  const backendChoice = usePluginSetting<TerminalBackend>('terminal', 'backend');
  const effectiveBackend = resolveEffectiveBackend(backendChoice ?? 'webview');
  // Show a small notice when the user picked 'skia' on Android — we fell
  // back to WebView because Skia is iOS-only in this release.
  const showAndroidSkiaNotice =
    backendChoice === 'skia' && Platform.OS !== 'ios';
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg.base },
    terminalArea: { flex: 1, position: 'relative' },
    terminalWrapper: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    terminal: { flex: 1 },
    notice: {
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      backgroundColor: colors.bg.elevated,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    noticeText: {
      color: colors.fg.secondary,
      fontSize: typography.fontSize.xs,
      fontFamily: typography.fontFamily.sans,
    },
  }), [colors]);
  const serverId = session.serverId;
  const defaultCwd = session.folder;
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const connectionState = useConnectionStore((s) => s.getStatusForServer(serverId));
  const registerSessions = useSessionRegistry((s) => s.register);

  const getClient = useCallback(
    () => useConnectionStore.getState().getClientForServer(serverId),
    [serverId],
  );

  // Get or create a ref for a session
  const getTerminalRef = useCallback((sessionKey: string) => {
    if (!terminalRefs.has(sessionKey)) {
      terminalRefs.set(sessionKey, React.createRef<NativeTerminalRef>());
    }
    return terminalRefs.get(sessionKey)!;
  }, []);

  // Create a new terminal session
  const createSession = useCallback(
    async (cwd?: string) => {
      const client = getClient();
      if (!client || client.getState() !== 'connected') return;

      const threadId = `stavi-term-${++sessionCounter}`;
      const terminalId = 'default';
      const sessionKey = `${threadId}:${terminalId}`;

      const newSession: TerminalSession = {
        threadId,
        terminalId,
        label: `Term ${sessionCounter}`,
        status: 'connecting',
      };

      setSessions((prev) => [...prev, newSession]);
      setActiveSessionId(sessionKey);

      try {
        // Open terminal on Stavi server
        const snapshot = await client.request<{
          threadId: string;
          terminalId: string;
          history: string;
          status: string;
        }>('terminal.open', {
          threadId,
          terminalId,
          cwd: cwd || defaultCwd || serverCwd,
          cols: 80,
          rows: 24,
        });

        // Store history to be written once onTerminalReady fires.
        // Writing before the native view is sized causes ANSI parser breakage.
        if (snapshot.history) {
          pendingHistory.set(sessionKey, snapshot.history);
        }

        // Update session status
        setSessions((prev) =>
          prev.map((s) =>
            s.threadId === threadId ? { ...s, status: 'running' } : s,
          ),
        );
        logEvent('terminal.open', { serverId, threadId, cwd: cwd || defaultCwd });

        // Subscribe to terminal events
        const unsub = client.subscribe(
          'subscribeTerminalEvents',
          { threadId },
          (event: any) => {
            if (event.threadId !== threadId) return;

            const ref = getTerminalRef(sessionKey);

            switch (event.type) {
              case 'output':
                ref.current?.write(event.data);
                break;

              case 'started':
                ref.current?.reset();
                if (event.snapshot?.history) {
                  ref.current?.write(event.snapshot.history);
                }
                setSessions((prev) =>
                  prev.map((s) =>
                    s.threadId === threadId ? { ...s, status: 'running' } : s,
                  ),
                );
                break;

              case 'cleared':
                ref.current?.reset();
                break;

              case 'exited':
                setSessions((prev) =>
                  prev.map((s) =>
                    s.threadId === threadId ? { ...s, status: 'exited' } : s,
                  ),
                );
                break;

              case 'restarted':
                ref.current?.reset();
                if (event.snapshot?.history) {
                  ref.current?.write(event.snapshot.history);
                }
                setSessions((prev) =>
                  prev.map((s) =>
                    s.threadId === threadId ? { ...s, status: 'running' } : s,
                  ),
                );
                break;
            }
          },
          (error) => {
            console.error('[Terminal] Subscription error:', error);
          },
        );

        sessionUnsubscribes.set(sessionKey, unsub);
      } catch (err) {
        console.error('[Terminal] Failed to open session:', err);
        setSessions((prev) =>
          prev.map((s) =>
            s.threadId === threadId ? { ...s, status: 'error' } : s,
          ),
        );
      }
    },
    [defaultCwd, getClient, getTerminalRef],
  );

  // Close a terminal session
  const closeSession = useCallback(
    async (threadId: string, terminalId: string) => {
      const sessionKey = `${threadId}:${terminalId}`;

      // Unsubscribe
      const unsub = sessionUnsubscribes.get(sessionKey);
      unsub?.();
      sessionUnsubscribes.delete(sessionKey);
      terminalRefs.delete(sessionKey);

      // Close on server
      try {
        const client = getClient();
        await client?.request('terminal.close', { threadId, terminalId });
      } catch {
        // Ignore — session may already be closed
      }

      setSessions((prev) => prev.filter((s) => s.threadId !== threadId));

      // If we closed the active session, switch to another
      if (activeSessionId === sessionKey) {
        setSessions((prev) => {
          const remaining = prev.filter((s) => s.threadId !== threadId);
          if (remaining.length > 0) {
            const last = remaining[remaining.length - 1];
            setActiveSessionId(`${last.threadId}:${last.terminalId}`);
          } else {
            setActiveSessionId(null);
          }
          return remaining;
        });
      }
    },
    [activeSessionId, getClient],
  );

  // Handle terminal input (user typed something)
  const handleInput = useCallback(
    (threadId: string, data: string) => {
      const client = getClient();
      if (!client || client.getState() !== 'connected') return;
      client.request('terminal.write', { threadId, data }).catch((err) => {
        console.error('[Terminal] Write error:', err);
      });
    },
    [getClient],
  );

  // Handle terminal resize
  const handleResize = useCallback(
    (threadId: string, cols: number, rows: number) => {
      const client = getClient();
      if (!client || client.getState() !== 'connected') return;
      client.request('terminal.resize', { threadId, cols, rows }).catch((err) => {
        console.error('[Terminal] Resize error:', err);
      });
    },
    [getClient],
  );

  // Clear sessions on disconnect so reconnect gets a fresh terminal
  useEffect(() => {
    if (connectionState !== 'connected' && sessions.length > 0) {
      // Tear down all subscriptions and module-level state
      for (const unsub of sessionUnsubscribes.values()) {
        unsub();
      }
      sessionUnsubscribes.clear();
      terminalRefs.clear();
      pendingHistory.clear();
      setSessions([]);
      setActiveSessionId(null);
    }
  }, [connectionState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-create first session when connected
  useEffect(() => {
    if (connectionState === 'connected' && sessions.length === 0) {
      createSession(defaultCwd);
    }
  }, [connectionState, createSession, defaultCwd, sessions.length]);

  // Subscribe to terminal.openHere cross-plugin event (Phase 4a)
  useEffect(() => {
    const unsub = eventBus.on('terminal.openHere', (payload) => {
      if (payload.sessionId !== session.id) return;
      if (connectionState !== 'connected') return;
      createSession(payload.cwd);
    });
    return unsub;
  }, [session.id, connectionState, createSession]);

  // Register sessions with SessionRegistry for PluginHeader / WorkspaceSidebarChats
  useEffect(() => {
    registerSessions('terminal', {
      sessions: sessions.map((s) => ({
        id: `${s.threadId}:${s.terminalId}`,
        title: s.label,
        subtitle: s.status === 'exited' ? 'Exited' : undefined,
        isActive: `${s.threadId}:${s.terminalId}` === activeSessionId,
      })),
      activeSessionId: activeSessionId ?? undefined,
      onSelectSession: (sessionId: string) => {
        setActiveSessionId(sessionId);
      },
      onCreateSession: () => {
        createSession();
      },
      createLabel: 'New Terminal',
    });
  }, [sessions, activeSessionId, registerSessions, createSession]);

  // Not connected state
  if (connectionState !== 'connected') {
    return (
      <EmptyView
        icon={SquareTerminal}
        title="No server connected"
        subtitle="Connect to a server to open a terminal"
      />
    );
  }

  // No sessions (shouldn't normally happen)
  if (sessions.length === 0) {
    return (
      <LoadingView message="Opening terminal..." />
    );
  }

  return (
    <View style={styles.container}>
      {showAndroidSkiaNotice && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            Skia backend is iOS-only in this release. Using WebView on Android.
          </Text>
        </View>
      )}
      {/* Terminal views — opacity swap (never unmount).
          Key the area on effectiveBackend so switching remounts cleanly. */}
      <View key={effectiveBackend} style={styles.terminalArea}>
        {sessions.map((session) => {
          const key = `${session.threadId}:${session.terminalId}`;
          const isVisible = key === activeSessionId;

          // Error banner overlay for failed sessions
          if (session.status === 'error') {
            return (
              <View
                key={key}
                style={[
                  styles.terminalWrapper,
                  { opacity: isVisible ? 1 : 0, pointerEvents: isVisible ? 'auto' : 'none' },
                ]}
              >
                <ErrorView
                  icon={AlertTriangle}
                  title="Terminal failed to start"
                  message="Could not open a terminal session on the server."
                  onRetry={() => {
                    // Replace the errored session: close and reopen
                    setSessions((prev) =>
                      prev.map((s) =>
                        s.threadId === session.threadId
                          ? { ...s, status: 'connecting' }
                          : s,
                      ),
                    );
                    const client = getClient();
                    if (!client || client.getState() !== 'connected') return;
                    client
                      .request('terminal.open', {
                        threadId: session.threadId,
                        terminalId: session.terminalId,
                        cwd: defaultCwd,
                        cols: 80,
                        rows: 24,
                      })
                      .then(() => {
                        setSessions((prev) =>
                          prev.map((s) =>
                            s.threadId === session.threadId
                              ? { ...s, status: 'running' }
                              : s,
                          ),
                        );
                      })
                      .catch(() => {
                        setSessions((prev) =>
                          prev.map((s) =>
                            s.threadId === session.threadId
                              ? { ...s, status: 'error' }
                              : s,
                          ),
                        );
                      });
                  }}
                />
              </View>
            );
          }

          return (
            <View
              key={key}
              style={[
                styles.terminalWrapper,
                {
                  opacity: isVisible ? 1 : 0,
                  pointerEvents: isVisible ? 'auto' : 'none',
                },
              ]}
            >
              {effectiveBackend === 'skia' ? (
                <SkiaTerminalView
                  sessionId={session.threadId}
                  threadId={session.threadId}
                  terminalId={session.terminalId}
                />
              ) : (
                <NativeTerminal
                  ref={getTerminalRef(key)}
                  style={styles.terminal}
                  onTerminalInput={(data) => handleInput(session.threadId, data)}
                  onTerminalResize={(cols, rows) => handleResize(session.threadId, cols, rows)}
                  onTerminalReady={(cols, rows) => {
                    // Resize server PTY to match actual terminal dimensions first
                    handleResize(session.threadId, cols, rows);
                    // Now flush any buffered history — terminal is sized and ready
                    const history = pendingHistory.get(key);
                    if (history) {
                      pendingHistory.delete(key);
                      getTerminalRef(key).current?.write(history);
                    }
                  }}
                  onTerminalBell={() => {
                    // Could trigger haptic feedback here
                  }}
                />
              )}
            </View>
          );
        })}
      </View>

      {/* Keyboard toolbar — common terminal keys above the keyboard */}
      {activeSessionId && (
        <TerminalToolbar
          onKey={(data) => {
            const session = sessions.find(
              (s) => `${s.threadId}:${s.terminalId}` === activeSessionId,
            );
            if (session) handleInput(session.threadId, data);
          }}
        />
      )}
    </View>
  );
}

// ----------------------------------------------------------
// Plugin API (for GPI cross-plugin calls)
// ----------------------------------------------------------

function terminalApi(): TerminalPluginAPI {
  // Phase 5 audit: GPI createSession has no serverId context here — it falls back
  // to the first server as a best-effort. Phase 7 should pass serverId to api() or
  // use an event-bus call instead of direct client access.
  const getFallbackClient = () => {
    const firstServerId = useConnectionStore.getState().savedConnections[0]?.id;
    if (!firstServerId) return undefined;
    console.warn('[terminalApi] GPI createSession: serverId not scoped — using first server. Fix in Phase 7.');
    return useConnectionStore.getState().getClientForServer(firstServerId);
  };

  return {
    createSession: async (workingDir) => {
      const client = getFallbackClient();
      if (!client || client.getState() !== 'connected') {
        throw new Error('Not connected');
      }
      const threadId = `stavi-term-${++sessionCounter}`;
      const snapshot = await client.request<{ threadId: string }>('terminal.open', {
        threadId,
        terminalId: 'default',
        cwd: workingDir || serverCwd,
      });
      return { sessionId: threadId };
    },

    attachSession: async (sessionId) => {
      // Terminal events are already subscribed globally
    },

    sendInput: (sessionId, data) => {
      getFallbackClient()?.request('terminal.write', {
        threadId: sessionId,
        data,
      }).catch(console.error);
    },

    listSessions: async () => {
      // Get from orchestration snapshot
      return [];
    },
  };
}

// ----------------------------------------------------------
// Plugin Definition
// ----------------------------------------------------------

export const terminalPlugin: WorkspacePluginDefinition = {
  id: 'terminal',
  name: 'Terminal',
  description: 'Native terminal connected to Stavi server',
  scope: 'workspace',
  kind: 'core',
  icon: SquareTerminal,
  component: TerminalPanel,
  navOrder: 2,
  navLabel: 'Term',
  api: terminalApi,
  settings: {
    sections: [
      {
        title: 'Rendering',
        fields: [
          {
            key: 'backend',
            type: 'select',
            label: 'Rendering backend',
            description: 'Which renderer to use for terminal output',
            // Platform-aware default: Skia on iOS (GPU, 60fps), WebView on
            // Android (Skia backend is iOS-only in this release).
            default: Platform.OS === 'ios' ? 'skia' : 'webview',
            options: [
              { value: 'webview', label: 'WebView (xterm.js)', description: 'Battle-tested, default on Android' },
              { value: 'skia', label: 'Skia GPU (Beta)', description: 'iOS only, 60fps native rendering' },
              { value: 'native', label: 'Native (beta, not yet available)', description: 'SwiftTerm / Termux — falls back to WebView' },
            ],
          },
          { key: 'fontSize', type: 'number', label: 'Font Size', default: 13, min: 8, max: 24, step: 1 },
        ],
      },
    ],
  },
};

// Styles live in TerminalPanel via useMemo — see component body.
