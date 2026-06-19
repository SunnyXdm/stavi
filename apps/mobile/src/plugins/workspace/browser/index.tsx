// ============================================================
// Core Plugin: Browser
// ============================================================
// WebView-based in-app browser with multiple tabs. Useful for
// previewing local dev servers, documentation, and web apps
// served by the connected Stavi server.
//
// Features:
//   - Multiple tabs (tab strip with new/close, per-tab history)
//   - URL bar with search/navigation
//   - Back / Forward / Refresh controls
//   - Progress indicator
//   - Local dev server detection (server IP prefix) + /proxy rewrite

import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  Pressable,
  Text,
} from 'react-native';
import { Globe, ArrowLeft, ArrowRight, RotateCw, X, AlertTriangle } from 'lucide-react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import type {
  WorkspacePluginDefinition,
  WorkspacePluginPanelProps,
} from '@stavi/shared';
import { useTheme, typography, spacing, radii } from '../../../theme';
import { ErrorView } from '../../../components/StateViews';
import { useConnectionStore } from '../../../stores/connection';
import { useSessionRegistry } from '../../../stores/session-registry';

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

const DEFAULT_URL = 'https://google.com';

// Matches localhost / 127.0.0.1 URLs with or without scheme.
const LOCALHOST_RE = /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i;

function isLocalhostUrl(input: string): boolean {
  return LOCALHOST_RE.test(input.trim());
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w.-]+(:\d+)?(\/.*)?$/.test(trimmed) && !trimmed.includes(' ')) {
    return `http://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

/** Short label for a tab: page title, else hostname, else "New Tab". */
function tabTitle(tab: BrowserTab): string {
  if (tab.title) return tab.title;
  try {
    const host = new URL(tab.url).hostname;
    if (host) return host.replace(/^www\./, '');
  } catch { /* not a parseable URL yet */ }
  return 'New Tab';
}

let tabSeq = 0;
function nextTabId(): string {
  tabSeq += 1;
  return `tab-${tabSeq}`;
}

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

interface BrowserTab {
  id: string;
  /** The URL actually loaded in the WebView (may be a /proxy-wrapped URL). */
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  progress: number;
  error: string | null;
}

function makeTab(url: string = DEFAULT_URL): BrowserTab {
  return { id: nextTabId(), url, title: '', canGoBack: false, canGoForward: false, loading: false, progress: 0, error: null };
}

// ----------------------------------------------------------
// Panel Component
// ----------------------------------------------------------

function BrowserPanel({ session }: WorkspacePluginPanelProps) {
  const { colors } = useTheme();

  const savedConnection = useConnectionStore((s) =>
    s.savedConnections.find((c) => c.id === session.serverId),
  );
  const isRelay = !!savedConnection?.relayUrl;
  const serverBaseUrl = useMemo(() => {
    if (!savedConnection) return null;
    const protocol = savedConnection.tls ? 'https' : 'http';
    return `${protocol}://${savedConnection.host}:${savedConnection.port}`;
  }, [savedConnection]);

  const rewriteForProxy = useCallback(
    (url: string): string => {
      if (!serverBaseUrl || !savedConnection) return url;
      if (!isLocalhostUrl(url)) return url;
      const withScheme = /^https?:\/\//i.test(url) ? url : `http://${url}`;
      const encoded = encodeURIComponent(withScheme);
      const token = encodeURIComponent(savedConnection.bearerToken);
      return `${serverBaseUrl}/proxy?url=${encoded}&token=${token}`;
    },
    [serverBaseUrl, savedConnection],
  );

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg.base },
    toolbar: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg.raised, paddingHorizontal: spacing[2], paddingVertical: spacing[2], gap: spacing[1], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    navButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radii.sm },
    navButtonDisabled: { opacity: 0.4 },
    urlBar: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg.overlay, borderRadius: radii.md, paddingHorizontal: spacing[2], height: 32 },
    urlInput: { flex: 1, fontSize: typography.fontSize.sm, color: colors.fg.primary, fontFamily: typography.fontFamily.sans, height: 32, paddingVertical: 0 },
    progressTrack: { height: 2, backgroundColor: colors.bg.overlay },
    progressBar: { height: 2, backgroundColor: colors.accent.primary },
    webArea: { flex: 1, position: 'relative' },
    webViewWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    webView: { flex: 1, backgroundColor: colors.bg.base },
    relayBanner: { backgroundColor: colors.bg.overlay, paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    relayBannerText: { color: colors.fg.secondary, fontSize: typography.fontSize.xs, fontFamily: typography.fontFamily.sans },
  }), [colors]);

  const webViewRefs = useRef<Map<string, WebView | null>>(new Map());
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [makeTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id);
  const [urlInput, setUrlInput] = useState('');
  const [isEditingUrl, setIsEditingUrl] = useState(false);
  const urlInputRef = useRef<TextInput>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  const updateTab = useCallback((id: string, partial: Partial<BrowserTab>) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...partial } : t)));
  }, []);

  const handleNewTab = useCallback(() => {
    const tab = makeTab();
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    setIsEditingUrl(false);
  }, []);

  const handleCloseTab = useCallback((id: string) => {
    setTabs((prev) => {
      if (prev.length === 1) {
        // Never drop to zero tabs — reset the last one to a fresh tab.
        const fresh = makeTab();
        webViewRefs.current.delete(id);
        setActiveTabId(fresh.id);
        return [fresh];
      }
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      webViewRefs.current.delete(id);
      // If we closed the active tab, activate the neighbor.
      setActiveTabId((cur) => (cur === id ? (next[idx] ?? next[idx - 1] ?? next[0]).id : cur));
      return next;
    });
  }, []);

  const handleNavigate = useCallback((input: string) => {
    const trimmed = input.trim();
    if (isRelay && isLocalhostUrl(trimmed)) {
      updateTab(activeTabId, { error: 'Localhost proxy is not yet supported over relay connections.' });
      setIsEditingUrl(false);
      return;
    }
    const normalized = normalizeUrl(trimmed);
    const final = isLocalhostUrl(trimmed) ? rewriteForProxy(normalized) : normalized;
    updateTab(activeTabId, { url: final, error: null });
    setIsEditingUrl(false);
  }, [isRelay, rewriteForProxy, activeTabId, updateTab]);

  const handleUrlSubmit = useCallback(() => handleNavigate(urlInput), [urlInput, handleNavigate]);

  // Strip a /proxy wrapper back to the original target for display.
  const unwrap = useCallback((url: string): string => {
    if (serverBaseUrl && url.startsWith(`${serverBaseUrl}/proxy?`)) {
      try {
        const orig = new URL(url).searchParams.get('url');
        if (orig) return orig;
      } catch { /* noop */ }
    }
    return url;
  }, [serverBaseUrl]);

  const handleUrlFocus = useCallback(() => {
    setIsEditingUrl(true);
    setUrlInput(displayUrl(unwrap(activeTab.url)));
  }, [activeTab.url, unwrap]);

  const handleCancelEdit = useCallback(() => {
    setIsEditingUrl(false);
    setUrlInput('');
    urlInputRef.current?.blur();
  }, []);

  const makeNavHandler = useCallback((id: string) => (navState: WebViewNavigation) => {
    setTabs((prev) => prev.map((t) =>
      t.id === id
        ? { ...t, canGoBack: navState.canGoBack, canGoForward: navState.canGoForward, title: navState.title || t.title, url: navState.url }
        : t,
    ));
  }, []);

  const handleBack = useCallback(() => webViewRefs.current.get(activeTabId)?.goBack(), [activeTabId]);
  const handleForward = useCallback(() => webViewRefs.current.get(activeTabId)?.goForward(), [activeTabId]);
  const handleRefresh = useCallback(() => webViewRefs.current.get(activeTabId)?.reload(), [activeTabId]);

  const displayedUrl = isEditingUrl ? urlInput : displayUrl(unwrap(activeTab.url));

  // Tabs live in the workspace sidebar (SessionDrawer), like terminal
  // sessions and AI chats — no in-panel tab strip.
  const registerSessions = useSessionRegistry((s) => s.register);
  const unregisterSessions = useSessionRegistry((s) => s.unregister);
  useEffect(() => () => unregisterSessions('browser'), [unregisterSessions]);
  useEffect(() => {
    registerSessions('browser', {
      sessions: tabs.map((t) => ({
        id: t.id,
        title: tabTitle(t),
        subtitle: displayUrl(unwrap(t.url)),
        isActive: t.id === activeTabId,
      })),
      activeSessionId: activeTabId,
      onSelectSession: (id: string) => {
        setActiveTabId(id);
        setIsEditingUrl(false);
      },
      onCreateSession: handleNewTab,
      onCloseSession: handleCloseTab,
      createLabel: 'New Tab',
    });
  }, [tabs, activeTabId, registerSessions, handleNewTab, handleCloseTab, unwrap]);

  return (
    <View style={styles.container}>
      {isRelay && (
        <View style={styles.relayBanner}>
          <Text style={styles.relayBannerText}>
            Localhost proxy not yet supported over relay. Use a LAN connection to preview dev servers.
          </Text>
        </View>
      )}

      {/* URL Bar */}
      <View style={styles.toolbar}>
        <Pressable
          style={[styles.navButton, !activeTab.canGoBack && styles.navButtonDisabled]}
          onPress={handleBack}
          disabled={!activeTab.canGoBack}
          hitSlop={8}
        >
          <ArrowLeft size={18} color={activeTab.canGoBack ? colors.fg.secondary : colors.fg.muted} />
        </Pressable>

        <Pressable
          style={[styles.navButton, !activeTab.canGoForward && styles.navButtonDisabled]}
          onPress={handleForward}
          disabled={!activeTab.canGoForward}
          hitSlop={8}
        >
          <ArrowRight size={18} color={activeTab.canGoForward ? colors.fg.secondary : colors.fg.muted} />
        </Pressable>

        <View style={styles.urlBar}>
          {!isEditingUrl && (
            <Globe size={12} color={colors.fg.muted} style={{ marginRight: 4 }} />
          )}
          <TextInput
            ref={urlInputRef}
            style={styles.urlInput}
            value={displayedUrl}
            onChangeText={setUrlInput}
            onFocus={handleUrlFocus}
            onBlur={() => setIsEditingUrl(false)}
            onSubmitEditing={handleUrlSubmit}
            returnKeyType="go"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            selectTextOnFocus
            placeholder="Search or enter URL"
            placeholderTextColor={colors.fg.muted}
          />
          {isEditingUrl && (
            <Pressable onPress={handleCancelEdit} hitSlop={8}>
              <X size={14} color={colors.fg.muted} />
            </Pressable>
          )}
        </View>

        <Pressable style={styles.navButton} onPress={handleRefresh} hitSlop={8}>
          {activeTab.loading ? (
            <X size={18} color={colors.fg.secondary} />
          ) : (
            <RotateCw size={18} color={colors.fg.secondary} />
          )}
        </Pressable>
      </View>

      {/* Progress bar */}
      {activeTab.loading && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressBar, { width: `${activeTab.progress * 100}%` }]} />
        </View>
      )}

      {/* WebViews — all tabs stay mounted (display-swapped) so each keeps its
          own history and scroll position; only the active one is visible. */}
      <View style={styles.webArea}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <View
              key={tab.id}
              style={[styles.webViewWrap, { opacity: isActive ? 1 : 0 }]}
              pointerEvents={isActive ? 'auto' : 'none'}
            >
              {tab.error ? (
                <ErrorView
                  icon={AlertTriangle}
                  title="Page failed to load"
                  message={tab.error}
                  onRetry={() => {
                    updateTab(tab.id, { error: null });
                    webViewRefs.current.get(tab.id)?.reload();
                  }}
                />
              ) : (
                <WebView
                  ref={(r) => { webViewRefs.current.set(tab.id, r); }}
                  style={styles.webView}
                  source={{ uri: tab.url }}
                  onNavigationStateChange={makeNavHandler(tab.id)}
                  onLoadStart={() => updateTab(tab.id, { loading: true })}
                  onLoadEnd={() => updateTab(tab.id, { loading: false })}
                  onLoadProgress={({ nativeEvent }) => updateTab(tab.id, { progress: nativeEvent.progress })}
                  onError={(syntheticEvent) => {
                    const { nativeEvent } = syntheticEvent;
                    console.warn('[Browser] WebView error:', nativeEvent);
                    updateTab(tab.id, { loading: false, error: nativeEvent.description || 'An unknown error occurred' });
                  }}
                  mixedContentMode="compatibility"
                  allowsInlineMediaPlayback
                  mediaPlaybackRequiresUserAction={false}
                  applicationNameForUserAgent="StaviBrowser/1.0"
                />
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ----------------------------------------------------------
// Plugin Definition
// ----------------------------------------------------------

export const browserPlugin: WorkspacePluginDefinition = {
  id: 'browser',
  name: 'Browser',
  description: 'In-app WebView browser with tabs for previewing local dev servers',
  scope: 'workspace',
  kind: 'core',
  icon: Globe,
  component: BrowserPanel,
  navOrder: 4,
  navLabel: 'Browser',
  allowMultipleInstances: false,
  // Tabs are listed in the SessionDrawer (select / close / "New Tab").
  supportsSessions: true,
};

// Styles computed dynamically via useMemo — see component body.
