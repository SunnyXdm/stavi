// ============================================================
// Stavi — Mobile IDE for AI Coding Agents
// ============================================================
// App entry point. Registers plugins, sets up navigation.

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';

// Register all plugins (side-effect import)
import './plugins/load';

// Screens
import { WorkspaceScreen } from './navigation/WorkspaceScreen';
import { ConnectScreen } from './navigation/ConnectScreen';
import { SettingsScreen } from './navigation/SettingsScreen';

import { colors, typography } from './theme';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <NavigationContainer
          theme={{
            dark: true,
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
            screenOptions={{
              headerShown: false,
              animation: 'fade',
              contentStyle: { backgroundColor: colors.bg.base },
            }}
          >
            <Stack.Screen name="Connect" component={ConnectScreen} />
            <Stack.Screen name="Workspace" component={WorkspaceScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg.base,
  },
});
