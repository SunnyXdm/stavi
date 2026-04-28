// WHAT: Plugin type system — workspace plugin definitions and panel props.
// WHY:  Phase 2 introduced a server/workspace split; Phase 6 eliminates server scope
//       since all plugins now use workspace scope with session.serverId.
// HOW:  WorkspacePluginDefinition is the only definition type. PluginPanelProps simplified.
// SEE:  apps/mobile/src/stores/plugin-registry.ts, apps/mobile/src/components/PluginRenderer.tsx

import type { ComponentType } from 'react';
import type { Session } from './domain-types';

// ----------------------------------------------------------
// Plugin Settings Schema — declarative field declarations
// ----------------------------------------------------------

export type PluginSettingFieldType = 'boolean' | 'string' | 'number' | 'select';

export type PluginSettingField =
  | { key: string; type: 'boolean'; label: string; description?: string; default: boolean }
  | { key: string; type: 'string'; label: string; description?: string; default: string; placeholder?: string }
  | { key: string; type: 'number'; label: string; description?: string; default: number; min?: number; max?: number; step?: number }
  | {
      key: string;
      type: 'select';
      label: string;
      description?: string;
      default: string;
      options: Array<{ value: string; label: string; description?: string }>;
    };

export interface PluginSettingsSection {
  title: string;
  description?: string;
  fields: PluginSettingField[];
}

export interface PluginSettingsSchema {
  sections: PluginSettingsSection[];
}

// ----------------------------------------------------------
// Plugin scope
// ----------------------------------------------------------

export type PluginScope = 'workspace';

// ----------------------------------------------------------
// Plugin panel props (discriminated on scope)
// ----------------------------------------------------------

export interface WorkspacePluginPanelProps {
  scope: 'workspace';
  instanceId: string;
  isActive: boolean;
  session: Session;
  bottomBarHeight: number;
  initialState?: Record<string, unknown>;
}

export type PluginPanelProps = WorkspacePluginPanelProps;

// ----------------------------------------------------------
// Plugin kind / permissions
// ----------------------------------------------------------

export type PluginKind = 'core' | 'extra';

export type PluginPermission =
  | 'terminal:read'
  | 'terminal:write'
  | 'fs:read'
  | 'fs:write'
  | 'network'
  | 'ai:query'
  | 'git:read'
  | 'git:write'
  | 'clipboard'
  | 'notifications'
  | 'system:read';

// ----------------------------------------------------------
// Plugin API — base interface for GPI cross-plugin calls
// ----------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface PluginAPI {}

// ----------------------------------------------------------
// Plugin Definition base (shared fields)
// ----------------------------------------------------------

interface PluginDefinitionBase {
  id: string;
  name: string;
  description: string;
  kind: PluginKind;
  icon: ComponentType<{ size?: number; color?: string }>;
  navOrder?: number;
  navLabel?: string;
  allowMultipleInstances?: boolean;
  permissions?: PluginPermission[];
  api?: () => PluginAPI;
  onActivate?: (instanceId: string) => void;
  onDeactivate?: (instanceId: string) => void;
  /** Declarative settings schema — auto-generates UI in SettingsScreen */
  settings?: PluginSettingsSchema;
  /**
   * When true, WorkspaceScreen omits the PluginHeader bar for this plugin.
   * Use for full-bleed plugins that manage their own top chrome (e.g. terminal).
   */
  hideHeader?: boolean;
}

// ----------------------------------------------------------
// Discriminated plugin definitions
// ----------------------------------------------------------

export interface WorkspacePluginDefinition extends PluginDefinitionBase {
  scope: 'workspace';
  component: ComponentType<WorkspacePluginPanelProps>;
}

export type PluginDefinition = WorkspacePluginDefinition;

// ----------------------------------------------------------
// Plugin Instance — runtime representation (one per open tab)
// ----------------------------------------------------------

export type PluginStatus = 'registered' | 'activating' | 'active' | 'error' | 'disabled';

export interface PluginInstance {
  id: string;
  pluginId: string;
  title: string;
  status: PluginStatus;
  error?: string;
  initialState?: Record<string, unknown>;
}

// ----------------------------------------------------------
// Session Registration — for sidebar/drawer session lists
// ----------------------------------------------------------

export interface SessionRegistration {
  sessions: SessionEntry[];
  activeSessionId?: string;
  onSelectSession: (sessionId: string) => void;
  onCreateSession?: () => void;
  createLabel?: string;
}

export interface SessionEntry {
  id: string;
  title: string;
  subtitle?: string;
  isActive?: boolean;
}
