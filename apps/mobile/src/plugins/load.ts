// ============================================================
// Plugin Loader — registers all plugins at boot
// ============================================================
// Import this file once (in App.tsx) to register all plugins.
// Side-effect import: `import './plugins/load'`
//
// Directory layout (post Phase 0 rename):
//   workspace/  — AI, Editor, Terminal, Git, Browser, workspace-search
//   server/     — Processes, Ports, Monitor, system-search
//   shared/     — Explorer

import { usePluginRegistry } from '../stores/plugin-registry';

// Workspace plugins
import { terminalPlugin } from './workspace/terminal';
import { aiPlugin } from './workspace/ai';
import { editorPlugin } from './workspace/editor';
import { gitPlugin } from './workspace/git';
import { browserPlugin } from './workspace/browser';
import { workspaceSearchPlugin } from './workspace/workspace-search';

// Shared plugins
import { explorerPlugin } from './shared/explorer';

// Server plugins
import { processesPlugin } from './server/processes';
import { portsPlugin } from './server/ports';
import { monitorPlugin } from './server/monitor';
import { systemSearchPlugin } from './server/system-search';

const { register } = usePluginRegistry.getState();

// Register workspace plugins (order matters — navOrder controls bottom bar)
register(terminalPlugin, terminalPlugin.component);
register(aiPlugin, aiPlugin.component);
register(editorPlugin, editorPlugin.component);
register(gitPlugin, gitPlugin.component);
register(browserPlugin, browserPlugin.component);

// Register shared plugins
register(explorerPlugin, explorerPlugin.component);
register(workspaceSearchPlugin, workspaceSearchPlugin.component);

// Register server plugins
register(processesPlugin, processesPlugin.component);
register(portsPlugin, portsPlugin.component);
register(monitorPlugin, monitorPlugin.component);
register(systemSearchPlugin, systemSearchPlugin.component);
