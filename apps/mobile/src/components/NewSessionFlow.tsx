// WHAT: Three-step flow for creating a new Workspace.
// WHY:  Phase 2 requires server selection, folder selection, then title confirmation.
//       Phase 8c: removed agent picker — provider is now chosen per-chat in the AI composer.
// HOW:  Uses getClientForServer(serverId) for session.create and DirectoryPicker for folder selection.
// SEE:  apps/mobile/src/stores/connection.ts, apps/mobile/src/stores/sessions-store.ts

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import ActionSheet, { type ActionSheetRef } from 'react-native-actions-sheet';
import type { Session } from '@stavi/shared';
import { useTheme } from '../theme';
import { radii, spacing, typography } from '../theme';
import { useConnectionStore } from '../stores/connection';
import { useSessionsStore } from '../stores/sessions-store';
import { DirectoryPicker } from './DirectoryPicker';
import { AnimatedPressable } from './AnimatedPressable';

interface NewSessionFlowProps {
  visible: boolean;
  onClose: () => void;
  onCreated: (session: Session) => void;
}

type Step = 1 | 2 | 3;

type FlowStyles = ReturnType<typeof createStyles>;

function StepPill({ step, current, styles }: { step: Step; current: Step; styles: FlowStyles }) {
  const active = step <= current;
  return (
    <View style={[styles.stepPill, active && styles.stepPillActive]}>
      <Text style={[styles.stepPillText, active && styles.stepPillTextActive]}>{step}</Text>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    sheet: {
      padding: spacing[4],
      paddingTop: spacing[2],
      gap: spacing[3],
    },
    title: {
      fontSize: typography.fontSize.lg,
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.primary,
    },
    stepRow: { flexDirection: 'row', gap: spacing[2] },
    stepPill: {
      width: 24,
      height: 24,
      borderRadius: 999,
      backgroundColor: colors.bg.input,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepPillActive: { backgroundColor: colors.accent.primary },
    stepPillText: { color: colors.fg.secondary, fontSize: typography.fontSize.xs },
    stepPillTextActive: { color: colors.fg.onAccent, fontWeight: typography.fontWeight.semibold },
    label: {
      fontSize: typography.fontSize.sm,
      fontWeight: typography.fontWeight.medium,
      color: colors.fg.secondary,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
    chip: {
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      borderRadius: radii.full,
      backgroundColor: colors.bg.input,
    },
    chipActive: { backgroundColor: colors.accent.primary },
    chipInner: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
    chipDot: { width: 6, height: 6, borderRadius: 3 },
    chipText: { color: colors.fg.secondary, fontSize: typography.fontSize.sm },
    chipTextActive: { color: colors.fg.onAccent },
    chipMeta: { color: colors.fg.muted, fontSize: typography.fontSize.xs },
    inputLike: {
      backgroundColor: colors.bg.input,
      borderRadius: radii.md,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[3],
    },
    inputLikeText: { color: colors.fg.primary, fontSize: typography.fontSize.sm },
    input: {
      backgroundColor: colors.bg.input,
      borderRadius: radii.md,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[3],
      color: colors.fg.primary,
    },
    meta: { fontSize: typography.fontSize.xs, color: colors.fg.muted },
    error: { fontSize: typography.fontSize.sm, color: colors.semantic.error },
    actions: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing[2] },
    secondaryButton: {
      flex: 1,
      backgroundColor: colors.bg.input,
      borderRadius: radii.md,
      alignItems: 'center',
      paddingVertical: spacing[3],
    },
    secondaryButtonText: {
      color: colors.fg.secondary,
      fontSize: typography.fontSize.base,
      fontWeight: typography.fontWeight.medium,
    },
    primaryButton: {
      flex: 1,
      backgroundColor: colors.accent.primary,
      borderRadius: radii.md,
      alignItems: 'center',
      paddingVertical: spacing[3],
    },
    primaryButtonText: {
      color: colors.fg.onAccent,
      fontSize: typography.fontSize.base,
      fontWeight: typography.fontWeight.semibold,
    },
  });
}

export function NewSessionFlow({ visible, onClose, onCreated }: NewSessionFlowProps) {
  const savedConnections = useConnectionStore((state) => state.savedConnections);
  const connectionsById = useConnectionStore((state) => state.connectionsById);
  const getClientForServer = useConnectionStore((state) => state.getClientForServer);
  const refreshForServer = useSessionsStore((state) => state.refreshForServer);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const sheetRef = useRef<ActionSheetRef>(null);
  const [step, setStep] = useState<Step>(1);
  const [serverId, setServerId] = useState('');
  const [folder, setFolder] = useState('');
  const [title, setTitle] = useState('');
  const [showDirectoryPicker, setShowDirectoryPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const selectedServer = useMemo(
    () => savedConnections.find((connection) => connection.id === serverId) ?? null,
    [savedConnections, serverId],
  );

  const selectedServerStatus = serverId
    ? connectionsById[serverId]?.clientState ?? 'idle'
    : 'idle';
  const selectedServerOnline = selectedServerStatus === 'connected';

  const reset = useCallback(() => {
    setStep(1);
    setServerId('');
    setFolder('');
    setTitle('');
    setError(null);
  }, []);

  const closeFlow = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const moveNext = useCallback(() => {
    if (step === 1 && !serverId) {
      setError('Choose a server.');
      return;
    }
    if (step === 1 && !selectedServerOnline) {
      setError('Server is offline. Reconnect before creating a workspace.');
      return;
    }
    if (step === 2 && !folder) {
      setError('Choose a folder.');
      return;
    }
    setError(null);
    setStep((prev) => (prev === 1 ? 2 : 3));
  }, [folder, selectedServerOnline, serverId, step]);

  const moveBack = useCallback(() => {
    setError(null);
    setStep((prev) => (prev === 3 ? 2 : 1));
  }, []);

  const handleCreate = useCallback(async () => {
    if (!serverId || !folder) {
      setError('Server and folder are required.');
      return;
    }

    const client = getClientForServer(serverId);
    if (!client) {
      setError('Server client is unavailable.');
      return;
    }
    if (!selectedServerOnline) {
      setError('Server is offline. Reconnect before creating a workspace.');
      return;
    }

    try {
      setCreating(true);
      const session = await client.request<Session>('session.create', {
        folder,
        title: title.trim() || folder.split('/').filter(Boolean).pop() || 'Workspace',
        // agentRuntime omitted — defaults to 'claude' on server; provider is chosen per-chat
      });
      await refreshForServer(serverId);
      reset();
      onCreated(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setCreating(false);
    }
  }, [folder, getClientForServer, onCreated, refreshForServer, reset, selectedServerOnline, serverId, title]);

  // Keep the ActionSheet in sync with the `visible` prop. The sheet owns
  // backdrop, drag-to-dismiss, and keyboard avoidance — all previously
  // hand-rolled with Modal + KeyboardAvoidingView.
  useEffect(() => {
    if (visible) sheetRef.current?.show();
    else sheetRef.current?.hide();
  }, [visible]);

  return (
    <>
      <ActionSheet
        ref={sheetRef}
        gestureEnabled
        onClose={closeFlow}
        containerStyle={{
          backgroundColor: colors.bg.overlay,
          borderTopLeftRadius: radii.xl,
          borderTopRightRadius: radii.xl,
        }}
        indicatorStyle={{ backgroundColor: colors.fg.muted, opacity: 0.4, width: 36 }}
      >
          <View style={styles.sheet}>
            <Text style={styles.title}>New Workspace</Text>

            <View style={styles.stepRow}>
              <StepPill step={1} current={step} styles={styles} />
              <StepPill step={2} current={step} styles={styles} />
              <StepPill step={3} current={step} styles={styles} />
            </View>

            {step === 1 ? (
              <>
                <Text style={styles.label}>Pick server</Text>
                <View style={styles.chips}>
                  {savedConnections.map((connection) => {
                    const status = connectionsById[connection.id]?.clientState ?? 'idle';
                    const online = status === 'connected';
                    const selected = serverId === connection.id;
                    return (
                      <Pressable
                        key={connection.id}
                        style={[styles.chip, selected && styles.chipActive]}
                        onPress={() => {
                          setServerId(connection.id);
                          setError(null);
                        }}
                      >
                        <View style={styles.chipInner}>
                          <View
                            style={[
                              styles.chipDot,
                              { backgroundColor: online ? colors.semantic.success : colors.fg.muted },
                            ]}
                          />
                          <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                            {(connection.hostname ?? connection.name).replace(/\.local$/, '')}
                            {/* Same machine can run several servers — the port disambiguates. */}
                            <Text style={[styles.chipMeta, selected && styles.chipTextActive]}>
                              {' '}:{connection.port}
                            </Text>
                          </Text>
                          {!online ? (
                            <Text style={[styles.chipMeta, selected && styles.chipTextActive]}>
                              {status === 'reconnecting' || status === 'connecting' || status === 'authenticating'
                                ? '· connecting'
                                : '· offline'}
                            </Text>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <Text style={styles.label}>Pick folder</Text>
                <Pressable style={styles.inputLike} onPress={() => setShowDirectoryPicker(true)}>
                  <Text style={styles.inputLikeText}>
                    {!folder
                      ? 'Choose folder'
                      : folder === '.'
                        ? 'Workspace root'
                        // Display-only tilde substitution for absolute paths.
                        : folder.replace(/^\/(?:Users|home)\/[^/]+/, '~').replace(/^[A-Z]:\\Users\\[^\\]+/, '~')}
                  </Text>
                </Pressable>
                {selectedServer ? (
                  <Text style={styles.meta}>Server: {selectedServer.host}:{selectedServer.port}</Text>
                ) : null}
              </>
            ) : null}

            {step === 3 ? (
              <>
                <Text style={styles.label}>Workspace title</Text>
                <TextInput
                  style={styles.input}
                  value={title}
                  onChangeText={setTitle}
                  placeholder="My workspace"
                  placeholderTextColor={colors.fg.muted}
                  autoFocus
                />
                <Text style={styles.meta}>Provider is selected per-chat in the AI composer.</Text>
              </>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <View style={styles.actions}>
              {step > 1 ? (
                <Pressable style={styles.secondaryButton} onPress={moveBack}>
                  <Text style={styles.secondaryButtonText}>Back</Text>
                </Pressable>
              ) : (
                <Pressable style={styles.secondaryButton} onPress={closeFlow}>
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </Pressable>
              )}

              {step < 3 ? (
                <AnimatedPressable style={styles.primaryButton} onPress={moveNext} haptic="light">
                  <Text style={styles.primaryButtonText}>Next</Text>
                </AnimatedPressable>
              ) : (
                <AnimatedPressable
                  style={styles.primaryButton}
                  onPress={handleCreate}
                  disabled={creating}
                  haptic="medium"
                >
                  {creating ? (
                    <ActivityIndicator size="small" color={colors.fg.onAccent} />
                  ) : (
                    <Text style={styles.primaryButtonText}>Create</Text>
                  )}
                </AnimatedPressable>
              )}
            </View>
          </View>
      </ActionSheet>

      <DirectoryPicker
        visible={showDirectoryPicker}
        onClose={() => setShowDirectoryPicker(false)}
        onSelect={(path) => {
          setFolder(path);
          // Prefill the title with the folder name so the workspace is never
          // left blank/odd — the user can still override it on step 3.
          const folderName = path.split('/').filter(Boolean).pop();
          if (folderName && folderName !== '.' && !title.trim()) {
            setTitle(folderName);
          }
          setError(null);
          setShowDirectoryPicker(false);
        }}
        serverId={serverId}
      />
    </>
  );
}

// Styles are created via createStyles() + useMemo in NewSessionFlow (see above).
