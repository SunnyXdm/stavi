// ============================================================
// AddServerModal — Manual server entry (host + port + token)
// ============================================================
// Modal for adding a local Stavi server connection.
// No QR code in beta — manual entry only.

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useConnectionStore, type SavedConnection } from '../stores/connection';
import { colors, typography, spacing, radii } from '../theme';
import { devConnectionConfig } from '../generated/dev-config';

// ----------------------------------------------------------
// Props
// ----------------------------------------------------------

interface AddServerModalProps {
  visible: boolean;
  onClose: () => void;
  onComplete: (connection: SavedConnection) => void;
}

// ----------------------------------------------------------
// Component
// ----------------------------------------------------------

export function AddServerModal({ visible, onClose, onComplete }: AddServerModalProps) {
  const defaultHost = Platform.OS === 'android'
    ? (devConnectionConfig?.androidHost ?? '')
    : (devConnectionConfig?.iosHost ?? '');
  const [name, setName] = useState('');
  const [host, setHost] = useState(defaultHost);
  const [port, setPort] = useState(String(devConnectionConfig?.port ?? 3773));
  const [token, setToken] = useState(devConnectionConfig?.bearerToken ?? '');
  const [error, setError] = useState<string | null>(null);

  const hostRef = useRef<TextInput>(null);
  const portRef = useRef<TextInput>(null);
  const tokenRef = useRef<TextInput>(null);

  const saveConnection = useConnectionStore((s) => s.saveConnection);

  const resetForm = useCallback(() => {
    setName('');
    setHost(defaultHost);
    setPort(String(devConnectionConfig?.port ?? 3773));
    setToken(devConnectionConfig?.bearerToken ?? '');
    setError(null);
  }, [defaultHost]);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  const handleConnect = useCallback(() => {
    // Validate
    const trimmedHost = host.trim();
    const trimmedToken = token.trim();
    const portNum = parseInt(port, 10);

    if (!trimmedHost) {
      setError('Host is required');
      hostRef.current?.focus();
      return;
    }

    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setError('Port must be between 1 and 65535');
      portRef.current?.focus();
      return;
    }

    if (!trimmedToken) {
      setError('Bearer token is required');
      tokenRef.current?.focus();
      return;
    }

    setError(null);

    // Save and return
    const connection = saveConnection({
      name: name.trim() || `${trimmedHost}:${portNum}`,
      host: trimmedHost,
      port: portNum,
      bearerToken: trimmedToken,
    });

    resetForm();
    onComplete(connection);
  }, [name, host, port, token, saveConnection, resetForm, onComplete]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          style={styles.keyboardView}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Add Server</Text>
            <Pressable
              style={styles.closeButton}
              onPress={handleClose}
              hitSlop={12}
            >
              <X size={20} color={colors.fg.secondary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.form}
            contentContainerStyle={styles.formContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Name (optional) */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Name (optional)</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="My Dev Machine"
                placeholderTextColor={colors.fg.muted}
                returnKeyType="next"
                onSubmitEditing={() => hostRef.current?.focus()}
                autoCapitalize="words"
              />
            </View>

            {/* Host */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Host</Text>
              <TextInput
                ref={hostRef}
                style={styles.input}
                value={host}
                onChangeText={(text) => {
                  setHost(text);
                  setError(null);
                }}
                placeholder="192.168.1.5"
                placeholderTextColor={colors.fg.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="next"
                onSubmitEditing={() => portRef.current?.focus()}
              />
            </View>

            {/* Port */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Port</Text>
              <TextInput
                ref={portRef}
                style={styles.input}
                value={port}
                onChangeText={(text) => {
                  setPort(text);
                  setError(null);
                }}
                placeholder="3773"
                placeholderTextColor={colors.fg.muted}
                keyboardType="number-pad"
                returnKeyType="next"
                onSubmitEditing={() => tokenRef.current?.focus()}
              />
            </View>

            {/* Bearer Token */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Bearer Token</Text>
              <TextInput
                ref={tokenRef}
                style={[styles.input, styles.tokenInput]}
                value={token}
                onChangeText={(text) => {
                  setToken(text);
                  setError(null);
                }}
                placeholder="Paste token from yarn dev"
                placeholderTextColor={colors.fg.muted}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                returnKeyType="done"
              />
              <Text style={styles.fieldHint}>
                Run <Text style={styles.code}>yarn dev</Text> and copy the token
              </Text>
            </View>

            {/* Error */}
            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Connect Button */}
            <Pressable
              style={({ pressed }) => [
                styles.connectButton,
                pressed && styles.connectButtonPressed,
              ]}
              onPress={handleConnect}
            >
              <Text style={styles.connectButtonText}>Connect</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.base,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  headerTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.primary,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  form: {
    flex: 1,
  },
  formContent: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[6],
    paddingBottom: spacing[8],
  },
  field: {
    marginBottom: spacing[5],
  },
  fieldLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.secondary,
    marginBottom: spacing[2],
  },
  input: {
    backgroundColor: colors.bg.input,
    borderRadius: radii.md,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily.mono,
    color: colors.fg.primary,
  },
  tokenInput: {
    minHeight: 80,
    paddingTop: spacing[3],
  },
  fieldHint: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
    marginTop: spacing[1],
    marginLeft: spacing[1],
  },
  code: {
    fontFamily: typography.fontFamily.mono,
    color: colors.accent.primary,
  },
  errorBox: {
    backgroundColor: colors.semantic.errorSubtle,
    borderRadius: radii.md,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    marginBottom: spacing[5],
  },
  errorText: {
    fontSize: typography.fontSize.sm,
    color: colors.semantic.error,
  },
  connectButton: {
    backgroundColor: colors.accent.primary,
    borderRadius: radii.md,
    paddingVertical: spacing[4],
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  connectButtonPressed: {
    backgroundColor: colors.accent.secondary,
  },
  connectButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.onAccent,
  },
});
