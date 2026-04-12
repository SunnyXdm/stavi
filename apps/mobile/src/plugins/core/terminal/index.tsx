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
// and DrawerContent to display per-instance tabs.

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SquareTerminal } from 'lucide-react-native';
import type { PluginDefinition, PluginPanelProps } from '@stavi/shared';
import type { TerminalPluginAPI } from '@stavi/shared';
import { colors, typography, spacing, radii } from '../../../theme';
import { textStyles } from '../../../theme/styles';
import NativeTerminal, { type NativeTerminalRef } from '../../../components/NativeTerminal';
import { staviClient } from '../../../stores/stavi-client';
import { useConnectionStore } from '../../../stores/connection';
import { useSessionRegistry } from '../../../stores/session-registry';

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
let sessionCounter = 0;
let serverCwd = '.';

// ----------------------------------------------------------
// Panel Component
// ----------------------------------------------------------

function TerminalPanel({ instanceId, isActive, bottomBarHeight }: PluginPanelProps) {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const connectionState = useConnectionStore((s) => s.state);
  const registerSessions = useSessionRegistry((s) => s.register);

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
      if (staviClient.getState() !== 'connected') return;

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
        const snapshot = await staviClient.request<{
          threadId: string;
          terminalId: string;
          history: string;
          status: string;
        }>('terminal.open', {
          threadId,
          terminalId,
          cwd: cwd || serverCwd,
          cols: 80,
          rows: 24,
        });

        // Write initial history if any
        const ref = getTerminalRef(sessionKey);
        if (snapshot.history && ref.current) {
          ref.current.write(snapshot.history);
        }

        // Update session status
        setSessions((prev) =>
          prev.map((s) =>
            s.threadId === threadId ? { ...s, status: 'running' } : s,
          ),
        );

        // Subscribe to terminal events
        const unsub = staviClient.subscribe(
          'subscribeTerminalEvents',
          {},
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
    [getTerminalRef],
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
        await staviClient.request('terminal.close', { threadId, terminalId });
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
    [activeSessionId],
  );

  // Handle terminal input (user typed something)
  const handleInput = useCallback(
    (threadId: string, data: string) => {
      if (staviClient.getState() !== 'connected') return;
      staviClient.request('terminal.write', { threadId, data }).catch((err) => {
        console.error('[Terminal] Write error:', err);
      });
    },
    [],
  );

  // Handle terminal resize
  const handleResize = useCallback(
    (threadId: string, cols: number, rows: number) => {
      if (staviClient.getState() !== 'connected') return;
      staviClient.request('terminal.resize', { threadId, cols, rows }).catch((err) => {
        console.error('[Terminal] Resize error:', err);
      });
    },
    [],
  );

  // Auto-create first session when connected
  useEffect(() => {
    if (connectionState === 'connected' && sessions.length === 0) {
      staviClient
        .request<{ cwd?: string }>('server.getConfig', {})
        .then((config) => {
          if (config.cwd) {
            serverCwd = config.cwd;
          }
        })
        .catch((err) => {
          console.error('[Terminal] Failed to load server config:', err);
        });
      createSession();
    }
  }, [connectionState, sessions.length, createSession]);

  // Register sessions with SessionRegistry for PluginHeader / DrawerContent
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
      <View style={styles.empty}>
        <SquareTerminal size={32} color={colors.fg.muted} />
        <Text style={[textStyles.body, { color: colors.fg.muted, textAlign: 'center' }]}>
          Connect to a server to open a terminal
        </Text>
      </View>
    );
  }

  // No sessions (shouldn't normally happen)
  if (sessions.length === 0) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator size="small" color={colors.accent.primary} />
        <Text style={[textStyles.bodySmall, { color: colors.fg.tertiary }]}>
          Opening terminal...
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Terminal views — opacity swap (never unmount) */}
      <View style={styles.terminalArea}>
        {sessions.map((session) => {
          const key = `${session.threadId}:${session.terminalId}`;
          const isVisible = key === activeSessionId;
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
              <NativeTerminal
                ref={getTerminalRef(key)}
                style={styles.terminal}
                onTerminalInput={(data) => handleInput(session.threadId, data)}
                onTerminalResize={(cols, rows) => handleResize(session.threadId, cols, rows)}
                onTerminalReady={(cols, rows) => {
                  // Resize on server to match
                  handleResize(session.threadId, cols, rows);
                }}
                onTerminalBell={() => {
                  // Could trigger haptic feedback here
                }}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ----------------------------------------------------------
// Plugin API (for GPI cross-plugin calls)
// ----------------------------------------------------------

function terminalApi(): TerminalPluginAPI {
  return {
    createSession: async (workingDir) => {
      if (staviClient.getState() !== 'connected') {
        throw new Error('Not connected');
      }
      const threadId = `stavi-term-${++sessionCounter}`;
      const snapshot = await staviClient.request<{ threadId: string }>('terminal.open', {
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
      staviClient.request('terminal.write', {
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

export const terminalPlugin: PluginDefinition<TerminalPluginAPI> = {
  id: 'terminal',
  name: 'Terminal',
  description: 'Native terminal connected to Stavi server',
  kind: 'core',
  icon: SquareTerminal,
  component: TerminalPanel,
  navOrder: 2,
  navLabel: 'Term',
  api: terminalApi,
};

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.base,
  },
  empty: {
    flex: 1,
    backgroundColor: colors.bg.base,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    padding: spacing[6],
  },

  // Terminal
  terminalArea: {
    flex: 1,
    position: 'relative',
  },
  terminalWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  terminal: {
    flex: 1,
  },
});
