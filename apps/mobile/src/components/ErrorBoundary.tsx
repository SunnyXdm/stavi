// WHAT: React error boundary — catches render errors in a subtree and shows fallback UI.
// WHY:  One plugin crash should not take down the entire app.
// HOW:  Class component (required for error boundaries). Exposes reset via setState.
// SEE:  apps/mobile/src/components/PluginRenderer.tsx (wraps MemoizedPanel)

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { ThemeContext } from '../theme/ThemeContext';
// NOTE: ErrorBoundary is a class component — hooks are not allowed here.
// We consume ThemeContext via .Consumer so styles reflect the active theme.

interface Props {
  children: React.ReactNode;
  /** Optional label shown in the fallback header, e.g. the plugin name */
  label?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  static contextType = ThemeContext;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(
      '[ErrorBoundary] Caught render error',
      this.props.label ? `in "${this.props.label}"` : '',
      '\n',
      error,
      '\nComponent stack:',
      errorInfo.componentStack,
    );
  }

  handleRestart = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const ctx = this.context as React.ContextType<typeof ThemeContext>;
    const colors = ctx?.colors;
    const typography = ctx?.typography;
    const { label } = this.props;
    const message = this.state.error?.message ?? 'Unknown error';

    // Hardcoded fallbacks are DARK (the app default) — used only if
    // ThemeProvider itself failed and `colors` is null.
    const dynamicStyles = StyleSheet.create({
      container: {
        flex: 1,
        backgroundColor: colors?.bg.base ?? '#08090a',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        gap: 12,
      },
      title: {
        fontFamily: typography?.fontFamily.sansBold ?? undefined,
        fontSize: 16,
        fontWeight: '700' as const,
        color: colors?.fg.primary ?? '#f7f8f8',
        textAlign: 'center' as const,
      },
      message: {
        fontFamily: typography?.fontFamily.mono ?? undefined,
        fontSize: 12,
        color: colors?.fg.secondary ?? '#d0d6e0',
        textAlign: 'center' as const,
        lineHeight: 18,
      },
      button: {
        marginTop: 8,
        paddingHorizontal: 20,
        paddingVertical: 10,
        backgroundColor: colors?.bg.raised ?? '#0f1011',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors?.divider ?? 'rgba(255,255,255,0.08)',
      },
      buttonText: {
        fontFamily: typography?.fontFamily.sans ?? undefined,
        fontSize: 14,
        color: colors?.fg.primary ?? '#f7f8f8',
      },
    });

    return (
      <View style={dynamicStyles.container}>
        <Text style={dynamicStyles.title}>
          {label ? `"${label}" crashed` : 'Something went wrong'}
        </Text>
        <Text style={dynamicStyles.message} numberOfLines={4}>
          {message}
        </Text>
        <TouchableOpacity style={dynamicStyles.button} onPress={this.handleRestart} activeOpacity={0.7}>
          <Text style={dynamicStyles.buttonText}>Restart</Text>
        </TouchableOpacity>
      </View>
    );
  }
}
