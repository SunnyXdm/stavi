// WHAT: Add Server sheet used by Sessions Home.
// WHY:  Phase 2 repurposes the old Connect root into a callback-driven add server flow.
//       Phase 6 adds a "Pair via QR" button for tunnel mode pairing.
// HOW:  Wraps AddServerModal and optionally auto-connects the new server via connection store.
//       QR button navigates to PairServerScreen (modal stack).
// SEE:  apps/mobile/src/components/AddServerModal.tsx, apps/mobile/src/stores/connection.ts,
//       apps/mobile/src/navigation/PairServerScreen.tsx

import React, { useCallback, useMemo } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { AppNavigation } from '../navigation/types';
import { QrCode } from 'lucide-react-native';
import { AddServerModal } from './AddServerModal';
import { useConnectionStore, type SavedConnection } from '../stores/connection';
import { useTheme } from '../theme';
import { spacing, radii, typography } from '../theme';

interface AddServerSheetProps {
  visible: boolean;
  onClose: () => void;
  onComplete?: (connection: SavedConnection) => void;
}

export function AddServerSheet({ visible, onClose, onComplete }: AddServerSheetProps) {
  const navigation = useNavigation<AppNavigation>();
  const connectServer = useConnectionStore((state) => state.connectServer);
  const { colors } = useTheme();

  const handleComplete = useCallback(
    async (connection: SavedConnection) => {
      try {
        await connectServer(connection.id);
      } catch (err) {
        Alert.alert(
          'Connection Failed',
          err instanceof Error ? err.message : 'Unable to connect to server',
          [{ text: 'OK' }],
        );
      }
      onComplete?.(connection);
    },
    [connectServer, onComplete],
  );

  const handlePairQr = useCallback(() => {
    onClose();
    navigation.navigate('PairServer');
  }, [navigation, onClose]);

  const styles = useMemo(() => StyleSheet.create({
    qrButton: {
      position: 'absolute',
      bottom: spacing[6],
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      paddingVertical: spacing[2],
      paddingHorizontal: spacing[4],
      borderRadius: radii.full,
      backgroundColor: colors.bg.raised,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    qrButtonText: {
      fontSize: typography.fontSize.sm,
      color: colors.accent.primary,
      fontWeight: typography.fontWeight.medium,
    },
  }), [colors]);

  return (
    <>
      <AddServerModal
        visible={visible}
        onClose={onClose}
        onComplete={handleComplete}
      />
      {/* "Pair via QR" shortcut — rendered outside the modal so it's always visible */}
      {visible ? (
        <Pressable style={styles.qrButton} onPress={handlePairQr}>
          <QrCode size={16} color={colors.accent.primary} />
          <Text style={styles.qrButtonText}>Pair via QR</Text>
        </Pressable>
      ) : null}
    </>
  );
}
