/**
 * @format
 */

import { AppRegistry, LogBox } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';
import { installGlobalErrorHandlers } from './src/utils/global-error-handler';

// Known dev-only noise that otherwise pops LogBox toasts over bottom-sheet
// buttons: NativeTerminalView ships hand-written specs without codegen, and
// StaviClient logs transient WS drops that auto-retry during dev reloads.
LogBox.ignoreLogs([
  /Codegen didn't run for NativeTerminalView/,
  /\[StaviClient\] (WebSocket error|Connect failed)/,
  /\[autoConnect\]/,
]);

// Install global JS error + unhandled-rejection handlers before the app mounts,
// so early store hydration / plugin-load side effects are covered too.
installGlobalErrorHandlers();

AppRegistry.registerComponent(appName, () => App);
