// ============================================================
// Plugin Loader — registers all plugins at boot
// ============================================================
// Import this file once (in App.tsx) to register all plugins.
// Side-effect import: `import './plugins/load'`

import { usePluginRegistry } from '../stores/plugin-registry';

// Core plugins
import { terminalPlugin } from './core/terminal';
import { aiPlugin } from './core/ai';
import { editorPlugin } from './core/editor';
import { gitPlugin } from './core/git';

// Extra plugins
import { explorerPlugin } from './extra/explorer';
import { searchPlugin } from './extra/search';
import { processesPlugin } from './extra/processes';
import { portsPlugin } from './extra/ports';
import { monitorPlugin } from './extra/monitor';

const { register } = usePluginRegistry.getState();

// Register core plugins (order matters — navOrder controls bottom bar)
register(terminalPlugin, terminalPlugin.component);
register(aiPlugin, aiPlugin.component);
register(editorPlugin, editorPlugin.component);
register(gitPlugin, gitPlugin.component);

// Register extra plugins
register(explorerPlugin, explorerPlugin.component);
register(searchPlugin, searchPlugin.component);
register(processesPlugin, processesPlugin.component);
register(portsPlugin, portsPlugin.component);
register(monitorPlugin, monitorPlugin.component);
