// ============================================================
// Core Plugin: AI Chat
// ============================================================
// Orchestration chat UI — FlashList, AIPart-based messages,
// CommandPartsDropdown grouping, streaming, approval cards,
// animated thinking indicator, and improved composer.

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
import { ApiKeySetup } from './ApiKeySetup';
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

function AIPanel({ instanceId, isActive, bottomBarHeight }: PluginPanelProps) {
  const connectionState = useConnectionStore((s) => s.state);
  const listRef = useRef<any>(null);

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
    setActiveThread,
    updateSettings,
  } = useOrchestration();

  // Config sheet / API key setup visibility
  const [configVisible, setConfigVisible] = useState(false);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);

  // Model/mode/access state
  const [configSelection, setConfigSelection] = useState<ConfigSelection>({
    provider: 'claude',
    modelId: 'claude-sonnet-4-20250514',
    modelName: 'Claude Sonnet 4',
    thinking: true,
    effort: 'medium',
  });
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('default');
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('supervised');

  // Derive selected model chip info
  const selectedModel: ModelChipInfo = useMemo(() => ({
    provider: configSelection.provider,
    modelName: configSelection.modelName,
    modelId: configSelection.modelId,
  }), [configSelection]);

  // Auto-select first available model when providers load
  useEffect(() => {
    if (providers.length > 0) {
      const authenticated = providers.find((p: any) => p.authenticated);
      if (authenticated?.models?.length > 0) {
        const defaultModel = authenticated.models.find((m: any) => m.isDefault) ?? authenticated.models[0];
        setConfigSelection((prev) => ({
          ...prev,
          provider: authenticated.provider,
          modelId: defaultModel.id,
          modelName: defaultModel.name,
          thinking: defaultModel.supportsThinking ?? prev.thinking,
        }));
      }
    }
  }, [providers]);

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

    // Thinking indicator when streaming
    if (isWorking) {
      items.push({ type: 'thinking', key: 'thinking' });
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
        await sendMessage(text, undefined, {
          modelSelection: {
            provider: configSelection.provider,
            modelId: configSelection.modelId,
            thinking: configSelection.thinking,
            effort: configSelection.effort,
          },
          interactionMode,
          accessLevel,
        });
      } catch (err) {
        console.error('[AI] Send error:', err);
      }
    },
    [sendMessage, configSelection, interactionMode, accessLevel],
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

  // Visible (non-archived) threads for tab bar
  const visibleThreads = threads.filter((t) => !t.archived);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={bottomBarHeight + 44}
    >
      {/* Thread tabs */}
      {visibleThreads.length > 0 && (
        <View style={styles.tabBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabScroll}
          >
            {visibleThreads.map((thread) => {
              const isSelected = thread.threadId === activeThreadId;
              return (
                <Pressable
                  key={thread.threadId}
                  style={[styles.tab, isSelected && styles.tabActive]}
                  onPress={() => setActiveThread(thread.threadId)}
                >
                  <MessageSquare
                    size={14}
                    color={
                      isSelected
                        ? colors.accent.primary
                        : colors.fg.muted
                    }
                  />
                  <Text
                    style={[
                      styles.tabText,
                      isSelected && styles.tabTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {thread.title || 'Thread'}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Messages */}
      {activeAIMessages.length === 0 ? (
        <View style={styles.emptyChat}>
          <Sparkles size={40} color={colors.accent.subtle} />
          <Text style={styles.emptyChatTitle}>Start a conversation</Text>
          <Text style={styles.emptyChatSubtitle}>
            Ask the AI to help with coding, debugging, or anything else
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
        onOpenConfig={() => setConfigVisible(true)}
        isWorking={isWorking}
        selectedModel={selectedModel}
        mode={interactionMode}
        onModeChange={setInteractionMode}
        accessLevel={accessLevel}
        onAccessChange={setAccessLevel}
      />

      {/* Config sheet */}
      <ConfigSheet
        visible={configVisible}
        onClose={() => setConfigVisible(false)}
        providers={providers as ProviderInfo[]}
        selection={configSelection}
        onSelect={setConfigSelection}
        onSetupApiKey={() => {
          setConfigVisible(false);
          setApiKeyVisible(true);
        }}
      />

      {/* API key setup */}
      <ApiKeySetup
        visible={apiKeyVisible}
        onClose={() => setApiKeyVisible(false)}
        onSave={async (apiKey) => {
          await updateSettings({ anthropicApiKey: apiKey });
        }}
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

  // Tab bar
  tabBar: {
    backgroundColor: colors.bg.raised,
    height: 36,
  },
  tabScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    gap: spacing[1],
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radii.sm,
    height: 28,
    maxWidth: 160,
  },
  tabActive: {
    backgroundColor: colors.bg.active,
  },
  tabText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.muted,
  },
  tabTextActive: {
    color: colors.fg.primary,
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
