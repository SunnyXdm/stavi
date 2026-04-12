// ============================================================
// ApiKeySetup — Full-screen overlay for API key entry
// ============================================================
// Shown when Claude provider is not authenticated.
// User can paste their Anthropic API key.

import React, { memo, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Modal,
  Linking,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { X, Key, ExternalLink } from 'lucide-react-native';
import { colors, typography, spacing, radii } from '../../../theme';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

interface ApiKeySetupProps {
  visible: boolean;
  onClose: () => void;
  onSave: (apiKey: string) => Promise<void>;
}

// ----------------------------------------------------------
// Main component
// ----------------------------------------------------------

export const ApiKeySetup = memo(function ApiKeySetup({
  visible,
  onClose,
  onSave,
}: ApiKeySetupProps) {
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) return;

    // Basic validation
    if (!trimmed.startsWith('sk-ant-')) {
      setError('API key should start with "sk-ant-"');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
      setApiKey('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save API key');
    } finally {
      setSaving(false);
    }
  }, [apiKey, onSave, onClose]);

  const handleGetKey = useCallback(() => {
    Linking.openURL('https://console.anthropic.com/settings/keys');
  }, []);

  const isValid = apiKey.trim().length > 10;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdropPress} onPress={onClose} />

        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Key size={18} color={colors.accent.primary} />
              <Text style={styles.headerTitle}>Anthropic API Key</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={20} color={colors.fg.muted} />
            </Pressable>
          </View>

          {/* Content */}
          <View style={styles.content}>
            <Text style={styles.description}>
              Enter your Anthropic API key to enable Claude. Your key is stored locally on the server and never sent anywhere else.
            </Text>

            <TextInput
              style={styles.keyInput}
              value={apiKey}
              onChangeText={(text) => {
                setApiKey(text);
                setError(null);
              }}
              placeholder="sk-ant-api..."
              placeholderTextColor={colors.fg.muted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              autoFocus
            />

            {error && (
              <Text style={styles.errorText}>{error}</Text>
            )}

            {/* Get API key link */}
            <Pressable style={styles.linkRow} onPress={handleGetKey}>
              <ExternalLink size={14} color={colors.accent.primary} />
              <Text style={styles.linkText}>Get an API key from Anthropic</Text>
            </Pressable>

            {/* Save button */}
            <Pressable
              style={[styles.saveButton, (!isValid || saving) && styles.saveButtonDisabled]}
              onPress={handleSave}
              disabled={!isValid || saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.fg.onAccent} />
              ) : (
                <Text style={styles.saveButtonText}>Save API Key</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
});

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  backdropPress: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.bg.base,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
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
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  headerTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.primary,
  },
  content: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[8],
    gap: spacing[4],
  },
  description: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.tertiary,
    lineHeight: typography.fontSize.sm * 1.5,
  },
  keyInput: {
    backgroundColor: colors.bg.input,
    borderRadius: radii.md,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily.mono,
    color: colors.fg.primary,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  errorText: {
    fontSize: typography.fontSize.sm,
    color: colors.semantic.error,
    marginTop: -spacing[2],
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  linkText: {
    fontSize: typography.fontSize.sm,
    color: colors.accent.primary,
    fontWeight: typography.fontWeight.medium,
  },
  saveButton: {
    backgroundColor: colors.accent.primary,
    borderRadius: radii.md,
    paddingVertical: spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.onAccent,
  },
});
