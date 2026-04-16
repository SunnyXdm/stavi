// ============================================================
// WorkspaceSidebarChats — expanded chat list for WorkspaceSidebar
// ============================================================
// Split from WorkspaceSidebar.tsx (Phase 8e) to stay under 400 lines.
// Shows the list of AI chats for the current workspace + New Chat button.

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { PenLine } from 'lucide-react-native';
import { colors, typography, spacing } from '../theme';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

export interface SidebarChatEntry {
  id: string;
  title: string;
  subtitle?: string;
}

interface WorkspaceSidebarChatsProps {
  chats: SidebarChatEntry[];
  activeChatId: string | null;
  onChatPress: (id: string) => void;
  onNewChat: () => void;
}

// ----------------------------------------------------------
// Component
// ----------------------------------------------------------

export function WorkspaceSidebarChats({
  chats,
  activeChatId,
  onChatPress,
  onNewChat,
}: WorkspaceSidebarChatsProps) {
  return (
    <View style={styles.section}>
      {/* Section header */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>Chats</Text>
        <Pressable
          style={styles.newChatBtn}
          onPress={onNewChat}
          accessibilityLabel="New Chat"
          accessibilityRole="button"
          hitSlop={8}
        >
          <PenLine size={14} color={colors.accent.primary} />
        </Pressable>
      </View>

      {/* Chat list */}
      <ScrollView
        style={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
      >
        {chats.length === 0 ? (
          <Text style={styles.emptyText}>No chats yet</Text>
        ) : (
          chats.map((chat) => {
            const isActive = chat.id === activeChatId;
            return (
              <Pressable
                key={chat.id}
                style={[styles.chatItem, isActive && styles.chatItemActive]}
                onPress={() => onChatPress(chat.id)}
                accessibilityRole="button"
              >
                {isActive && <View style={styles.activeBar} />}
                <Text
                  style={[styles.chatTitle, isActive && styles.chatTitleActive]}
                  numberOfLines={1}
                >
                  {chat.title}
                </Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  section: {
    flex: 1,
    minHeight: 0,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing[3] + 2,
    paddingRight: spacing[3],
    paddingVertical: spacing[2],
  },
  sectionLabel: {
    flex: 1,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.muted,
    textTransform: 'uppercase',
    letterSpacing: typography.letterSpacing.wide,
  },
  newChatBtn: {
    padding: spacing[1],
  },
  list: {
    flex: 1,
  },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    paddingRight: spacing[3],
  },
  chatItemActive: {
    backgroundColor: colors.bg.active,
  },
  activeBar: {
    width: 3,
    alignSelf: 'stretch',
    backgroundColor: colors.accent.primary,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
    marginRight: spacing[2] + 2,
  },
  chatTitle: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.fg.secondary,
    fontFamily: typography.fontFamily.sans,
    paddingVertical: spacing[2],
    paddingLeft: spacing[3] + 2,
  },
  chatTitleActive: {
    color: colors.fg.primary,
    fontWeight: typography.fontWeight.medium,
    paddingLeft: 0,
  },
  emptyText: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
    paddingLeft: spacing[3] + 2,
    paddingTop: spacing[2],
  },
});
