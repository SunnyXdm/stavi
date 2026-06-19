// WHAT: First-run welcome / start screen (lunel-style intro).
// WHY:  Gives new users a branded landing with what Stavi does and a clear path
//       to connect their first server, instead of dropping straight onto an
//       empty home. Shown once — gated by app-preferences `hasOnboarded`.
// HOW:  Navigation screen. "Get Started" marks onboarding complete and replaces
//       to SessionsHome, whose empty state hosts the Add Server / QR flow.
// SEE:  apps/mobile/src/App.tsx (initial route decision),
//       apps/mobile/src/stores/app-preferences-store.ts

import React, { useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Terminal, Bot, Wifi } from 'lucide-react-native';
import { useTheme, typography, spacing, radii } from '../theme';
import { MoonLogo } from '../components/MoonLogo';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { useAppPreferencesStore } from '../stores/app-preferences-store';
import type { AppNavigation } from './types';

const FEATURES = [
  { icon: Bot, title: 'Run AI agents', body: 'Drive Claude & Codex on your own machine, live.' },
  { icon: Terminal, title: 'Terminal + editor', body: 'A real shell and code editor in your pocket.' },
  { icon: Wifi, title: 'Connect anywhere', body: 'Pair over your LAN or a secure relay.' },
];

export function WelcomeScreen({ navigation }: { navigation: AppNavigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const setHasOnboarded = useAppPreferencesStore((s) => s.setHasOnboarded);

  const handleGetStarted = useCallback(() => {
    setHasOnboarded(true);
    navigation.replace('SessionsHome');
  }, [navigation, setHasOnboarded]);

  const styles = useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg.base, paddingHorizontal: spacing[6] },
    hero: { alignItems: 'center', marginTop: height * 0.12 },
    wordmark: { marginTop: spacing[4], fontSize: 36, fontWeight: typography.fontWeight.bold, color: colors.fg.primary, letterSpacing: 1 },
    tagline: { marginTop: spacing[1], fontSize: typography.fontSize.base, color: colors.fg.muted },
    features: { marginTop: height * 0.07, gap: spacing[4] },
    feature: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
    featureIcon: { width: 42, height: 42, borderRadius: radii.md, backgroundColor: colors.bg.raised, alignItems: 'center', justifyContent: 'center' },
    featureText: { flex: 1 },
    featureTitle: { fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.semibold, color: colors.fg.primary },
    featureBody: { fontSize: typography.fontSize.sm, color: colors.fg.muted, marginTop: 1 },
    footer: { position: 'absolute', left: spacing[6], right: spacing[6], bottom: insets.bottom + spacing[5] },
    primaryButton: { backgroundColor: colors.accent.primary, borderRadius: radii.md, paddingVertical: spacing[4], alignItems: 'center' },
    primaryButtonText: { fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.semibold, color: colors.fg.onAccent },
  }), [colors, insets.bottom, height]);

  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <MoonLogo size={92} />
        <Text style={styles.wordmark}>Stavi</Text>
        <Text style={styles.tagline}>AI agents, from your pocket</Text>
      </View>

      <View style={styles.features}>
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <View key={title} style={styles.feature}>
            <View style={styles.featureIcon}>
              <Icon size={20} color={colors.accent.primary} />
            </View>
            <View style={styles.featureText}>
              <Text style={styles.featureTitle}>{title}</Text>
              <Text style={styles.featureBody}>{body}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <AnimatedPressable style={styles.primaryButton} onPress={handleGetStarted} haptic="medium">
          <Text style={styles.primaryButtonText}>Get Started</Text>
        </AnimatedPressable>
      </View>
    </View>
  );
}
