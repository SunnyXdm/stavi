/**
 * @format
 */

// Phase 5.5 smoke check: verify react-native-quick-crypto native module is wired.
// This block is intentionally removed in the follow-up commit after first clean build.
import { createHash } from 'react-native-quick-crypto';
const _smokeHash = createHash('sha256').update('stavi').digest('hex');
console.log('[Phase5.5 smoke] SHA-256("stavi"):', _smokeHash);

import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
