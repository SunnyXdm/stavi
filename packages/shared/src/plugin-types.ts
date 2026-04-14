// WHAT: Plugin type system — discriminated union for workspace vs server plugins.
// WHY:  Phase 2 splits plugins by scope so workspace plugins receive a Session and
//       server plugins receive a serverId; mixing props caused client singleton leaks.
// HOW:  WorkspacePluginDefinition and ServerPluginDefinition share a base interface.
//       PluginPanelProps is a discriminated union on the `scope` discriminant.
// SEE:  apps/mobile/src/stores/plugin-registry.ts, apps/mobile/src/components/PluginRenderer.tsx

import type { ComponentType } from 'react';
import type { Session } from './domain-types';

// ----------------------------------------------------------
// Plugin scope
// ----------------------------------------------------------

export type PluginScope = 'workspace' | 'server';

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

export interface ServerPluginPanelProps {
  scope: 'server';
  instanceId: string;
  isActive: boolean;
  serverId: string;
  bottomBarHeight: number;
  initialState?: Record<string, unknown>;
}

export type PluginPanelProps = WorkspacePluginPanelProps | ServerPluginPanelProps;

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
}

// ----------------------------------------------------------
// Discriminated plugin definitions
// ----------------------------------------------------------

export interface WorkspacePluginDefinition extends PluginDefinitionBase {
  scope: 'workspace';
  component: ComponentType<WorkspacePluginPanelProps>;
}

export interface ServerPluginDefinition extends PluginDefinitionBase {
  scope: 'server';
  component: ComponentType<ServerPluginPanelProps>;
}

export type PluginDefinition = WorkspacePluginDefinition | ServerPluginDefinition;

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
