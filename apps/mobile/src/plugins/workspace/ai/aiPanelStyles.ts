// ============================================================
// AI Panel styles — factory used by ai/index.tsx
// ============================================================
// Extracted from ai/index.tsx (Phase 8g split).
// Converted to createAiPanelStyles(colors) factory (Phase A1 P2 theme migration).

import { StyleSheet } from 'react-native';
import { typography, spacing, radii } from '../../../theme';
import type { Colors } from '../../../theme';

export function createAiPanelStyles(colors: Colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg.base,
    },
    chatHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 40,
      paddingHorizontal: spacing[4],
      backgroundColor: colors.bg.raised,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
      gap: spacing[2],
    },
    chatHeaderTitle: {
      flex: 1,
      fontSize: typography.fontSize.sm,
      fontWeight: typography.fontWeight.medium,
      color: colors.fg.secondary,
    },
    newChatBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[1],
      paddingHorizontal: spacing[2],
      paddingVertical: spacing[1],
      borderRadius: radii.sm,
      backgroundColor: colors.bg.active,
    },
    newChatBtnLabel: {
      fontSize: typography.fontSize.xs,
      fontWeight: typography.fontWeight.medium,
      color: colors.fg.secondary,
    },
    emptyChat: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing[8],
      gap: spacing[3],
    },
    emptyChatTitle: {
      fontSize: typography.fontSize.lg,
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.primary,
    },
    emptyChatSubtitle: {
      fontSize: typography.fontSize.base,
      color: colors.fg.tertiary,
      textAlign: 'center',
      lineHeight: typography.fontSize.base * typography.lineHeight.normal,
    },
    messageList: {
      paddingTop: spacing[4],
      paddingBottom: spacing[4],
    },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.semantic.errorSubtle,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
      gap: spacing[2],
    },
    errorBannerText: {
      flex: 1,
      fontSize: typography.fontSize.sm,
      color: colors.semantic.error,
    },
    errorBannerDismiss: {
      padding: spacing[1],
    },
  });
}
