// WHAT: openFileInEditor — open a file in the Editor plugin from anywhere.
// WHY:  The Explorer's eventBus emit alone is unreliable: the editor's
//       listener only exists while EditorPanel is mounted, and PluginRenderer
//       lazy-mounts tabs — if the editor tab was never opened, the event is
//       silently dropped and "nothing happens" on file tap.
// HOW:  Load the file straight into the editor store (works unmounted), then
//       activate the existing editor tab — or open one. Find-existing-first
//       matters: the editor allows multiple instances, so a bare openTab()
//       would create a duplicate every tap.
// SEE:  apps/mobile/src/plugins/shared/explorer/ (callers),
//       apps/mobile/src/plugins/workspace/editor/store.ts

import { useEditorStore } from './store';
import { usePluginRegistry } from '../../../stores/plugin-registry';

export function openFileInEditor(sessionId: string, serverId: string, path: string): void {
  void useEditorStore.getState().openFile(sessionId, path, serverId);
  const { getOpenTabs, setActiveTab, openTab } = usePluginRegistry.getState();
  const existing = getOpenTabs(sessionId).find((t) => t.pluginId === 'editor');
  if (existing) {
    setActiveTab(existing.id, sessionId);
  } else {
    openTab('editor', undefined, sessionId);
  }
}
