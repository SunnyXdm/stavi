// ============================================================
// GPI — Global Plugin Interface (Proxy-based cross-plugin calls)
// ============================================================
// Usage: gPI.editor.openFile('/src/app.tsx')
// The Proxy looks up the plugin's api() factory and calls the method.
// api() must return real implementations — stub returns are not accepted.

import { usePluginRegistry } from '../stores/plugin-registry';
import type { GPIRegistry } from '@stavi/shared';

function createGPI(): GPIRegistry {
  return new Proxy({} as GPIRegistry, {
    get(_target, pluginId: string) {
      const state = usePluginRegistry.getState();
      const definition = state.definitions[pluginId];

      if (!definition) {
        console.warn(`[GPI] Plugin "${pluginId}" not registered`);
        // Return a proxy that throws on any method call
        return new Proxy(
          {},
          {
            get(_t, method: string) {
              return () => {
                throw new Error(`[GPI] Cannot call ${pluginId}.${method}(): plugin not registered`);
              };
            },
          },
        );
      }

      if (!definition.api) {
        console.warn(`[GPI] Plugin "${pluginId}" has no API`);
        return new Proxy(
          {},
          {
            get(_t, method: string) {
              return () => {
                throw new Error(`[GPI] Cannot call ${pluginId}.${method}(): plugin has no API`);
              };
            },
          },
        );
      }

      // Call the api factory to get the current API object
      return definition.api();
    },
  });
}

/** Global Plugin Interface — cross-plugin typed method calls */
export const gPI = createGPI();
