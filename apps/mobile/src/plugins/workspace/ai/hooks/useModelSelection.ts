// ============================================================
// useModelSelection — manages AI model/provider/mode/access state
// ============================================================
// Extracted from ai/index.tsx (Phase 8g split).
// Owns: configSelection, interactionMode, accessLevel, popover state,
// syncSelectionToModel, and effects that sync from active thread.

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { Thread } from '../useOrchestration';
import type { ConfigSelection, ProviderInfo } from '../ConfigSheet';
import type { InteractionMode, AccessLevel, ModelChipInfo } from '../Composer';
import type { PopoverSection } from '../ModelPopover';

export { InteractionMode, AccessLevel, ModelChipInfo };

export function useModelSelection(
  activeThread: Thread | null,
  providers: any[],
) {
  const [popoverSection, setPopoverSection] = useState<PopoverSection>('providers');
  const [popoverVisible, setPopoverVisible] = useState(false);

  const openPopover = useCallback((section: PopoverSection) => {
    setPopoverSection(section);
    setPopoverVisible(true);
  }, []);

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

  // Rehydrate the access chip from the active thread's persisted runtimeMode —
  // a bare useState reset to 'supervised' on every remount, silently dropping
  // the user's choice (and desyncing from what the server actually enforces).
  const threadRuntimeMode = activeThread?.runtimeMode;
  useEffect(() => {
    if (!threadRuntimeMode) return;
    const mapped: AccessLevel =
      threadRuntimeMode === 'full-access' ? 'full-access'
        : threadRuntimeMode === 'auto-accept-edits' ? 'auto-accept'
          : 'supervised';
    setAccessLevel(mapped);
  }, [threadRuntimeMode]);

  const syncSelectionToModel = useCallback(
    (base: ConfigSelection, model: ProviderInfo['models'][number]): ConfigSelection => ({
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

  const providerLocked = Boolean(activeThread?.modelSelection?.provider);

  const availableProviders = useMemo(
    () => (providers as ProviderInfo[]).filter((p) => p.installed && p.authenticated),
    [providers],
  );
  const showProviderSelector = availableProviders.length > 1;

  const selectedProvider = useMemo(
    () => (providers as ProviderInfo[]).find((p) => p.provider === configSelection.provider) ?? null,
    [providers, configSelection.provider],
  );
  const selectedModelRecord = useMemo(
    () => selectedProvider?.models.find((m) => m.id === configSelection.modelId) ?? null,
    [selectedProvider, configSelection.modelId],
  );
  const modelCapabilities = selectedModelRecord?.capabilities;

  // Derive selected model chip info for Composer
  const selectedModel: ModelChipInfo = useMemo(() => ({
    provider: configSelection.provider,
    modelName: configSelection.modelName,
    modelId: configSelection.modelId,
  }), [configSelection]);

  // Sync local composer controls from the active thread's persisted selection.
  //
  // CRITICAL: this must run only when the THREAD (or its stored selection)
  // changes — never in response to local configSelection edits. The old
  // version had configSelection.modelId in its deps, so picking a new model
  // re-ran the effect and instantly reverted the pick to the thread's stored
  // model — "can't change models after choosing once". t3code's rule:
  // the user's unsaved draft pick MUST win until the next send persists it.
  const threadSel = activeThread?.modelSelection;
  const threadSelKey = activeThread
    ? [
        activeThread.threadId,
        threadSel?.provider ?? '',
        threadSel?.modelId ?? '',
        threadSel?.effort ?? '',
        String(threadSel?.thinking ?? ''),
        String(threadSel?.fastMode ?? ''),
        threadSel?.contextWindow ?? '',
      ].join(':')
    : null;
  const lastSyncedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!threadSelKey || lastSyncedKeyRef.current === threadSelKey) return;
    if (threadSel?.provider && threadSel.modelId) {
      const provider = providers.find((item: any) => item.provider === threadSel.provider);
      const model = provider?.models?.find((item: any) => item.id === threadSel.modelId);
      // Providers not loaded yet — leave unsynced so we retry when they land.
      if (!model) return;
      lastSyncedKeyRef.current = threadSelKey;
      setConfigSelection((prev) =>
        syncSelectionToModel(
          {
            ...prev,
            provider: threadSel.provider,
            modelId: threadSel.modelId,
            modelName: model.name,
            thinking: threadSel.thinking,
            effort: threadSel.effort,
            fastMode: threadSel.fastMode,
            contextWindow: threadSel.contextWindow,
          },
          model,
        ),
      );
    } else {
      lastSyncedKeyRef.current = threadSelKey;
    }
  }, [threadSelKey, threadSel, providers, syncSelectionToModel]);

  return {
    popoverSection,
    popoverVisible,
    setPopoverVisible,
    openPopover,
    configSelection,
    setConfigSelection,
    interactionMode,
    setInteractionMode,
    accessLevel,
    setAccessLevel,
    syncSelectionToModel,
    providerLocked,
    showProviderSelector,
    selectedProvider,
    selectedModelRecord,
    modelCapabilities,
    selectedModel,
  };
}
