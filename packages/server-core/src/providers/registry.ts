// ============================================================
// Provider Registry — Manages available AI providers
// ============================================================
// Detects installed providers, manages settings, and provides
// a central API for creating and accessing provider adapters.

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  ProviderAdapter,
  ProviderInfo,
  ProviderKind,
  StaviSettings,
} from './types';
import { settingsPath } from './types';
import { ClaudeAdapter } from './claude';
import { CodexAdapter } from './codex';

// ----------------------------------------------------------
// Registry
// ----------------------------------------------------------

export class ProviderRegistry {
  private adapters = new Map<ProviderKind, ProviderAdapter>();
  private settings: StaviSettings = {};
  private baseDir: string;
  private initialized = false;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  // ----------------------------------------------------------
  // Initialization
  // ----------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load settings from disk
    this.loadSettings();

    // Create adapters
    const claude = new ClaudeAdapter(() => this.getApiKey());
    const codex = new CodexAdapter(() => this.settings.codexBinaryPath);

    // Initialize both — each adapter probes its own availability
    await Promise.allSettled([
      claude.initialize(),
      codex.initialize(),
    ]);

    this.adapters.set('claude', claude);
    this.adapters.set('codex', codex);
    this.initialized = true;

    console.log(`[Registry] Providers: Claude=${claude.isReady() ? 'ready' : 'not found'}, Codex=${codex.isReady() ? 'ready' : 'not found'}`);
  }

  // ----------------------------------------------------------
  // Provider access
  // ----------------------------------------------------------

  getAdapter(provider: ProviderKind): ProviderAdapter | undefined {
    return this.adapters.get(provider);
  }

  /** Get the best available adapter, preferring user's default */
  getDefaultAdapter(): ProviderAdapter | undefined {
    // Try user's preferred provider first
    if (this.settings.defaultProvider) {
      const preferred = this.adapters.get(this.settings.defaultProvider);
      if (preferred?.isReady()) return preferred;
    }

    // Fall back to Claude, then Codex
    const claude = this.adapters.get('claude');
    if (claude?.isReady()) return claude;

    const codex = this.adapters.get('codex');
    if (codex?.isReady()) return codex;

    return undefined;
  }

  /** Get provider info for all registered providers */
  getProviderInfos(): ProviderInfo[] {
    const infos: ProviderInfo[] = [];

    for (const [kind, adapter] of this.adapters) {
      // For Claude: always "installed" (SDK bundled). For Codex: installed only if binary found.
      const installed = kind === 'claude' ? true : adapter.isReady();
      infos.push({
        provider: kind,
        name: kind === 'claude' ? 'Claude (Anthropic)' : 'Codex (OpenAI)',
        installed,
        authenticated: adapter.isReady(),
        models: adapter.getModels(),
      });
    }

    return infos;
  }

  // ----------------------------------------------------------
  // Settings management
  // ----------------------------------------------------------

  private getApiKey(): string | undefined {
    // Environment variable takes precedence
    if (process.env.ANTHROPIC_API_KEY) {
      return process.env.ANTHROPIC_API_KEY;
    }
    return this.settings.anthropicApiKey;
  }

  private loadSettings(): void {
    const path = settingsPath(this.baseDir);
    try {
      if (existsSync(path)) {
        const raw = readFileSync(path, 'utf-8');
        this.settings = JSON.parse(raw) as StaviSettings;
      }
    } catch {
      this.settings = {};
    }
  }

  updateSettings(updates: Partial<StaviSettings>): void {
    this.settings = { ...this.settings, ...updates };
    this.saveSettings();

    // Re-initialize adapters if API key changed
    if (updates.anthropicApiKey) {
      const claude = this.adapters.get('claude');
      if (claude) {
        void claude.initialize();
      }
    }
  }

  getSettings(): StaviSettings {
    return { ...this.settings };
  }

  private saveSettings(): void {
    const path = settingsPath(this.baseDir);
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true });

    // Atomic write
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tempPath, JSON.stringify(this.settings, null, 2) + '\n', 'utf-8');
    renameSync(tempPath, path);
  }

  // ----------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------

  async stopAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.stopAll();
    }
  }

  /** Refresh provider availability (re-probe) */
  async refresh(): Promise<void> {
    this.loadSettings();
    for (const adapter of this.adapters.values()) {
      await adapter.initialize();
    }
  }
}
