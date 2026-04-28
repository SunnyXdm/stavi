// WHAT: BreadcrumbBar — horizontal path navigation for the Explorer plugin.
// WHY:  Shows the current directory relative to the session folder as clickable
//       path segments. Tapping a segment navigates up to that directory.
// HOW:  Derives segments by stripping the session.folder prefix from cwd.
//       The root segment shows the session folder basename (or session title).
//       Renders as a horizontal ScrollView that auto-scrolls to the rightmost
//       (deepest) segment on mount. Uses only tokens from theme/tokens.ts.
// SEE:  apps/mobile/src/plugins/shared/explorer/index.tsx (host),
//       apps/mobile/src/plugins/shared/explorer/store.ts (cwd source)

import React, { memo, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
} from 'react-native';
import { FolderOpen, ChevronRight } from 'lucide-react-native';
import { useTheme } from '../../../../theme';
import { typography, spacing } from '../../../../theme';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

interface BreadcrumbBarProps {
  cwd: string;
  sessionFolder: string;
  sessionTitle: string;
  onNavigate: (path: string) => void;
}

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

function buildSegments(
  cwd: string,
  sessionFolder: string,
  sessionTitle: string,
): Array<{ label: string; path: string }> {
  const segments: Array<{ label: string; path: string }> = [
    { label: sessionTitle || sessionFolder.split('/').pop() || 'root', path: sessionFolder },
  ];

  if (cwd === sessionFolder || !cwd.startsWith(sessionFolder)) {
    return segments;
  }

  const relative = cwd.slice(sessionFolder.length).replace(/^\//, '');
  const parts = relative.split('/').filter(Boolean);

  let accumulated = sessionFolder;
  for (const part of parts) {
    accumulated = `${accumulated}/${part}`;
    segments.push({ label: part, path: accumulated });
  }

  return segments;
}

// ----------------------------------------------------------
// Component
// ----------------------------------------------------------

export const BreadcrumbBar = memo(function BreadcrumbBar({
  cwd,
  sessionFolder,
  sessionTitle,
  onNavigate,
}: BreadcrumbBarProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    wrapper: {
      backgroundColor: colors.bg.raised,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    scroll: {
      flexGrow: 0,
    },
    content: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      gap: spacing[1],
      minHeight: 36,
    },
    segment: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing[1],
    },
    segLabel: {
      fontSize: typography.fontSize.sm,
      color: colors.fg.secondary,
      fontFamily: typography.fontFamily.mono,
    },
    segLabelActive: {
      color: colors.fg.primary,
      fontFamily: typography.fontFamily.monoMedium,
    },
    segLabelRoot: {
      color: colors.accent.primary,
      fontFamily: typography.fontFamily.monoMedium,
    },
  }), [colors]);

  const scrollRef = useRef<ScrollView>(null);
  const segments = buildSegments(cwd, sessionFolder, sessionTitle);

  // Scroll to end whenever cwd changes (i.e. navigate deeper)
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [cwd]);

  return (
    <View style={styles.wrapper}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.content}
      >
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1;
          return (
            <View key={seg.path} style={styles.segment}>
              {i === 0 ? (
                <FolderOpen size={14} color={colors.accent.primary} />
              ) : (
                <ChevronRight size={12} color={colors.fg.muted} />
              )}
              <Pressable
                onPress={() => onNavigate(seg.path)}
                hitSlop={6}
                disabled={isLast}
              >
                <Text
                  style={[
                    styles.segLabel,
                    isLast && styles.segLabelActive,
                    i === 0 && styles.segLabelRoot,
                  ]}
                  numberOfLines={1}
                >
                  {seg.label}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
});

// Styles computed dynamically via useMemo — see component body.
