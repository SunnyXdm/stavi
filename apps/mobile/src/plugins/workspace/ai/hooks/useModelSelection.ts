// ============================================================
// useModelSelection — manages AI model/provider/mode/access state
// ============================================================
// Extracted from ai/index.tsx (Phase 8g split).
// Owns: configSelection, interactionMode, accessLevel, popover state,
// syncSelectionToModel, and effects that sync from active thread.

import { useState, useCallback, useMemo, useEffect } from 'react';
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
