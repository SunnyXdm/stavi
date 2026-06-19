export type { StaviServer, StartServerOptions, ServerConnectionConfig } from './server';
export {
  DEFAULT_PORT,
  createServerConnectionConfig,
  issueOrReadBearerToken,
  startStaviServer,
} from './server';
export { detectLanCandidates, detectLocalIp } from './utils';

// Provider types (for mobile app to import if needed)
export type {
  ProviderKind,
  ProviderInfo,
  ModelInfo,
  ModelSelection,
  StaviSettings,
} from './providers/types';
