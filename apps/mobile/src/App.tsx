// ============================================================
// Stavi — Mobile IDE for AI Coding Agents
// ============================================================
// App entry point. Registers plugins, sets up navigation.

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SheetProvider } from 'react-native-actions-sheet';
import { SystemBars } from 'react-native-edge-to-edge';
import { StyleSheet } from 'react-native';

// Register app-wide bottom sheets (action menu + confirm). Side-effect import.
import './components/sheets/AppSheets';

import { ErrorBoundary } from './components/ErrorBoundary';
import { GlobalErrorOverlay } from './components/GlobalErrorOverlay';
import { SplashScreen } from './components/SplashScreen';
import { useAppStateListener } from './hooks/useAppStateListener';
import { ThemeProvider, useTheme } from './theme';
import type { RootStackParamList } from './navigation/types';
import { useConnectionStore } from './stores/connection';
import { useAppPreferencesStore } from './stores/app-preferences-store';

// Register all plugins (side-effect import)
import './plugins/load';

// Screens
import { WelcomeScreen } from './navigation/WelcomeScreen';
import { WorkspaceScreen } from './navigation/WorkspaceScreen';
import { SessionsHomeScreen } from './navigation/SessionsHomeScreen';
import { SettingsScreen } from './navigation/SettingsScreen';
import { PluginSettingsScreen } from './navigation/PluginSettingsScreen';
import { PairServerScreen } from './navigation/PairServerScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

// AppInner reads the active theme so NavigationContainer gets the right colors.
// Kept separate from App so it renders inside ThemeProvider.
function AppInner() {
  useAppStateListener();
  const { colors, typography, isDark } = useTheme();

  // Hold on the splash until both persisted stores that drive the initial
  // route have rehydrated — prevents a flash of the empty home (or a wrongly
  // shown welcome screen) before AsyncStorage loads.
  const connectionHydrated = useConnectionStore((s) => s.hasHydrated);
  const prefsHydrated = useAppPreferencesStore((s) => s.hasHydrated);
  const savedConnections = useConnectionStore((s) => s.savedConnections);
  const hasOnboarded = useAppPreferencesStore((s) => s.hasOnboarded);
  const ready = connectionHydrated && prefsHydrated;

  if (!ready) {
    return (
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg.base }}>
        <SafeAreaProvider>
          {/* Status-bar icon contrast must follow the JS theme everywhere —
              rendered once here (and below) instead of per-screen. */}
          <SystemBars style={isDark ? 'light' : 'dark'} />
          <SplashScreen />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  // First run = onboarding never completed AND no servers saved yet.
  const initialRouteName: keyof RootStackParamList =
    !hasOnboarded && savedConnections.length === 0 ? 'Welcome' : 'SessionsHome';

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg.base }}>
      <SafeAreaProvider>
        <KeyboardProvider>
        <SheetProvider>
        <SystemBars style={isDark ? 'light' : 'dark'} />
        <NavigationContainer
          theme={{
            dark: isDark,
            colors: {
              primary: colors.accent.primary,
              background: colors.bg.base,
              card: colors.bg.raised,
              text: colors.fg.primary,
              border: colors.divider,
              notification: colors.semantic.error,
            },
            fonts: {
              regular: { fontFamily: typography.fontFamily.sans, fontWeight: '400' as const },
              medium: { fontFamily: typography.fontFamily.sansMedium, fontWeight: '500' as const },
              bold: { fontFamily: typography.fontFamily.sansBold, fontWeight: '700' as const },
              heavy: { fontFamily: typography.fontFamily.sansBold, fontWeight: '900' as const },
            },
          }}
        >
          <Stack.Navigator
            initialRouteName={initialRouteName}
            screenOptions={{
              headerShown: false,
              animation: 'fade',
              contentStyle: { backgroundColor: colors.bg.base },
            }}
          >
            <Stack.Screen name="Welcome" component={WelcomeScreen} />
            <Stack.Screen name="SessionsHome" component={SessionsHomeScreen} />
            <Stack.Screen name="Workspace" component={WorkspaceScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="PluginSettings" component={PluginSettingsScreen} />
            <Stack.Screen
              name="PairServer"
              component={PairServerScreen}
              options={{ animation: 'slide_from_bottom', presentation: 'fullScreenModal' }}
            />
          </Stack.Navigator>
        </NavigationContainer>
        </SheetProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      {/* Inside ThemeProvider so a child crash gets a themed fallback. If
          ThemeProvider itself fails, ErrorBoundary's hardcoded fallback (dark,
          matching the app default) still renders — never a white screen. */}
      <ErrorBoundary label="App">
        <AppInner />
      </ErrorBoundary>
      {/* Async/event-handler errors bypass ErrorBoundary (render-only).
          GlobalErrorOverlay shows a themed recovery surface for fatals
          reported by src/utils/global-error-handler.ts. Renders null unless
          a fatal is present, so it's a no-op on the happy path. */}
      <GlobalErrorOverlay />
    </ThemeProvider>
  );
}

// Minimal fallback style — used only if ErrorBoundary itself renders before ThemeProvider
const styles = StyleSheet.create({
  root: { flex: 1 },
});
void styles; // suppress unused warning
