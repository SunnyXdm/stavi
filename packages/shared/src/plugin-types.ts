// ============================================================
// Plugin Types — the contract for the entire plugin system
// ============================================================

import type { ComponentType } from 'react';

// ----------------------------------------------------------
// Plugin Definition — the static manifest (registered at boot)
// ----------------------------------------------------------

export type PluginKind = 'core' | 'extra';

export interface PluginDefinition<T extends PluginAPI = PluginAPI> {
  /** Unique identifier, e.g. "terminal", "editor", "ai" */
  id: string;

  /** Human-readable display name */
  name: string;

  /** Short description */
  description: string;

  /** "core" = bundled, uncloseable, single instance. "extra" = optional, closeable. */
  kind: PluginKind;

  /** Icon component (lucide-react-native or similar) */
  icon: ComponentType<{ size?: number; color?: string }>;

  /** The panel React component to render */
  component: ComponentType<PluginPanelProps>;

  /** Position in bottom nav bar. undefined = not in main nav (appears in Tabs sheet). */
  navOrder?: number;

  /** Override label in bottom nav (defaults to `name`) */
  navLabel?: string;

  /** Which permissions this plugin needs (for third-party sandboxing) */
  permissions?: PluginPermission[];

  /** Factory function returning the cross-plugin API object */
  api?: () => T;

  /** Lifecycle hooks */
  onActivate?: (instanceId: string) => void;
  onDeactivate?: (instanceId: string) => void;
}

// ----------------------------------------------------------
// Plugin Instance — the runtime representation (one per open tab)
// ----------------------------------------------------------

export type PluginStatus = 'registered' | 'activating' | 'active' | 'error' | 'disabled';

export interface PluginInstance {
  /** Unique tab instance ID */
  id: string;

  /** Which plugin definition this is an instance of */
  pluginId: string;

  /** Display title for the tab */
  title: string;

  /** Current status */
  status: PluginStatus;

  /** Error message if status is 'error' */
  error?: string;

  /** Initial state passed when the tab was opened (e.g. { file: '/src/app.tsx' }) */
  initialState?: Record<string, unknown>;
}

// ----------------------------------------------------------
// Plugin Panel Props — what the host passes to each plugin's UI
// ----------------------------------------------------------

export interface PluginPanelProps {
  /** This tab's unique instance ID */
  instanceId: string;

  /** Whether this panel is currently visible/focused */
  isActive: boolean;

  /** Height of the bottom bar (for padding) */
  bottomBarHeight: number;

  /** Initial state passed when the tab was opened */
  initialState?: Record<string, unknown>;
}

// ----------------------------------------------------------
// Plugin Permissions (for third-party sandboxing)
// ----------------------------------------------------------

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
// Session Registration — for sidebar/drawer session lists
// ----------------------------------------------------------

export interface SessionRegistration {
  /** Sessions this plugin is managing */
  sessions: SessionEntry[];

  /** Currently active session ID */
  activeSessionId?: string;

  /** Callback when user selects a session in the drawer */
  onSelectSession: (sessionId: string) => void;

  /** Callback when user wants to create a new session */
  onCreateSession?: () => void;

  /** Label for "new session" button */
  createLabel?: string;
}

export interface SessionEntry {
  id: string;
  title: string;
  subtitle?: string;
  isActive?: boolean;
}
