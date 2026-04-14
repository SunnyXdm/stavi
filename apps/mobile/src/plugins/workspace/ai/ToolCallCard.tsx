// ============================================================
// ToolCallCard — Collapsible tool call display
// ============================================================
// Shows tool invocations (file reads, edits, commands) as
// collapsible cards with icon + label + optional preview.

import React, { memo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import {
  FileText,
  Terminal,
  Wrench,
  ChevronDown,
  ChevronRight,
  Pencil,
  Search,
  FolderOpen,
} from 'lucide-react-native';
import { colors, typography, spacing, radii } from '../../../theme';
import type { ThreadActivity } from './useOrchestration';

interface ToolCallCardProps {
  activities: ThreadActivity[];
}

// Map tool names to icons
function getToolIcon(type: string) {
  if (type.includes('read') || type.includes('file')) return FileText;
  if (type.includes('edit') || type.includes('write')) return Pencil;
  if (type.includes('terminal') || type.includes('bash') || type.includes('command')) return Terminal;
  if (type.includes('search') || type.includes('grep')) return Search;
  if (type.includes('list') || type.includes('directory')) return FolderOpen;
  return Wrench;
}

function getToolLabel(activity: ThreadActivity): string {
  const type = activity.type;
  const data = activity.data as Record<string, any>;

  if (data.toolName) return data.toolName;
  if (data.name) return data.name;

  // Derive from type
  if (type.includes('tool-use')) return 'Tool Call';
  return type.replace(/^thread\.activity\./, '').replace(/[-_]/g, ' ');
}

function getToolDetail(activity: ThreadActivity): string | null {
  const data = activity.data as Record<string, any>;
  if (data.filePath) return data.filePath;
  if (data.command) return data.command;
  if (data.query) return data.query;
  if (data.input?.file_path) return data.input.file_path;
  if (data.input?.command) return data.input.command;
  return null;
}

export const ToolCallCard = memo(function ToolCallCard({ activities }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  if (activities.length === 0) return null;

  const Icon = expanded ? ChevronDown : ChevronRight;

  return (
    <View style={styles.container}>
      <Pressable style={styles.header} onPress={toggle}>
        <Icon size={16} color={colors.fg.tertiary} />
        <Text style={styles.headerText}>
          Tool Calls ({activities.length})
        </Text>
      </Pressable>

      {expanded && (
        <View style={styles.list}>
          {activities.map((activity, idx) => {
            const ToolIcon = getToolIcon(activity.type);
            const label = getToolLabel(activity);
            const detail = getToolDetail(activity);

            return (
              <View key={idx} style={styles.item}>
                <ToolIcon size={14} color={colors.fg.muted} />
                <View style={styles.itemText}>
                  <Text style={styles.itemLabel} numberOfLines={1}>
                    {label}
                  </Text>
                  {detail && (
                    <Text style={styles.itemDetail} numberOfLines={1}>
                      {detail}
                    </Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing[4],
    marginVertical: spacing[1],
    backgroundColor: colors.bg.raised,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  headerText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.tertiary,
  },
  list: {
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[2],
    gap: spacing[1],
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[1],
  },
  itemText: {
    flex: 1,
  },
  itemLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.secondary,
    fontFamily: typography.fontFamily.mono,
  },
  itemDetail: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
    fontFamily: typography.fontFamily.mono,
    marginTop: 1,
  },
});
