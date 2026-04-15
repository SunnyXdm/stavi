// WHAT: PairServerScreen — QR code scanner for pairing with a remote Stavi server.
// WHY:  Tunnel mode requires the mobile app to know the server's static public key
//       and relay room ID, which are encoded in the QR shown by `stavi serve --relay`.
//       Scanning avoids manual entry of the 44-char base64 public key.
// HOW:  react-native-vision-camera + useCameraPermissions.
//       On successful scan → decode base64url PairingPayload JSON →
//       addServer with relayUrl/serverPublicKey/roomId → navigate back.
// SEE:  packages/shared/src/transport-types.ts (PairingPayload),
//       apps/mobile/src/stores/connection.ts (addServer + relay connectServer path),
//       apps/cli/src/index.ts (--relay flag that generates the QR)

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from 'react-native-vision-camera';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { X, QrCode } from 'lucide-react-native';
import type { PairingPayload } from '@stavi/shared';
import { useConnectionStore } from '../stores/connection';
import { colors, spacing, typography, radii } from '../theme';

// ----------------------------------------------------------
// Component
// ----------------------------------------------------------

export function PairServerScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const addServer = useConnectionStore((s) => s.addServer);
  const connectServer = useConnectionStore((s) => s.connectServer);

  const [scanning, setScanning] = useState(true);
  const [processing, setProcessing] = useState(false);
  const processedRef = useRef(false);

  // Request permission on mount.
  useEffect(() => {
    if (!hasPermission) {
      void requestPermission();
    }
  }, [hasPermission, requestPermission]);

  const handleGrantPermission = useCallback(() => {
    void requestPermission();
  }, [requestPermission]);

  const handleClose = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleQrCode = useCallback(
    async (raw: string) => {
      if (processedRef.current || processing) return;
      processedRef.current = true;
      setScanning(false);
      setProcessing(true);

      let payload: PairingPayload;
      try {
        payload = _decodePairingPayload(raw);
      } catch {
        Alert.alert(
          'Invalid QR Code',
          'This QR code is not a valid Stavi pairing code.',
          [
            {
              text: 'Try Again',
              onPress: () => {
                processedRef.current = false;
                setScanning(true);
                setProcessing(false);
              },
            },
          ],
        );
        return;
      }

      try {
        const conn = await addServer({
          name: `Remote: ${payload.lanHost ?? payload.relay ?? 'server'}`,
          host: payload.lanHost ?? 'relay',
          port: payload.port,
          bearerToken: payload.token,
          relayUrl: payload.relay,
          serverPublicKey: payload.serverPublicKey,
          roomId: payload.roomId,
        });

        // Auto-connect after pairing.
        void connectServer(conn.id).catch(() => {});
        navigation.goBack();
      } catch (err) {
        Alert.alert(
          'Pairing Failed',
          err instanceof Error ? err.message : 'Could not add server.',
          [
            {
              text: 'Try Again',
              onPress: () => {
                processedRef.current = false;
                setScanning(true);
                setProcessing(false);
              },
            },
          ],
        );
      }
    },
    [addServer, connectServer, navigation, processing],
  );

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (!scanning) return;
      const value = codes[0]?.value;
      if (value) void handleQrCode(value);
    },
  });

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------

  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionContainer}>
          <QrCode size={48} color={colors.fg.muted} />
          <Text style={styles.permissionTitle}>Camera Access Required</Text>
          <Text style={styles.permissionBody}>
            Stavi needs camera access to scan the QR code shown by{' '}
            <Text style={styles.code}>stavi serve --relay</Text>.
          </Text>
          <Pressable style={styles.grantButton} onPress={handleGrantPermission}>
            <Text style={styles.grantButtonText}>Grant Camera Access</Text>
          </Pressable>
          <Pressable style={styles.cancelLink} onPress={handleClose}>
            <Text style={styles.cancelLinkText}>Cancel</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!device) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>No camera found on this device.</Text>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.cameraContainer}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={scanning}
        codeScanner={codeScanner}
      />

      {/* Overlay */}
      <SafeAreaView style={styles.overlay}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Scan QR Code</Text>
          <Pressable style={styles.closeButton} onPress={handleClose} hitSlop={12}>
            <X size={20} color={colors.fg.primary} />
          </Pressable>
        </View>

        {/* Viewfinder */}
        <View style={styles.viewfinderArea}>
          <View style={styles.viewfinder}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
        </View>

        {/* Hint */}
        <View style={styles.footer}>
          {processing ? (
            <Text style={styles.hintText}>Pairing…</Text>
          ) : (
            <Text style={styles.hintText}>
              Point at the QR shown by <Text style={styles.code}>stavi serve --relay</Text>
            </Text>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

function _decodePairingPayload(raw: string): PairingPayload {
  // Support both base64url-encoded JSON (CLI output) and plain JSON (testing)
  let jsonStr: string;
  try {
    const std = raw.replace(/-/g, '+').replace(/_/g, '/');
    const padded = std + '='.repeat((4 - (std.length % 4)) % 4);
    jsonStr = atob(padded);
  } catch {
    // Try plain JSON as fallback
    jsonStr = raw;
  }
  const obj = JSON.parse(jsonStr) as Partial<PairingPayload>;
  if (!obj.serverPublicKey || !obj.roomId || !obj.token) {
    throw new Error('Incomplete pairing payload');
  }
  return obj as PairingPayload;
}

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const VIEWFINDER_SIZE = 260;
const CORNER_SIZE = 24;
const CORNER_THICKNESS = 3;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.base,
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  overlay: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  headerTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: '#fff',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  viewfinderArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewfinder: {
    width: VIEWFINDER_SIZE,
    height: VIEWFINDER_SIZE,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: '#fff',
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderTopLeftRadius: 4,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderTopRightRadius: 4,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
    borderBottomLeftRadius: 4,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
    borderBottomRightRadius: 4,
  },
  footer: {
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[5],
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  hintText: {
    fontSize: typography.fontSize.sm,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
  },
  code: {
    fontFamily: typography.fontFamily.mono,
    color: colors.accent.primary,
  },
  // Permission screen
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[8],
    gap: spacing[4],
  },
  permissionTitle: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.primary,
    textAlign: 'center',
  },
  permissionBody: {
    fontSize: typography.fontSize.base,
    color: colors.fg.secondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  grantButton: {
    backgroundColor: colors.accent.primary,
    borderRadius: radii.md,
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[3],
    marginTop: spacing[2],
  },
  grantButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.onAccent,
  },
  cancelLink: {
    paddingVertical: spacing[2],
  },
  cancelLinkText: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
  },
  errorText: {
    fontSize: typography.fontSize.base,
    color: colors.semantic.error,
    textAlign: 'center',
    padding: spacing[6],
  },
});
