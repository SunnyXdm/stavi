// ============================================================
// Core Plugin: AI Chat
// ============================================================
// Orchestration chat UI — FlashList, AIPart-based messages,
// CommandPartsDropdown grouping, streaming, approval cards,
// animated thinking indicator, and improved composer.
//
// Sessions (threads) are registered with SessionRegistry for
// WorkspaceSidebarChats to display.

import React, { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
} from 'react-native';
import Reanimated from 'react-native-reanimated';
import { FlashList } from '@shopify/flash-list';
import { Sparkles, X } from 'lucide-react-native';
import type { WorkspacePluginDefinition, WorkspacePluginPanelProps } from '@stavi/shared';
import { useTheme } from '../../../theme';
import { EmptyView } from '../../../components/StateViews';
import { SkeletonRows } from '../../../components/Skeleton';
import { useConnectionStore } from '../../../stores/connection';
import { usePluginRegistry } from '../../../stores/plugin-registry';
import { useSessionRegistry } from '../../../stores/session-registry';
import { aiApi } from './api';
import {
  useOrchestration,
  type ApprovalRequest,
  type UserInputRequest,
  type PlanProposal,
} from './useOrchestration';
import { MessageBubble } from './MessageBubble';
import { ApprovalCard } from './ApprovalCard';
import { PlanCard } from './PlanCard';
import { UserInputPrompt } from './components/UserInputPrompt';
import { Composer } from './Composer';
import { ModelPopover } from './ModelPopover';
import type { AIMessage } from './types';
import { ThinkingIndicator } from './components/ThinkingIndicator';
import { useModelSelection } from './hooks/useModelSelection';
import { useKeyboardPanelStyle } from '../../../hooks/useKeyboardPanelStyle';
import { createAiPanelStyles } from './aiPanelStyles';

// ----------------------------------------------------------
// Types for rendering
// ----------------------------------------------------------

type RenderItem =
  | { type: 'message'; data: AIMessage; key: string }
  | { type: 'approval'; data: ApprovalRequest; key: string }
  | { type: 'user-input'; data: UserInputRequest; key: string }
  | { type: 'plan'; data: PlanProposal; key: string }
  | { type: 'thinking'; key: string };

// ----------------------------------------------------------
// Panel Component
// ----------------------------------------------------------

function AIPanel({ instanceId, isActive, bottomBarHeight, initialState, session }: WorkspacePluginPanelProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createAiPanelStyles(colors), [colors]);
  // Keeps the composer riding exactly on the keyboard top (see hook docs).
  const keyboardPad = useKeyboardPanelStyle(bottomBarHeight ?? 0);
  const connectionState = useConnectionStore((s) => s.getStatusForServer(session.serverId));
  const listRef = useRef<any>(null);
  const worktreePath = session.folder;

  const {
    threads,
    aiMessages,
    approvals,
    userInputs,
    planProposals,
    activeThreadId,
    loading,
    providers,
    sendMessage,
    interruptTurn,
    respondToApproval,
    respondToUserInput,
    dismissPlanProposal,
    setActiveThread,
    createNewChat,
  } = useOrchestration({ instanceId, worktreePath, serverId: session.serverId, sessionId: session.id });

  // Register AI threads with SessionRegistry so the drawer can show them.
  // Unregister on unmount — otherwise the drawer shows the PREVIOUS
  // workspace's chats with stale callbacks after switching sessions.
  const registerSessions = useSessionRegistry((s) => s.register);
  const unregisterSessions = useSessionRegistry((s) => s.unregister);
  useEffect(() => () => unregisterSessions('ai'), [unregisterSessions]);
  useEffect(() => {
    registerSessions('ai', {
      sessions: threads.map((t) => ({
        id: t.threadId,
        title: t.title || t.worktreePath?.split('/').filter(Boolean).pop() || 'Chat',
        subtitle: t.worktreePath ?? undefined,
        isActive: t.threadId === activeThreadId,
      })),
      activeSessionId: activeThreadId ?? undefined,
      onSelectSession: (sessionId) => { setActiveThread(sessionId); },
      onCreateSession: () => {
        createNewChat().catch((err) => console.error('[AI] createNewChat error:', err));
      },
      createLabel: 'New Chat',
    });
  }, [threads, activeThreadId, registerSessions, setActiveThread, createNewChat]);

  const activeThread = useMemo(
    () => threads.find((t) => t.threadId === activeThreadId) ?? null,
    [threads, activeThreadId],
  );

  const {
    popoverSection, popoverVisible, setPopoverVisible, openPopover,
    configSelection, setConfigSelection,
    interactionMode, setInteractionMode,
    accessLevel, setAccessLevel,
    syncSelectionToModel,
    providerLocked, showProviderSelector,
    modelCapabilities, selectedModel,
  } = useModelSelection(activeThread, providers);

  // Update tab title to show provider name (Claude / Codex)
  useEffect(() => {
    if (!configSelection.provider) return;
    const providerLabel =
      configSelection.provider === 'claude' ? 'Claude' :
      configSelection.provider === 'codex' ? 'Codex' :
      configSelection.provider;
    const dirLabel = worktreePath ? worktreePath.split('/').filter(Boolean).pop() : null;
    usePluginRegistry.setState((s) => ({
      openTabsBySession: {
        ...s.openTabsBySession,
        [session.id]: (s.openTabsBySession[session.id] ?? []).map((tab) =>
          tab.id === instanceId
            ? { ...tab, title: dirLabel ? `${dirLabel} — ${providerLabel}` : providerLabel }
            : tab,
        ),
      },
    }));
  }, [configSelection.provider, worktreePath, instanceId, session.id]);

  const activeAIMessages = activeThreadId ? aiMessages.get(activeThreadId) || [] : [];
  const activeApprovals = activeThreadId ? approvals.get(activeThreadId) || [] : [];
  const activeUserInputs = activeThreadId ? userInputs.get(activeThreadId) || [] : [];
  const activePlanProposal = activeThreadId ? planProposals.get(activeThreadId) ?? null : null;

  const isWorking = useMemo(() => {
    const lastMsg = activeAIMessages[activeAIMessages.length - 1];
    return lastMsg?.role === 'assistant' && lastMsg.streaming === true;
  }, [activeAIMessages]);

  const renderItems = useMemo((): RenderItem[] => {
    const items: RenderItem[] = [];
    for (const msg of activeAIMessages) {
      items.push({ type: 'message', data: msg, key: msg.messageId });
    }
    for (const approval of activeApprovals) {
      if (approval.pending) {
        items.push({ type: 'approval', data: approval, key: `approval-${approval.requestId}` });
      }
    }
    for (const req of activeUserInputs) {
      if (req.pending) {
        items.push({ type: 'user-input', data: req, key: `userinput-${req.requestId}` });
      }
    }
    if (activePlanProposal?.pending) {
      items.push({ type: 'plan', data: activePlanProposal, key: `plan-${activePlanProposal.threadId}` });
    }
    if (isWorking) {
      const lastMsg = activeAIMessages[activeAIMessages.length - 1];
      const hasContent = lastMsg?.parts?.some(
        (p) => (p.type === 'text' && (p as any).text?.length > 0) || p.type === 'reasoning' || p.type === 'tool-call',
      );
      if (!hasContent) items.push({ type: 'thinking', key: 'thinking' });
    }
    return items;
  }, [activeAIMessages, activeApprovals, activeUserInputs, activePlanProposal, isWorking]);

  // Autoscroll only when the user is already near the bottom (lunel pattern) —
  // unconditional scrollToEnd fought the user's finger during long streams.
  const nearBottomRef = useRef(true);
  const handleListScroll = useCallback((e: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    nearBottomRef.current =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - 120;
  }, []);

  useEffect(() => {
    if (renderItems.length > 0 && isActive && nearBottomRef.current) {
      setTimeout(() => { listRef.current?.scrollToEnd({ animated: true }); }, 100);
    }
  }, [renderItems.length, isActive]);

  const [sendError, setSendError] = useState<string | null>(null);

  const handleSend = useCallback(async (text: string) => {
    try {
      const selection = configSelection;
      if (!selection.provider || !selection.modelId) {
        openPopover('providers');
        return;
      }
      const agentRuntimeForChat: 'claude' | 'codex' | undefined =
        selection.provider === 'claude' || selection.provider === 'codex' ? selection.provider : undefined;
      setSendError(null);
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
        agentRuntime: agentRuntimeForChat,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send message';
      console.error('[AI] Send error:', err);
      setSendError(msg);
    }
  }, [sendMessage, configSelection, interactionMode, accessLevel, openPopover]);

  const handleInterrupt = useCallback(async () => {
    try { await interruptTurn(); }
    catch (err) { console.error('[AI] Interrupt error:', err); }
  }, [interruptTurn]);

  const handleApprovalRespond = useCallback(
    async (threadId: string, requestId: string, decision: 'accept' | 'reject' | 'always-allow') => {
      await respondToApproval(threadId, requestId, decision);
    },
    [respondToApproval],
  );

  // Approve the proposed plan: dismiss the card, flip to build mode, and send
  // the approval as a normal turn (explicit interactionMode override — state
  // updates are async so handleSend would still carry 'plan').
  const handlePlanApprove = useCallback((threadId: string) => {
    dismissPlanProposal(threadId);
    setInteractionMode('default');
    const selection = configSelection;
    if (!selection.provider || !selection.modelId) return;
    void sendMessage('The plan is approved — proceed with the implementation.', threadId, {
      modelSelection: {
        provider: selection.provider,
        modelId: selection.modelId,
        thinking: selection.thinking,
        effort: selection.effort,
        fastMode: selection.fastMode,
        contextWindow: selection.contextWindow,
      },
      interactionMode: 'default',
      accessLevel,
      agentRuntime: selection.provider === 'claude' || selection.provider === 'codex' ? selection.provider : undefined,
    }).catch((err) => console.error('[AI] Plan approve send error:', err));
  }, [dismissPlanProposal, setInteractionMode, configSelection, accessLevel, sendMessage]);

  const handlePlanKeepPlanning = useCallback((threadId: string) => {
    dismissPlanProposal(threadId);
  }, [dismissPlanProposal]);

  const handleCancelTurn = useCallback((threadId: string) => {
    void interruptTurn(threadId).catch((err) => console.error('[AI] Cancel turn error:', err));
  }, [interruptTurn]);

  const handleUserInputSubmit = useCallback(
    async (
      threadId: string,
      requestId: string,
      answers: Array<{ question: string; selections: string[]; notes?: string }>,
    ) => {
      await respondToUserInput(threadId, requestId, answers);
    },
    [respondToUserInput],
  );

  const pendingApprovalIds = useMemo(
    () => activeApprovals.filter((a) => a.pending).map((a) => a.requestId),
    [activeApprovals],
  );

  const renderItem = useCallback(({ item }: { item: RenderItem }) => {
    switch (item.type) {
      case 'message': return <MessageBubble message={item.data} />;
      case 'approval': return (
        <ApprovalCard
          approval={item.data}
          queueIndex={pendingApprovalIds.indexOf(item.data.requestId) + 1}
          queueTotal={pendingApprovalIds.length}
          onRespond={handleApprovalRespond}
          onCancelTurn={handleCancelTurn}
        />
      );
      case 'user-input': return <UserInputPrompt request={item.data} onSubmit={handleUserInputSubmit} />;
      case 'plan': return (
        <PlanCard proposal={item.data} onApprove={handlePlanApprove} onKeepPlanning={handlePlanKeepPlanning} />
      );
      case 'thinking': return <ThinkingIndicator />;
      default: return null;
    }
  }, [handleApprovalRespond, handleUserInputSubmit, handleCancelTurn, handlePlanApprove, handlePlanKeepPlanning, pendingApprovalIds]);

  const keyExtractor = useCallback((item: RenderItem) => item.key, []);

  if (connectionState !== 'connected') {
    return <EmptyView icon={Sparkles} title="No server connected" subtitle="Connect to a server to start an AI chat" />;
  }
  if (loading) {
    return (
      <View style={[styles.container, { padding: 16, gap: 12 }]}>
        <SkeletonRows count={4} rowHeight={64} />
      </View>
    );
  }

  return (
    <Reanimated.View style={[styles.container, keyboardPad]}>
      {/* No secondary header (lunel pattern): chats live in the drawer,
          which already has search + "New Chat". A second bar here duplicated
          the drawer and cost 44px of conversation space. */}
      {activeAIMessages.length === 0 ? (
        <View style={styles.emptyChat}>
          <Sparkles size={40} color={colors.accent.primary} style={{ opacity: 0.3 }} />
          <Text style={styles.emptyChatTitle}>
            {worktreePath.split('/').filter(Boolean).pop()}
          </Text>
          <Text style={styles.emptyChatSubtitle}>
            {configSelection.provider
              ? `Start a conversation with ${configSelection.provider === 'claude' ? 'Claude' : configSelection.provider === 'codex' ? 'Codex' : configSelection.provider}`
              : 'Select a model below and send a message to start.'}
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
          onScroll={handleListScroll}
          scrollEventThrottle={32}
          onContentSizeChange={() => {
            if (nearBottomRef.current) listRef.current?.scrollToEnd({ animated: false });
          }}
        />
      )}

      {sendError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText} numberOfLines={2}>{sendError}</Text>
          <Pressable onPress={() => setSendError(null)} hitSlop={8} style={styles.errorBannerDismiss}>
            <X size={14} color={colors.semantic.error} />
          </Pressable>
        </View>
      )}

      <Composer
        onSend={handleSend}
        onInterrupt={handleInterrupt}
        onProviderPress={() => openPopover(providerLocked || !showProviderSelector ? 'models' : 'providers')}
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
            ? modelCapabilities.contextWindowOptions.find((o) => o.value === configSelection.contextWindow)?.label
              ?? modelCapabilities.contextWindowOptions.find((o) => o.isDefault)?.label
              ?? null
            : null
        }
        slashCommands={
          providers.find((p: any) => p.provider === (selectedModel?.provider ?? configSelection.provider))?.slashCommands
        }
        onSetMode={setInteractionMode}
      />

      <ModelPopover
        visible={popoverVisible}
        section={popoverSection}
        onClose={() => setPopoverVisible(false)}
        providers={providers}
        selection={configSelection}
        providerLocked={providerLocked}
        onSelect={(s) => {
          const provider = providers.find((item: any) => item.provider === s.provider);
          const model = provider?.models.find((item: any) => item.id === s.modelId);
          setConfigSelection(model ? syncSelectionToModel(s, model) : s);
        }}
        mode={interactionMode}
        onModeChange={setInteractionMode}
        accessLevel={accessLevel}
        onAccessChange={setAccessLevel}
      />
    </Reanimated.View>
  );
}

// ----------------------------------------------------------
// Plugin Definition
// ----------------------------------------------------------

export const aiPlugin: WorkspacePluginDefinition = {
  id: 'ai',
  name: 'AI',
  description: 'Claude & Codex AI coding agents',
  scope: 'workspace',
  kind: 'core',
  icon: Sparkles,
  component: AIPanel,
  navOrder: 0,
  allowMultipleInstances: true,
  supportsSessions: true,
  api: aiApi,
  settings: {
    sections: [
      {
        title: 'Behavior',
        fields: [
          {
            key: 'defaultRuntimeMode',
            type: 'select',
            label: 'Default Approval Mode',
            default: 'approval-required',
            options: [
              { value: 'approval-required', label: 'Ask for approval' },
              { value: 'auto-accept-edits', label: 'Auto-accept edits' },
              { value: 'full-access', label: 'Full access' },
            ],
          },
          { key: 'autoScroll', type: 'boolean', label: 'Auto-scroll to bottom on new messages', default: true },
        ],
      },
    ],
  },
};
