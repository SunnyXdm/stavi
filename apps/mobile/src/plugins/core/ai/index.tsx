// ============================================================
// Core Plugin: AI Chat
// ============================================================
// Orchestration chat UI — FlashList, AIPart-based messages,
// CommandPartsDropdown grouping, streaming, approval cards,
// animated thinking indicator, and improved composer.
//
// Sessions (threads) are registered with SessionRegistry for
// PluginHeader and DrawerContent to display.

import React, { useRef, useCallback, useEffect, useMemo, memo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import {
  Sparkles,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Layers,
} from 'lucide-react-native';
import type { PluginDefinition, PluginPanelProps } from '@stavi/shared';
import type { AIPluginAPI } from '@stavi/shared';
import { colors, typography, spacing, radii } from '../../../theme';
import { textStyles } from '../../../theme/styles';
import { useConnectionStore } from '../../../stores/connection';
import { staviClient } from '../../../stores/stavi-client';
import {
  useOrchestration,
  type ApprovalRequest,
} from './useOrchestration';
import { MessageBubble } from './MessageBubble';
import { ApprovalCard } from './ApprovalCard';
import { Composer, type InteractionMode, type AccessLevel, type ModelChipInfo } from './Composer';
import { ConfigSheet, type ConfigSelection, type ProviderInfo } from './ConfigSheet';
import { ModelPopover, type PopoverSection } from './ModelPopover';
import type { AIMessage, AIPart } from './types';
import { buildToolGroupLabel } from './streaming';

// ----------------------------------------------------------
// Types for rendering
// ----------------------------------------------------------

type RenderItem =
  | { type: 'message'; data: AIMessage; key: string }
  | { type: 'approval'; data: ApprovalRequest; key: string }
  | { type: 'thinking'; key: string };

// ----------------------------------------------------------
// CommandPartsDropdown — groups tool/reasoning/step parts
// ----------------------------------------------------------

const CommandPartsDropdown = memo(function CommandPartsDropdown({
  parts,
}: {
  parts: AIPart[];
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((v) => !v), []);

  const label = buildToolGroupLabel(parts);
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <View style={dropdownStyles.container}>
      <Pressable style={dropdownStyles.header} onPress={toggle}>
        <Layers size={14} color={colors.fg.muted} />
        <Text style={dropdownStyles.label}>{label}</Text>
        <Chevron size={14} color={colors.fg.muted} />
      </Pressable>
      {expanded && (
        <View style={dropdownStyles.body}>
          {parts.map((part, i) => {
            const name =
              (part as any).toolName ??
              (part as any).name ??
              part.type;
            const isError = (part as any).state === 'error';
            const isDone = (part as any).state === 'completed';
            const dotColor = isError
              ? colors.semantic.error
              : isDone
                ? colors.semantic.success
                : colors.accent.primary;

            return (
              <View key={i} style={dropdownStyles.item}>
                <View
                  style={[dropdownStyles.dot, { backgroundColor: dotColor }]}
                />
                <Text style={dropdownStyles.itemText} numberOfLines={1}>
                  {name}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
});

const dropdownStyles = StyleSheet.create({
  container: {
    marginHorizontal: spacing[4],
    marginLeft: spacing[4] + 24 + spacing[2], // indent past assistant icon
    marginVertical: spacing[1],
    backgroundColor: colors.bg.raised,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  label: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.tertiary,
  },
  body: {
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[2],
    gap: spacing[1],
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: 2,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  itemText: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.secondary,
    fontFamily: typography.fontFamily.mono,
    flex: 1,
  },
});

// ----------------------------------------------------------
// ThinkingIndicator — animated pulsing dots
// ----------------------------------------------------------

const ThinkingIndicator = memo(function ThinkingIndicator() {
  const anim1 = useRef(new Animated.Value(0.3)).current;
  const anim2 = useRef(new Animated.Value(0.3)).current;
  const anim3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const pulse = (value: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0.3,
            duration: 400,
            useNativeDriver: true,
          }),
        ]),
      );

    const a1 = pulse(anim1, 0);
    const a2 = pulse(anim2, 150);
    const a3 = pulse(anim3, 300);
    a1.start();
    a2.start();
    a3.start();

    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, [anim1, anim2, anim3]);

  return (
    <View style={thinkingStyles.container}>
      <View style={thinkingStyles.iconWrap}>
        <Sparkles size={14} color={colors.accent.primary} />
      </View>
      <View style={thinkingStyles.dotsRow}>
        <Animated.View style={[thinkingStyles.dot, { opacity: anim1 }]} />
        <Animated.View style={[thinkingStyles.dot, { opacity: anim2 }]} />
        <Animated.View style={[thinkingStyles.dot, { opacity: anim3 }]} />
      </View>
    </View>
  );
});

const thinkingStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  iconWrap: {
    width: 24,
    height: 24,
    borderRadius: radii.full,
    backgroundColor: colors.accent.subtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent.primary,
  },
});

// ----------------------------------------------------------
// Panel Component
// ----------------------------------------------------------

function AIPanel({ instanceId, isActive, bottomBarHeight, initialState }: PluginPanelProps) {
  const connectionState = useConnectionStore((s) => s.state);
  const listRef = useRef<any>(null);
  const worktreePath = (initialState?.directory as string | undefined) ?? null;

  const {
    threads,
    aiMessages,
    approvals,
    activeThreadId,
    loading,
    providers,
    sendMessage,
    interruptTurn,
    respondToApproval,
  } = useOrchestration({ instanceId, worktreePath });

  const [popoverSection, setPopoverSection] = useState<PopoverSection>('providers');
  const [popoverVisible, setPopoverVisible] = useState(false);

  const openPopover = useCallback((section: PopoverSection) => {
    setPopoverSection(section);
    setPopoverVisible(true);
  }, []);

  // Model/mode/access state
  const [configSelection, setConfigSelection] = useState<ConfigSelection>({
    provider: '',
    modelId: '',
    modelName: 'Choose model',
    thinking: undefined,
    effort: undefined,
    fastMode: undefined,
    contextWindow: undefined,
  });
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('default');
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('supervised');

  // Derive selected model chip info
  const selectedModel: ModelChipInfo = useMemo(() => ({
    provider: configSelection.provider,
    modelName: configSelection.modelName,
    modelId: configSelection.modelId,
  }), [configSelection]);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.threadId === activeThreadId) ?? null,
    [threads, activeThreadId],
  );
  const providerLocked = Boolean(activeThread?.modelSelection?.provider);
  const selectedProvider = useMemo(
    () => (providers as ProviderInfo[]).find((provider) => provider.provider === configSelection.provider) ?? null,
    [providers, configSelection.provider],
  );
  const selectedModelRecord = useMemo(
    () => selectedProvider?.models.find((model) => model.id === configSelection.modelId) ?? null,
    [selectedProvider, configSelection.modelId],
  );
  const modelCapabilities = selectedModelRecord?.capabilities;

  const syncSelectionToModel = useCallback(
    (base: ConfigSelection, model: NonNullable<typeof selectedModelRecord> | ProviderInfo['models'][number]): ConfigSelection => ({
      ...base,
      provider: model.provider,
      modelId: model.id,
      modelName: model.name,
      thinking: model.capabilities.supportsThinkingToggle ? (base.thinking ?? true) : undefined,
      effort:
        model.capabilities.reasoningEffortLevels.find((level) => level.value === base.effort)?.value ??
        model.capabilities.reasoningEffortLevels.find((level) => level.isDefault)?.value,
      fastMode: model.capabilities.supportsFastMode ? (base.fastMode ?? false) : undefined,
      contextWindow:
        model.capabilities.contextWindowOptions.find((option) => option.value === base.contextWindow)?.value ??
        model.capabilities.contextWindowOptions.find((option) => option.isDefault)?.value,
    }),
    [],
  );

  // Sync local composer controls from the active thread's persisted selection.
  useEffect(() => {
    if (activeThread?.modelSelection?.provider && activeThread.modelSelection.modelId) {
      const provider = providers.find((item: any) => item.provider === activeThread.modelSelection?.provider);
      const model = provider?.models?.find((item: any) => item.id === activeThread.modelSelection?.modelId);
      if (model) {
        setConfigSelection((prev) =>
          syncSelectionToModel(
            {
              ...prev,
              provider: activeThread.modelSelection!.provider,
              modelId: activeThread.modelSelection!.modelId,
              modelName: model.name,
              thinking: activeThread.modelSelection?.thinking,
              effort: activeThread.modelSelection?.effort,
              fastMode: activeThread.modelSelection?.fastMode,
              contextWindow: activeThread.modelSelection?.contextWindow,
            },
            model,
          ),
        );
      }
    } else if (!providerLocked && configSelection.provider) {
      const provider = providers.find((item: any) => item.provider === configSelection.provider);
      const model = provider?.models?.find((item: any) => item.id === configSelection.modelId);
      if (model) {
        setConfigSelection((prev) => syncSelectionToModel(prev, model));
      }
    }
  }, [activeThread, configSelection.modelId, configSelection.provider, providerLocked, providers, syncSelectionToModel]);

  // Get active thread data
  const activeAIMessages = activeThreadId
    ? aiMessages.get(activeThreadId) || []
    : [];
  const activeApprovals = activeThreadId
    ? approvals.get(activeThreadId) || []
    : [];

  // Check if the AI is currently working (last message is streaming)
  const isWorking = useMemo(() => {
    const lastMsg = activeAIMessages[activeAIMessages.length - 1];
    return lastMsg?.role === 'assistant' && lastMsg.streaming === true;
  }, [activeAIMessages]);

  // Build render items
  const renderItems = useMemo((): RenderItem[] => {
    const items: RenderItem[] = [];

    for (const msg of activeAIMessages) {
      items.push({
        type: 'message',
        data: msg,
        key: msg.messageId,
      });
    }

    // Pending approvals
    for (const approval of activeApprovals) {
      if (approval.pending) {
        items.push({
          type: 'approval',
          data: approval,
          key: `approval-${approval.requestId}`,
        });
      }
    }

    // Pending approvals
    // (already added above)

    // Only show thinking indicator when the AI is working but hasn't started
    // producing any text yet (once text arrives, the streaming cursor shows instead)
    if (isWorking) {
      const lastMsg = activeAIMessages[activeAIMessages.length - 1];
      const hasContent = lastMsg?.parts?.some(
        (p) => (p.type === 'text' && (p as any).text?.length > 0) ||
               p.type === 'reasoning' ||
               p.type === 'tool-call',
      );
      if (!hasContent) {
        items.push({ type: 'thinking', key: 'thinking' });
      }
    }

    return items;
  }, [activeAIMessages, activeApprovals, isWorking]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (renderItems.length > 0 && isActive) {
      setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [renderItems.length, isActive]);

  // Handle send
  const handleSend = useCallback(
    async (text: string) => {
      try {
        const selection = configSelection;
        if (!selection.provider || !selection.modelId) {
          openPopover('providers');
          return;
        }

        await sendMessage(text, undefined, {
          modelSelection: {
            provider: selection.provider,
            modelId: selection.modelId,
            thinking: selection.thinking,
            effort: selection.effort,
            fastMode: selection.fastMode,
            contextWindow: selection.contextWindow,
          },
          interactionMode,
          accessLevel,
        });
      } catch (err) {
        console.error('[AI] Send error:', err);
      }
    },
    [sendMessage, configSelection, interactionMode, accessLevel, providers, openPopover, syncSelectionToModel],
  );

  // Handle interrupt
  const handleInterrupt = useCallback(async () => {
    try {
      await interruptTurn();
    } catch (err) {
      console.error('[AI] Interrupt error:', err);
    }
  }, [interruptTurn]);

  // Handle approval response
  const handleApprovalRespond = useCallback(
    async (
      threadId: string,
      requestId: string,
      decision: 'accept' | 'reject' | 'always-allow',
    ) => {
      await respondToApproval(threadId, requestId, decision);
    },
    [respondToApproval],
  );

  // Render item
  const renderItem = useCallback(
    ({ item }: { item: RenderItem }) => {
      switch (item.type) {
        case 'message':
          return <MessageBubble message={item.data} />;
        case 'approval':
          return (
            <ApprovalCard
              approval={item.data}
              onRespond={handleApprovalRespond}
            />
          );
        case 'thinking':
          return <ThinkingIndicator />;
        default:
          return null;
      }
    },
    [handleApprovalRespond],
  );

  const keyExtractor = useCallback((item: RenderItem) => item.key, []);

  // Not connected
  if (connectionState !== 'connected') {
    return (
      <View style={styles.empty}>
        <Sparkles size={32} color={colors.fg.muted} />
        <Text
          style={[
            textStyles.body,
            { color: colors.fg.muted, textAlign: 'center' },
          ]}
        >
          Connect to a server to start an AI session
        </Text>
      </View>
    );
  }

  // Loading
  if (loading) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator size="small" color={colors.accent.primary} />
        <Text style={[textStyles.bodySmall, { color: colors.fg.tertiary }]}>
          Loading sessions...
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={bottomBarHeight + 44}
    >
      {/* Messages */}
      {activeAIMessages.length === 0 ? (
        <View style={styles.emptyChat}>
          <Sparkles size={40} color={colors.accent.subtle} />
          <Text style={styles.emptyChatTitle}>
            {worktreePath ? worktreePath.split('/').filter(Boolean).pop() : 'New AI tab'}
          </Text>
          <Text style={styles.emptyChatSubtitle}>
            Pick a provider below, then send the first message to lock this tab to that provider.
          </Text>
        </View>
      ) : (
        <FlashList
          ref={listRef}
          data={renderItems}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => {
            listRef.current?.scrollToEnd({ animated: false });
          }}
        />
      )}

      {/* Composer */}
      <Composer
        onSend={handleSend}
        onInterrupt={handleInterrupt}
        onProviderPress={() => openPopover(providerLocked ? 'models' : 'providers')}
        onModelPress={() => openPopover(configSelection.provider ? 'models' : 'providers')}
        onEffortPress={modelCapabilities?.reasoningEffortLevels.length ? () => openPopover('effort') : undefined}
        onThinkingPress={modelCapabilities?.supportsThinkingToggle ? () => openPopover('thinking') : undefined}
        onFastModePress={modelCapabilities?.supportsFastMode ? () => openPopover('fastMode') : undefined}
        onContextWindowPress={modelCapabilities?.contextWindowOptions.length ? () => openPopover('contextWindow') : undefined}
        onModePress={() => setInteractionMode((m) => m === 'default' ? 'plan' : 'default')}
        onAccessPress={() => openPopover('access')}
        isWorking={isWorking}
        selectedModel={selectedModel}
        mode={interactionMode}
        accessLevel={accessLevel}
        effort={configSelection.effort}
        thinkingEnabled={configSelection.thinking}
        showThinkingToggle={Boolean(modelCapabilities?.supportsThinkingToggle)}
        fastMode={Boolean(configSelection.fastMode)}
        showFastModeToggle={Boolean(modelCapabilities?.supportsFastMode)}
        contextWindowLabel={
          modelCapabilities?.contextWindowOptions.length
            ? modelCapabilities.contextWindowOptions.find((option) => option.value === configSelection.contextWindow)?.label
              ?? modelCapabilities.contextWindowOptions.find((option) => option.isDefault)?.label
              ?? null
            : null
        }
      />

      {/* Contextual popover */}
      <ModelPopover
        visible={popoverVisible}
        section={popoverSection}
        onClose={() => setPopoverVisible(false)}
        providers={providers as ProviderInfo[]}
        selection={configSelection}
        providerLocked={providerLocked}
        onSelect={(s) => {
          const provider = (providers as ProviderInfo[]).find((item) => item.provider === s.provider);
          const model = provider?.models.find((item) => item.id === s.modelId);
          setConfigSelection(model ? syncSelectionToModel(s, model) : s);
        }}
        mode={interactionMode}
        onModeChange={setInteractionMode}
        accessLevel={accessLevel}
        onAccessChange={setAccessLevel}
      />
    </KeyboardAvoidingView>
  );
}

// ----------------------------------------------------------
// Plugin API (for GPI cross-plugin calls)
// ----------------------------------------------------------

function aiApi(): AIPluginAPI {
  return {
    sendMessage: async (text, threadId) => {
      const messageId = `msg-${Date.now()}`;
      const commandId = `cmd-${Date.now()}`;
      const config = await staviClient.request<any>('server.getConfig', {});
      const providers = Array.isArray(config?.providers) ? config.providers : [];
      const selectedProvider = providers.find((provider: any) => provider?.authenticated && provider?.installed)
        ?? providers.find((provider: any) => provider?.installed)
        ?? null;
      const selectedModel = Array.isArray(selectedProvider?.models)
        ? selectedProvider.models.find((model: any) => model?.isDefault)
          ?? selectedProvider.models[0]
        : null;

      await staviClient.request('orchestration.dispatchCommand', {
        command: {
          type: 'thread.turn.start',
          commandId,
          threadId: threadId || '',
          message: {
            messageId,
            role: 'user',
            text,
            attachments: [],
          },
          modelSelection:
            selectedProvider?.provider && (selectedModel?.id || selectedModel?.slug)
              ? {
                  provider: selectedProvider.provider,
                  modelId: selectedModel.id ?? selectedModel.slug,
                }
              : undefined,
          runtimeMode: 'approval-required',
          interactionMode: 'default',
          createdAt: new Date().toISOString(),
        },
      });

      return { threadId: threadId || '', turnId: commandId };
    },

    interruptTurn: async (threadId) => {
      await staviClient.request('orchestration.dispatchCommand', {
        command: {
          type: 'thread.turn.interrupt',
          commandId: `cmd-${Date.now()}`,
          threadId: threadId || '',
          createdAt: new Date().toISOString(),
        },
      });
    },

    respondToApproval: async (threadId, requestId, decision) => {
      await staviClient.request('orchestration.dispatchCommand', {
        command: {
          type: 'thread.approval.respond',
          commandId: `cmd-${Date.now()}`,
          threadId: threadId || '',
          requestId: requestId || '',
          decision: decision || 'accept',
          createdAt: new Date().toISOString(),
        },
      });
    },

    listThreads: async () => {
      const snapshot = await staviClient.request<{ threads: any[] }>(
        'orchestration.getSnapshot',
        {},
      );
      return (snapshot.threads || []).map((t: any) => ({
        id: t.threadId || t.id,
        title: t.title,
      }));
    },
  };
}

// ----------------------------------------------------------
// Plugin Definition
// ----------------------------------------------------------

export const aiPlugin: PluginDefinition<AIPluginAPI> = {
  id: 'ai',
  name: 'AI',
  description: 'Claude & Codex AI coding agents',
  kind: 'core',
  icon: Sparkles,
  component: AIPanel,
  navOrder: 0,
  allowMultipleInstances: true,
  api: aiApi,
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

  // Empty chat
  emptyChat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[8],
    gap: spacing[3],
  },
  emptyChatTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.primary,
  },
  emptyChatSubtitle: {
    fontSize: typography.fontSize.base,
    color: colors.fg.tertiary,
    textAlign: 'center',
    lineHeight: typography.fontSize.base * typography.lineHeight.normal,
  },

  // Message list
  messageList: {
    paddingTop: spacing[4],
    paddingBottom: spacing[4],
  },
});
