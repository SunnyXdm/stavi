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

/** Color palette used to render a syntax-highlighted snippet preview next to a
 *  select option (e.g. editor theme swatches). All fields are CSS color
 *  strings. Only `bg`/`fg` are required; token roles are optional. */
export interface SettingOptionPreview {
  bg: string;
  fg: string;
  comment?: string;
  keyword?: string;
  string?: string;
  func?: string;
  number?: string;
}

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
      options: Array<{
        value: string;
        label: string;
        description?: string;
        /** When present, the picker renders a code-snippet preview using this
         *  palette (used by the editor theme picker for a live preview). */
        preview?: SettingOptionPreview;
      }>;
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
  /** Open the workspace SessionDrawer. Needed by hideHeader plugins (the
   *  hamburger normally lives in PluginHeader). */
  onOpenDrawer?: () => void;
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
  /**
   * When true, this plugin has a multi-session list worth showing in the
   * SessionDrawer (search + list + "New" — e.g. AI chats, terminal sessions,
   * browser tabs). When false/omitted, the drawer shows just the plugin name
   * (no empty "No sessions for this tool" placeholder).
   */
  supportsSessions?: boolean;
  /**
   * Custom drawer body for this plugin (replaces the session list). The editor
   * uses this to show its file tree in the sidebar, explorer-style. Static on
   * the definition (like `settings`) so component identity is stable —
   * registrations re-created per render would churn it.
   */
  drawerContent?: ComponentType<{ session: Session; close: () => void }>;
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
  /** When present, drawer rows get a close (X) affordance — e.g. browser tabs. */
  onCloseSession?: (sessionId: string) => void;
}

export interface SessionEntry {
  id: string;
  title: string;
  subtitle?: string;
  isActive?: boolean;
}
