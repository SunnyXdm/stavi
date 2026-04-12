const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

// Pin these to the app-local copies (nohoist puts them here).
// resolveRequest runs BEFORE Metro's hierarchical walk, so this is an
// override — not a fallback like extraNodeModules.
const reactPath = path.resolve(projectRoot, 'node_modules/react');
const reactNativePath = path.resolve(projectRoot, 'node_modules/react-native');

const config = {
  watchFolders: [monorepoRoot],
  resolver: {
    // Search app-local node_modules first, then monorepo root as fallback.
    // Most packages (navigation, gesture-handler, etc.) are hoisted to the
    // monorepo root by Yarn 1.x — this lets Metro find them there.
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(monorepoRoot, 'node_modules'),
    ],

    // Intercept react and react-native resolution BEFORE the hierarchical
    // node_modules walk. This guarantees a single copy of each, preventing
    // "Invalid hook call" errors from duplicate React instances.
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === 'react' || moduleName.startsWith('react/')) {
        const subPath = moduleName === 'react' ? '' : moduleName.slice('react'.length);
        return {
          type: 'sourceFile',
          filePath: require.resolve(`react${subPath}`, { paths: [reactPath] }),
        };
      }
      if (moduleName === 'react-native' || moduleName.startsWith('react-native/')) {
        const subPath = moduleName === 'react-native'
          ? ''
          : moduleName.slice('react-native'.length);
        return {
          type: 'sourceFile',
          filePath: require.resolve(`react-native${subPath}`, {
            paths: [reactNativePath],
          }),
        };
      }
      // Everything else: default resolution
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
