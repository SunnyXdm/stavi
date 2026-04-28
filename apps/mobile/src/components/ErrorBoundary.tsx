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
  declare context: React.ContextType<typeof ThemeContext>;

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

    const colors = this.context?.colors;
    const typography = this.context?.typography;
    const { label } = this.props;
    const message = this.state.error?.message ?? 'Unknown error';

    const dynamicStyles = StyleSheet.create({
      container: {
        flex: 1,
        backgroundColor: colors?.bg.base ?? '#f2f1ed',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        gap: 12,
      },
      title: {
        fontFamily: typography?.fontFamily.sansBold ?? undefined,
        fontSize: 16,
        fontWeight: '700' as const,
        color: colors?.fg.primary ?? '#26251e',
        textAlign: 'center' as const,
      },
      message: {
        fontFamily: typography?.fontFamily.mono ?? undefined,
        fontSize: 12,
        color: colors?.fg.secondary ?? '#4a4840',
        textAlign: 'center' as const,
        lineHeight: 18,
      },
      button: {
        marginTop: 8,
        paddingHorizontal: 20,
        paddingVertical: 10,
        backgroundColor: colors?.bg.raised ?? '#e8e7e2',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors?.divider ?? '#d0cfc9',
      },
      buttonText: {
        fontFamily: typography?.fontFamily.sans ?? undefined,
        fontSize: 14,
        color: colors?.fg.primary ?? '#26251e',
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
