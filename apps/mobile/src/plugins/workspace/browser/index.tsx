// ============================================================
// Core Plugin: Browser
// ============================================================
// WebView-based in-app browser. Useful for previewing local
// dev servers, documentation, and web apps served by the
// connected Stavi server.
//
// Features:
//   - URL bar with search/navigation
//   - Back / Forward / Refresh controls
//   - Progress indicator
//   - Local dev server detection (server IP prefix)

import React, { useRef, useState, useCallback, useMemo } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  Pressable,
  Text,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Globe, ArrowLeft, ArrowRight, RotateCw, X, AlertTriangle } from 'lucide-react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import type {
  WorkspacePluginDefinition,
  WorkspacePluginPanelProps,
  PluginAPI,
} from '@stavi/shared';
import { useTheme, typography, spacing, radii } from '../../../theme';
import { ErrorView } from '../../../components/StateViews';
import { useConnectionStore } from '../../../stores/connection';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

interface BrowserPluginAPI extends PluginAPI {
  navigate: (url: string) => void;
}

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

const DEFAULT_URL = 'https://google.com';

// Matches localhost / 127.0.0.1 URLs with or without scheme.
// Used to decide whether to rewrite through the server's /proxy endpoint.
const LOCALHOST_RE = /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i;

function isLocalhostUrl(input: string): boolean {
  return LOCALHOST_RE.test(input.trim());
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_URL;
  // Already has a protocol
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Looks like a hostname or IP (contains a dot or colon for port)
  if (/^[\w.-]+(:\d+)?(\/.*)?$/.test(trimmed) && !trimmed.includes(' ')) {
    return `http://${trimmed}`;
  }
  // Treat as a search query
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

// ----------------------------------------------------------
// Panel Component
// ----------------------------------------------------------

function BrowserPanel({ instanceId, isActive, bottomBarHeight, session }: WorkspacePluginPanelProps) {
  const { colors } = useTheme();

  // Resolve the connection for this workspace's server. Used to build the
  // /proxy URL for localhost rewrites and to detect relay-mode connections
  // (where direct HTTP to the server isn't reachable).
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
    webView: { flex: 1, backgroundColor: colors.bg.base },
    relayBanner: { backgroundColor: colors.bg.overlay, paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    relayBannerText: { color: colors.fg.secondary, fontSize: typography.fontSize.xs, fontFamily: typography.fontFamily.sans },
  }), [colors]);

  const webViewRef = useRef<WebView>(null);
  const [currentUrl, setCurrentUrl] = useState(DEFAULT_URL);
  const [urlInput, setUrlInput] = useState('');
  const [isEditingUrl, setIsEditingUrl] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [webViewError, setWebViewError] = useState<string | null>(null);
  const urlInputRef = useRef<TextInput>(null);

  const handleNavigate = useCallback((input: string) => {
    const trimmed = input.trim();
    // Block localhost navigation in relay mode — the proxy isn't reachable
    // over the WS tunnel in v1.
    if (isRelay && isLocalhostUrl(trimmed)) {
      setWebViewError('Localhost proxy is not yet supported over relay connections.');
      setIsEditingUrl(false);
      return;
    }
    const normalized = normalizeUrl(trimmed);
    // Rewrite localhost URLs through the server's /proxy endpoint so they
    // resolve against the server machine's loopback rather than the phone's.
    const final = isLocalhostUrl(trimmed) ? rewriteForProxy(normalized) : normalized;
    setCurrentUrl(final);
    setIsEditingUrl(false);
    setWebViewError(null);
  }, [isRelay, rewriteForProxy]);

  const handleUrlSubmit = useCallback(() => {
    handleNavigate(urlInput);
  }, [urlInput, handleNavigate]);

  const handleUrlFocus = useCallback(() => {
    setIsEditingUrl(true);
    // Prefer the unwrapped target if we're on a proxied URL.
    let toShow = currentUrl;
    if (serverBaseUrl && currentUrl.startsWith(`${serverBaseUrl}/proxy?`)) {
      try {
        const orig = new URL(currentUrl).searchParams.get('url');
        if (orig) toShow = orig;
      } catch { /* noop */ }
    }
    setUrlInput(displayUrl(toShow));
  }, [currentUrl, serverBaseUrl]);

  const handleUrlBlur = useCallback(() => {
    setIsEditingUrl(false);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setIsEditingUrl(false);
    setUrlInput('');
    urlInputRef.current?.blur();
  }, []);

  const handleNavStateChange = useCallback((navState: WebViewNavigation) => {
    setCanGoBack(navState.canGoBack);
    setCanGoForward(navState.canGoForward);
    if (!isEditingUrl) {
      setCurrentUrl(navState.url);
    }
  }, [isEditingUrl]);

  const handleBack = useCallback(() => {
    webViewRef.current?.goBack();
  }, []);

  const handleForward = useCallback(() => {
    webViewRef.current?.goForward();
  }, []);

  const handleRefresh = useCallback(() => {
    webViewRef.current?.reload();
  }, []);

  // If currentUrl is pointing at our /proxy endpoint, show the original
  // target URL in the address bar instead of the wrapped proxy URL.
  const visibleUrl = useMemo(() => {
    if (!serverBaseUrl) return currentUrl;
    if (currentUrl.startsWith(`${serverBaseUrl}/proxy?`)) {
      try {
        const u = new URL(currentUrl);
        const orig = u.searchParams.get('url');
        if (orig) return orig;
      } catch { /* noop */ }
    }
    return currentUrl;
  }, [currentUrl, serverBaseUrl]);

  const displayedUrl = isEditingUrl ? urlInput : displayUrl(visibleUrl);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {isRelay && (
        <View style={styles.relayBanner}>
          <Text style={styles.relayBannerText}>
            Localhost proxy not yet supported over relay. Use a LAN connection to preview dev servers.
          </Text>
        </View>
      )}
      {/* URL Bar */}
      <View style={styles.toolbar}>
        {/* Back */}
        <Pressable
          style={[styles.navButton, !canGoBack && styles.navButtonDisabled]}
          onPress={handleBack}
          disabled={!canGoBack}
          hitSlop={8}
        >
          <ArrowLeft size={18} color={canGoBack ? colors.fg.secondary : colors.fg.muted} />
        </Pressable>

        {/* Forward */}
        <Pressable
          style={[styles.navButton, !canGoForward && styles.navButtonDisabled]}
          onPress={handleForward}
          disabled={!canGoForward}
          hitSlop={8}
        >
          <ArrowRight size={18} color={canGoForward ? colors.fg.secondary : colors.fg.muted} />
        </Pressable>

        {/* URL input */}
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
            onBlur={handleUrlBlur}
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

        {/* Refresh / Stop */}
        <Pressable style={styles.navButton} onPress={handleRefresh} hitSlop={8}>
          {loading ? (
            <X size={18} color={colors.fg.secondary} />
          ) : (
            <RotateCw size={18} color={colors.fg.secondary} />
          )}
        </Pressable>
      </View>

      {/* Progress bar */}
      {loading && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressBar, { width: `${progress * 100}%` }]} />
        </View>
      )}

      {/* WebView */}
      {webViewError ? (
        <ErrorView
          icon={AlertTriangle}
          title="Page failed to load"
          message={webViewError}
          onRetry={() => {
            setWebViewError(null);
            webViewRef.current?.reload();
          }}
        />
      ) : (
        <WebView
          ref={webViewRef}
          style={styles.webView}
          source={{ uri: currentUrl }}
          onNavigationStateChange={handleNavStateChange}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onLoadProgress={({ nativeEvent }) => setProgress(nativeEvent.progress)}
          onError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            console.warn('[Browser] WebView error:', nativeEvent);
            setLoading(false);
            setWebViewError(nativeEvent.description || 'An unknown error occurred');
          }}
          // Allow mixed content for local dev servers (http)
          mixedContentMode="compatibility"
          // Allow file access for local server previews
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          // User agent — keep default so sites render correctly
          applicationNameForUserAgent="StaviBrowser/1.0"
        />
      )}
    </KeyboardAvoidingView>
  );
}

// ----------------------------------------------------------
// Plugin API
// ----------------------------------------------------------

function browserApi(): BrowserPluginAPI {
  return {
    navigate: (_url: string) => {
      // GPI: navigate the active browser panel
      // Wire up via module-level state or event bus when needed
    },
  };
}

// ----------------------------------------------------------
// Plugin Definition
// ----------------------------------------------------------

export const browserPlugin: WorkspacePluginDefinition = {
  id: 'browser',
  name: 'Browser',
  description: 'In-app WebView browser for previewing local dev servers',
  scope: 'workspace',
  kind: 'core',
  icon: Globe,
  component: BrowserPanel,
  navOrder: 4,
  navLabel: 'Browser',
  allowMultipleInstances: false,
  api: browserApi,
};

// Styles computed dynamically via useMemo — see component body.
