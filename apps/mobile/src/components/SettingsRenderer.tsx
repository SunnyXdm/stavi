// WHAT: Auto-renders a plugin's settings schema as UI fields.
// WHY:  Plugins declare a PluginSettingsSchema; this component renders all sections
//       and fields without any per-plugin UI code.
// HOW:  Renders Section → Field based on field.type. All values read/write via
//       usePluginSetting / usePluginSettingsStore.setSetting.
//       Styles are derived from useTheme() so they adapt to light/dark mode.
// SEE:  packages/shared/src/plugin-types.ts (PluginSettingsSchema)
//       apps/mobile/src/stores/plugin-settings-store.ts

import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Switch,
  TextInput,
  Pressable,
  StyleSheet,
} from 'react-native';
import type {
  PluginSettingsSchema,
  PluginSettingField,
} from '@stavi/shared';
import { usePluginSetting, usePluginSettingsStore } from '../stores/plugin-settings-store';
import { useTheme } from '../theme';
import { typography, spacing, radii } from '../theme';

// ----------------------------------------------------------
// Style factory — called once per render when colors change
// ----------------------------------------------------------

function useStyles() {
  const { colors } = useTheme();
  return useMemo(() => StyleSheet.create({
    sectionContainer: { marginBottom: spacing[2] },
    sectionTitle: {
      fontSize: typography.fontSize.xs,
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.tertiary,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: spacing[2],
      paddingHorizontal: spacing[4],
    },
    sectionDescription: {
      fontSize: typography.fontSize.sm,
      color: colors.fg.secondary,
      paddingHorizontal: spacing[4],
      marginBottom: spacing[2],
    },
    sectionCard: {
      backgroundColor: colors.bg.raised,
      borderRadius: radii.lg,
      marginHorizontal: spacing[4],
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
      minHeight: 48,
      gap: spacing[3],
    },
    rowColumn: {
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: spacing[2],
    },
    withBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    labelWrap: { flex: 1 },
    label: {
      fontSize: typography.fontSize.base,
      color: colors.fg.primary,
      fontWeight: typography.fontWeight.regular,
    },
    labelSelected: {
      color: colors.accent.primary,
      fontWeight: typography.fontWeight.semibold,
    },
    description: {
      fontSize: typography.fontSize.sm,
      color: colors.fg.secondary,
      marginTop: 2,
    },
    textInput: {
      width: '100%',
      fontSize: typography.fontSize.base,
      color: colors.fg.primary,
      fontFamily: typography.fontFamily.mono,
      paddingVertical: spacing[2],
      paddingHorizontal: spacing[3],
      backgroundColor: colors.bg.input,
      borderRadius: radii.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    numberInput: { width: 72, textAlign: 'right' },
    selectWrapper: { paddingTop: spacing[3] },
    selectHeader: { paddingHorizontal: spacing[4], paddingBottom: spacing[2] },
    selectOption: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
      gap: spacing[3],
    },
    dot: {
      width: 18, height: 18, borderRadius: 9,
      borderWidth: 2, borderColor: colors.fg.muted,
      alignItems: 'center', justifyContent: 'center',
    },
    dotFill: {
      width: 9, height: 9, borderRadius: 4.5,
      backgroundColor: colors.accent.primary,
    },
  }), [colors]);
}

type Styles = ReturnType<typeof useStyles>;

// ----------------------------------------------------------
// SettingsRenderer (entry point)
// ----------------------------------------------------------

interface SettingsRendererProps {
  pluginId: string;
  schema: PluginSettingsSchema;
}

export function SettingsRenderer({ pluginId, schema }: SettingsRendererProps) {
  const styles = useStyles();
  return (
    <View>
      {schema.sections.map((section, i) => (
        <SettingsSection key={section.title + i} pluginId={pluginId} section={section} styles={styles} />
      ))}
    </View>
  );
}

// ----------------------------------------------------------
// Section
// ----------------------------------------------------------

function SettingsSection({
  pluginId,
  section,
  styles,
}: {
  pluginId: string;
  section: PluginSettingsSchema['sections'][number];
  styles: Styles;
}) {
  return (
    <View style={styles.sectionContainer}>
      <Text style={styles.sectionTitle}>{section.title.toUpperCase()}</Text>
      {section.description && (
        <Text style={styles.sectionDescription}>{section.description}</Text>
      )}
      <View style={styles.sectionCard}>
        {section.fields.map((field, i) => (
          <FieldRenderer
            key={field.key}
            pluginId={pluginId}
            field={field}
            last={i === section.fields.length - 1}
            styles={styles}
          />
        ))}
      </View>
    </View>
  );
}

// ----------------------------------------------------------
// Field dispatcher
// ----------------------------------------------------------

function FieldRenderer({
  pluginId,
  field,
  last,
  styles,
}: {
  pluginId: string;
  field: PluginSettingField;
  last: boolean;
  styles: Styles;
}) {
  const { colors } = useTheme();
  switch (field.type) {
    case 'boolean':
      return <BooleanField pluginId={pluginId} field={field} last={last} styles={styles} colors={colors} />;
    case 'string':
      return <StringField pluginId={pluginId} field={field} last={last} styles={styles} colors={colors} />;
    case 'number':
      return <NumberField pluginId={pluginId} field={field} last={last} styles={styles} colors={colors} />;
    case 'select':
      return <SelectField pluginId={pluginId} field={field} last={last} styles={styles} colors={colors} />;
  }
}

// ----------------------------------------------------------
// Boolean field
// ----------------------------------------------------------

function BooleanField({ pluginId, field, last, styles, colors }: {
  pluginId: string;
  field: Extract<PluginSettingField, { type: 'boolean' }>;
  last: boolean;
  styles: Styles;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const value = usePluginSetting<boolean>(pluginId, field.key);
  const setSetting = usePluginSettingsStore((s) => s.setSetting);
  const handleChange = useCallback((v: boolean) => setSetting(pluginId, field.key, v), [pluginId, field.key, setSetting]);

  return (
    <View style={[styles.row, !last && styles.withBorder]}>
      <View style={styles.labelWrap}>
        <Text style={styles.label}>{field.label}</Text>
        {field.description && <Text style={styles.description}>{field.description}</Text>}
      </View>
      <Switch
        value={value ?? false}
        onValueChange={handleChange}
        trackColor={{ false: colors.bg.active, true: colors.accent.primary }}
        thumbColor={colors.fg.primary}
      />
    </View>
  );
}

// ----------------------------------------------------------
// String field
// ----------------------------------------------------------

function StringField({ pluginId, field, last, styles, colors }: {
  pluginId: string;
  field: Extract<PluginSettingField, { type: 'string' }>;
  last: boolean;
  styles: Styles;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const value = usePluginSetting<string>(pluginId, field.key);
  const setSetting = usePluginSettingsStore((s) => s.setSetting);

  return (
    <View style={[styles.row, styles.rowColumn, !last && styles.withBorder]}>
      <Text style={styles.label}>{field.label}</Text>
      {field.description && <Text style={styles.description}>{field.description}</Text>}
      <TextInput
        style={styles.textInput}
        value={value ?? ''}
        onChangeText={(v) => setSetting(pluginId, field.key, v)}
        placeholder={field.placeholder}
        placeholderTextColor={colors.fg.muted}
      />
    </View>
  );
}

// ----------------------------------------------------------
// Number field
// ----------------------------------------------------------

function NumberField({ pluginId, field, last, styles, colors }: {
  pluginId: string;
  field: Extract<PluginSettingField, { type: 'number' }>;
  last: boolean;
  styles: Styles;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const value = usePluginSetting<number>(pluginId, field.key);
  const setSetting = usePluginSettingsStore((s) => s.setSetting);

  const handleBlur = useCallback((text: string) => {
    let n = parseFloat(text);
    if (isNaN(n)) n = field.default;
    if (field.min !== undefined && n < field.min) n = field.min;
    if (field.max !== undefined && n > field.max) n = field.max;
    setSetting(pluginId, field.key, n);
  }, [pluginId, field, setSetting]);

  return (
    <View style={[styles.row, !last && styles.withBorder]}>
      <View style={styles.labelWrap}>
        <Text style={styles.label}>{field.label}</Text>
        {field.description && <Text style={styles.description}>{field.description}</Text>}
      </View>
      <TextInput
        style={[styles.textInput, styles.numberInput]}
        defaultValue={String(value ?? field.default)}
        keyboardType="numeric"
        onEndEditing={(e) => handleBlur(e.nativeEvent.text)}
        placeholderTextColor={colors.fg.muted}
      />
    </View>
  );
}

// ----------------------------------------------------------
// Select field
// ----------------------------------------------------------

function SelectField({ pluginId, field, last, styles, colors }: {
  pluginId: string;
  field: Extract<PluginSettingField, { type: 'select' }>;
  last: boolean;
  styles: Styles;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const value = usePluginSetting<string>(pluginId, field.key);
  const setSetting = usePluginSettingsStore((s) => s.setSetting);

  return (
    <View style={[styles.selectWrapper, !last && styles.withBorder]}>
      <View style={styles.selectHeader}>
        <Text style={styles.label}>{field.label}</Text>
        {field.description && <Text style={styles.description}>{field.description}</Text>}
      </View>
      {field.options.map((option, i) => {
        const isSelected = (value ?? field.default) === option.value;
        return (
          <Pressable
            key={option.value}
            style={[styles.selectOption, i < field.options.length - 1 && styles.withBorder]}
            onPress={() => setSetting(pluginId, field.key, option.value)}
            android_ripple={{ color: colors.bg.active }}
          >
            <View style={styles.dot}>
              {isSelected && <View style={styles.dotFill} />}
            </View>
            <View style={styles.labelWrap}>
              <Text style={[styles.label, isSelected && styles.labelSelected]}>{option.label}</Text>
              {option.description && <Text style={styles.description}>{option.description}</Text>}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
