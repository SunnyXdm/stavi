// WHAT: Tools plugin definition — on-device text transforms (format, encode, string ops).
// WHY:  Developers frequently need quick utilities (JSON format, base64, URL encode) offline.
// HOW:  Exported and registered explicitly in load.ts (matching all other plugins).
//       No server connection needed.
// SEE:  ToolsPanel.tsx, transforms.ts, apps/mobile/src/plugins/load.ts

import { Wrench } from 'lucide-react-native';
import type { WorkspacePluginDefinition } from '@stavi/shared';
import { ToolsPanel } from './ToolsPanel';

export const toolsPlugin: WorkspacePluginDefinition = {
  id: 'tools',
  name: 'Tools',
  description: 'Text transforms, encoding, and utilities',
  kind: 'extra',
  scope: 'workspace',
  icon: Wrench,
  component: ToolsPanel,
};
