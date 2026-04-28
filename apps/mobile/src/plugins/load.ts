// ============================================================
// Plugin Loader — registers all plugins at boot
// ============================================================
// Import this file once (in App.tsx) to register all plugins.
// Side-effect import: `import './plugins/load'`
//
// Directory layout (post Phase 6 move):
//   workspace/  — AI, Editor, Terminal, Git, Browser
//   extra/      — Processes, Ports, Monitor, Search, Tools
//   shared/     — Explorer

import { usePluginRegistry } from '../stores/plugin-registry';

// Workspace plugins
import { terminalPlugin } from './workspace/terminal';
import { aiPlugin } from './workspace/ai';
import { editorPlugin } from './workspace/editor';
import { gitPlugin } from './workspace/git';
import { browserPlugin } from './workspace/browser';

// Shared plugins
import { explorerPlugin } from './shared/explorer';

// Extra plugins (processes/ports/monitor moved from server/ in Phase 6)
import { processesPlugin } from './extra/processes';
import { portsPlugin } from './extra/ports';
import { monitorPlugin } from './extra/monitor';
import { systemSearchPlugin } from './extra/system-search';

import { toolsPlugin } from './extra/tools';

const { register } = usePluginRegistry.getState();

// Register workspace plugins (order matters — navOrder controls bottom bar)
register(terminalPlugin, terminalPlugin.component);
register(aiPlugin, aiPlugin.component);
register(editorPlugin, editorPlugin.component);
register(gitPlugin, gitPlugin.component);
register(browserPlugin, browserPlugin.component);

// Register shared plugins
register(explorerPlugin, explorerPlugin.component);

// Register extra plugins (processes/ports/monitor/search)
register(processesPlugin, processesPlugin.component);
register(portsPlugin, portsPlugin.component);
register(monitorPlugin, monitorPlugin.component);
register(systemSearchPlugin, systemSearchPlugin.component);
register(toolsPlugin, toolsPlugin.component);
