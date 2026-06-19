// WHAT: App-wide bottom sheets (action menu + confirm) and promise-based
//       helpers to replace OS Alert.alert / ActionSheetIOS everywhere.
// WHY:  Long-press menus, confirmations, and errors should be in-app bottom
//       sheets — consistent, themeable, and identical on iOS and Android —
//       instead of jarring native dialogs.
// HOW:  Two sheets registered with react-native-actions-sheet's SheetManager.
//       `showActionMenu` / `showConfirm` show a sheet and resolve with the
//       user's choice via SheetManager.hide's payload. Register once at boot
//       (imported by plugins/load.ts) and render <SheetProvider/> in App.
// SEE:  apps/mobile/src/App.tsx (SheetProvider), apps/mobile/src/plugins/load.ts

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import ActionSheet, { SheetManager, registerSheet, useSheetPayload, type SheetProps } from 'react-native-actions-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, typography, spacing, radii } from '../../theme';
import { AnimatedPressable } from '../AnimatedPressable';

// ----------------------------------------------------------
// Public types + helpers
// ----------------------------------------------------------

export interface ActionMenuOption {
  key: string;
  label: string;
  destructive?: boolean;
}

export interface ActionMenuPayload {
  title?: string;
  message?: string;
  options: ActionMenuOption[];
}

export interface ConfirmPayload {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Hide the cancel row — used for one-button info/error alerts. */
  alertOnly?: boolean;
}

/** Show a bottom-sheet action menu. Resolves with the chosen option key, or
 *  null if dismissed. */
export async function showActionMenu(payload: ActionMenuPayload): Promise<string | null> {
  const result = await SheetManager.show('app-action-menu', { payload });
  return (result as string | undefined) ?? null;
}

/** Show a confirmation bottom sheet. Resolves true if confirmed, false if
 *  cancelled/dismissed. */
export async function showConfirm(payload: ConfirmPayload): Promise<boolean> {
  const result = await SheetManager.show('app-confirm', { payload });
  return result === true;
}

/** Show a one-button info/error bottom sheet (replaces a plain Alert.alert).
 *  Resolves when dismissed. */
export async function showAlert(payload: { title: string; message?: string; buttonLabel?: string }): Promise<void> {
  await SheetManager.show('app-confirm', {
    payload: { title: payload.title, message: payload.message, confirmLabel: payload.buttonLabel ?? 'OK', alertOnly: true },
  });
}

// ----------------------------------------------------------
// Action menu sheet
// ----------------------------------------------------------

function ActionMenuSheet(props: SheetProps<'app-action-menu'>) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const payload = useSheetPayload('app-action-menu') as ActionMenuPayload | undefined;
  const data = payload ?? props.payload ?? { options: [] };

  const s = sheetStyles(colors, insets.bottom);
  return (
    <ActionSheet id={props.sheetId} gestureEnabled containerStyle={s.container} indicatorStyle={s.indicator}>
      <View style={s.body}>
        {(data.title || data.message) && (
          <View style={s.header}>
            {data.title ? <Text style={s.title}>{data.title}</Text> : null}
            {data.message ? <Text style={s.message}>{data.message}</Text> : null}
          </View>
        )}
        {data.options.map((opt) => (
          <AnimatedPressable
            key={opt.key}
            style={s.row}
            onPress={() => SheetManager.hide('app-action-menu', { payload: opt.key })}
            haptic="light"
          >
            <Text style={[s.rowLabel, opt.destructive && s.destructive]}>{opt.label}</Text>
          </AnimatedPressable>
        ))}
        <AnimatedPressable
          style={[s.row, s.cancelRow]}
          onPress={() => SheetManager.hide('app-action-menu', { payload: undefined })}
        >
          <Text style={s.cancelLabel}>Cancel</Text>
        </AnimatedPressable>
      </View>
    </ActionSheet>
  );
}

// ----------------------------------------------------------
// Confirm sheet
// ----------------------------------------------------------

function ConfirmSheet(props: SheetProps<'app-confirm'>) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const payload = useSheetPayload('app-confirm') as ConfirmPayload | undefined;
  const data = payload ?? props.payload ?? { title: '' };

  const s = sheetStyles(colors, insets.bottom);
  return (
    <ActionSheet id={props.sheetId} gestureEnabled containerStyle={s.container} indicatorStyle={s.indicator}>
      <View style={s.body}>
        <View style={s.header}>
          <Text style={s.title}>{data.title}</Text>
          {data.message ? <Text style={s.message}>{data.message}</Text> : null}
        </View>
        <AnimatedPressable
          style={[s.confirmButton, data.destructive ? s.confirmDestructive : s.confirmPrimary]}
          onPress={() => SheetManager.hide('app-confirm', { payload: true })}
          haptic="medium"
        >
          <Text style={[s.confirmLabel, data.destructive && s.confirmLabelDestructive]}>
            {data.confirmLabel ?? 'Confirm'}
          </Text>
        </AnimatedPressable>
        {!data.alertOnly && (
          <AnimatedPressable
            style={[s.row, s.cancelRow]}
            onPress={() => SheetManager.hide('app-confirm', { payload: false })}
          >
            <Text style={s.cancelLabel}>{data.cancelLabel ?? 'Cancel'}</Text>
          </AnimatedPressable>
        )}
      </View>
    </ActionSheet>
  );
}

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

function sheetStyles(colors: ReturnType<typeof useTheme>['colors'], bottomInset: number) {
  return StyleSheet.create({
    container: { backgroundColor: colors.bg.raised, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl },
    indicator: { backgroundColor: colors.divider, width: 36 },
    body: { paddingHorizontal: spacing[3], paddingTop: spacing[2], paddingBottom: bottomInset + spacing[3], gap: spacing[1] },
    header: { paddingHorizontal: spacing[2], paddingVertical: spacing[3], gap: 4 },
    title: { fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.semibold, color: colors.fg.primary },
    message: { fontSize: typography.fontSize.sm, color: colors.fg.muted, lineHeight: 20 },
    row: { paddingVertical: spacing[4], paddingHorizontal: spacing[3], borderRadius: radii.md, alignItems: 'center', backgroundColor: colors.bg.overlay },
    rowLabel: { fontSize: typography.fontSize.base, color: colors.fg.primary, fontWeight: typography.fontWeight.medium },
    destructive: { color: colors.semantic.error },
    cancelRow: { backgroundColor: 'transparent', marginTop: spacing[1] },
    cancelLabel: { fontSize: typography.fontSize.base, color: colors.fg.secondary, fontWeight: typography.fontWeight.semibold },
    confirmButton: { paddingVertical: spacing[4], borderRadius: radii.md, alignItems: 'center' },
    confirmPrimary: { backgroundColor: colors.accent.primary },
    confirmDestructive: { backgroundColor: colors.semantic.error },
    confirmLabel: { fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.semibold, color: colors.fg.onAccent },
    confirmLabelDestructive: { color: colors.fg.onAccent },
  });
}

// ----------------------------------------------------------
// Registration + type augmentation
// ----------------------------------------------------------

registerSheet('app-action-menu', ActionMenuSheet);
registerSheet('app-confirm', ConfirmSheet);

declare module 'react-native-actions-sheet' {
  interface Sheets {
    'app-action-menu': { payload: ActionMenuPayload; returnValue: string | undefined };
    'app-confirm': { payload: ConfirmPayload; returnValue: boolean };
  }
}
