// ============================================================
// Core Plugin: Git — Full version control
// ============================================================
// Three-tab layout: Changes / History / Branches
// State and RPC calls live in hooks/useGit.ts
// CommitSheet component lives in components/CommitSheet.tsx

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  RefreshControl, ActivityIndicator, ScrollView,
} from 'react-native';
import {
  GitBranch, GitCommit, ArrowUpDown, FileEdit, FilePlus,
  FileMinus, FileQuestion, FileCheck, RefreshCw, Plus, Minus,
  Undo2, ArrowUp, ArrowDown, History, Layers,
} from 'lucide-react-native';
import type {
  WorkspacePluginDefinition,
  WorkspacePluginPanelProps,
} from '@stavi/shared';
import type { GitPluginAPI } from '@stavi/shared';
import { colors, typography, spacing, radii } from '../../../theme';
import { textStyles } from '../../../theme/styles';
import { useConnectionStore } from '../../../stores/connection';
import { useGit, type TabId, type GitFile } from './hooks/useGit';
import { CommitSheet } from './components/CommitSheet';

// ----------------------------------------------------------
// Small pure UI helpers (too small to extract to their own files)
// ----------------------------------------------------------

function FileActionButton({
  icon: Icon, color, onPress, disabled,
}: {
  icon: typeof Plus; color: string; onPress: () => void; disabled?: boolean;
}) {
  return (
    <Pressable
      style={[actionStyles.btn, disabled && { opacity: 0.4 }]}
      onPress={onPress} disabled={disabled} hitSlop={6}
    >
      <Icon size={14} color={color} />
    </Pressable>
  );
}
const actionStyles = StyleSheet.create({
  btn: { width: 28, height: 28, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg.input },
});

function SectionHeader({ label, count, color: headerColor, actions }: {
  label: string; count: number; color: string; actions?: React.ReactNode;
}) {
  return (
    <View style={sectionStyles.header}>
      <View style={sectionStyles.left}>
        <View style={[sectionStyles.dot, { backgroundColor: headerColor }]} />
        <Text style={[sectionStyles.label, { color: headerColor }]}>{label}</Text>
        <Text style={sectionStyles.count}>{count}</Text>
      </View>
      <View style={sectionStyles.actions}>{actions}</View>
    </View>
  );
}
const sectionStyles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[4], paddingVertical: spacing[2], paddingTop: spacing[3] },
  left: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.semibold, letterSpacing: 0.5 },
  count: { fontSize: typography.fontSize.xs, color: colors.fg.muted, fontFamily: typography.fontFamily.mono },
  actions: { flexDirection: 'row', gap: spacing[1] },
});

function getFileStatusIcon(status: string) {
  switch (status) {
    case 'added': return FilePlus;
    case 'modified': return FileEdit;
    case 'deleted': return FileMinus;
    case 'untracked': return FileQuestion;
    default: return FileEdit;
  }
}
function getFileStatusColor(status: string, staged: boolean) {
  if (staged) return colors.semantic.success;
  switch (status) {
    case 'added': return colors.semantic.success;
    case 'modified': return colors.semantic.warning;
    case 'deleted': return colors.semantic.error;
    case 'untracked': return colors.fg.muted;
    default: return colors.fg.tertiary;
  }
}
function formatRelativeDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch { return dateStr; }
}

// ----------------------------------------------------------
// Tab config
// ----------------------------------------------------------

const TABS: Array<{ id: TabId; label: string; icon: typeof Layers }> = [
  { id: 'changes', label: 'Changes', icon: Layers },
  { id: 'history', label: 'History', icon: History },
  { id: 'branches', label: 'Branches', icon: GitBranch },
];

// ----------------------------------------------------------
// Panel
// ----------------------------------------------------------

function GitPanel({ session }: WorkspacePluginPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('changes');
  const git = useGit(activeTab, session.serverId);
  const { status, stagedFiles, unstagedFiles, untrackedFiles } = git;

  if (git.connectionState !== 'connected') {
    return (
      <View style={styles.empty}>
        <GitBranch size={32} color={colors.fg.muted} />
        <Text style={[textStyles.body, { color: colors.fg.muted, textAlign: 'center' }]}>
          Connect to a server to view git status
        </Text>
      </View>
    );
  }
  if (status.loading) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator size="small" color={colors.accent.primary} />
        <Text style={[textStyles.bodySmall, { color: colors.fg.tertiary }]}>Loading git status...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Branch header */}
      <View style={styles.branchHeader}>
        <View style={styles.branchInfo}>
          <GitBranch size={16} color={colors.accent.primary} />
          <Text style={styles.branchName}>{status.branch || 'detached'}</Text>
          {(status.ahead > 0 || status.behind > 0) && (
            <View style={styles.aheadBehind}>
              <ArrowUpDown size={12} color={colors.fg.tertiary} />
              <Text style={styles.aheadBehindText}>
                {status.ahead > 0 ? `↑${status.ahead}` : ''}{status.behind > 0 ? ` ↓${status.behind}` : ''}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.headerActions}>
          <Pressable style={styles.smallButton} onPress={git.pull} disabled={git.actionLoading === 'pull'}>
            <ArrowDown size={14} color={colors.fg.tertiary} />
          </Pressable>
          <Pressable style={styles.smallButton} onPress={git.push} disabled={git.actionLoading === 'push'}>
            <ArrowUp size={14} color={colors.fg.tertiary} />
          </Pressable>
          <Pressable style={styles.smallButton} onPress={git.refresh}>
            <RefreshCw size={14} color={colors.fg.tertiary} />
          </Pressable>
        </View>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <Pressable key={tab.id} style={[styles.tab, active && styles.tabActive]} onPress={() => setActiveTab(tab.id)}>
              <tab.icon size={14} color={active ? colors.accent.primary : colors.fg.muted} />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Changes tab */}
      {activeTab === 'changes' && (
        <>
          <FlatList
            data={[
              ...(stagedFiles.length > 0 ? [{ type: 'header' as const, section: 'staged', label: 'Staged', count: stagedFiles.length }] : []),
              ...stagedFiles.map((f) => ({ type: 'file' as const, section: 'staged', file: f })),
              ...(unstagedFiles.length > 0 ? [{ type: 'header' as const, section: 'unstaged', label: 'Changes', count: unstagedFiles.length }] : []),
              ...unstagedFiles.map((f) => ({ type: 'file' as const, section: 'unstaged', file: f })),
              ...(untrackedFiles.length > 0 ? [{ type: 'header' as const, section: 'untracked', label: 'Untracked', count: untrackedFiles.length }] : []),
              ...untrackedFiles.map((f) => ({ type: 'file' as const, section: 'untracked', file: f })),
            ]}
            renderItem={({ item }) => {
              if (item.type === 'header') {
                const headerColor = item.section === 'staged' ? colors.semantic.success
                  : item.section === 'unstaged' ? colors.semantic.warning : colors.fg.muted;
                return (
                  <SectionHeader label={item.label!} count={item.count!} color={headerColor}
                    actions={
                      item.section === 'staged' ? (
                        <Pressable style={styles.sectionAction} onPress={() => git.unstage(stagedFiles.map((f) => f.path))}>
                          <Text style={styles.sectionActionText}>Unstage all</Text>
                        </Pressable>
                      ) : (
                        <Pressable style={styles.sectionAction} onPress={() => git.stage((item.section === 'unstaged' ? unstagedFiles : untrackedFiles).map((f) => f.path))}>
                          <Text style={styles.sectionActionText}>Stage all</Text>
                        </Pressable>
                      )
                    }
                  />
                );
              }
              const file = item.file!;
              const Icon = getFileStatusIcon(file.status);
              return (
                <View style={styles.fileRow}>
                  <Icon size={14} color={getFileStatusColor(file.status, file.staged)} />
                  <Text style={styles.filePath} numberOfLines={1}>{file.path}</Text>
                  {git.actionLoading === file.path ? (
                    <ActivityIndicator size="small" color={colors.accent.primary} />
                  ) : (
                    <View style={styles.fileActions}>
                      {file.staged ? (
                        <FileActionButton icon={Minus} color={colors.semantic.error} onPress={() => git.unstage([file.path])} />
                      ) : (
                        <>
                          <FileActionButton icon={Plus} color={colors.semantic.success} onPress={() => git.stage([file.path])} />
                          {file.status !== 'untracked' && (
                            <FileActionButton icon={Undo2} color={colors.semantic.error} onPress={() => git.discard([file.path])} />
                          )}
                        </>
                      )}
                    </View>
                  )}
                </View>
              );
            }}
            keyExtractor={(item, idx) => item.type === 'header' ? `header-${item.section}` : `file-${item.file!.path}-${idx}`}
            refreshControl={<RefreshControl refreshing={git.refreshing} onRefresh={git.refresh} tintColor={colors.accent.primary} />}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyList}>
                <FileCheck size={24} color={colors.semantic.success} />
                <Text style={styles.emptyListText}>Working tree clean</Text>
              </View>
            }
          />
          {stagedFiles.length > 0 && (
            <View style={styles.commitBar}>
              <Pressable style={styles.commitBarButton} onPress={() => git.setCommitSheetVisible(true)}>
                <GitCommit size={16} color={colors.fg.onAccent} />
                <Text style={styles.commitBarText}>Commit {stagedFiles.length} file{stagedFiles.length !== 1 ? 's' : ''}</Text>
              </Pressable>
            </View>
          )}
          <CommitSheet
            visible={git.commitSheetVisible}
            onClose={() => git.setCommitSheetVisible(false)}
            branch={status.branch}
            stagedFiles={stagedFiles}
            onCommit={git.commit}
          />
        </>
      )}

      {/* History tab */}
      {activeTab === 'history' && (
        <FlatList
          data={git.commits}
          renderItem={({ item }) => (
            <View style={styles.commitRow}>
              <View style={styles.commitDot} />
              <View style={styles.commitInfo}>
                <Text style={styles.commitMessage} numberOfLines={2}>{item.message}</Text>
                <View style={styles.commitMeta}>
                  <Text style={styles.commitHash}>{item.hash?.slice(0, 7)}</Text>
                  <Text style={styles.commitAuthor}>{item.author}</Text>
                  <Text style={styles.commitDate}>{formatRelativeDate(item.date)}</Text>
                </View>
              </View>
            </View>
          )}
          keyExtractor={(item) => item.hash}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyList}>
              <History size={24} color={colors.fg.muted} />
              <Text style={styles.emptyListText}>No commits</Text>
            </View>
          }
        />
      )}

      {/* Branches tab */}
      {activeTab === 'branches' && (
        <FlatList
          data={git.branches}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.branchRow, item.current && styles.branchRowActive]}
              onPress={() => !item.current && git.checkout(item.name)}
              disabled={item.current}
            >
              <GitBranch size={14} color={item.current ? colors.accent.primary : colors.fg.muted} />
              <Text style={[styles.branchRowName, item.current && styles.branchRowNameActive]} numberOfLines={1}>
                {item.name}
              </Text>
              {item.current && (
                <View style={styles.currentBadge}>
                  <Text style={styles.currentBadgeText}>current</Text>
                </View>
              )}
              <Text style={styles.branchHash}>{item.hash?.slice(0, 7)}</Text>
            </Pressable>
          )}
          keyExtractor={(item) => item.name}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyList}>
              <GitBranch size={24} color={colors.fg.muted} />
              <Text style={styles.emptyListText}>No branches</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

// ----------------------------------------------------------
// Plugin API + definition
// ----------------------------------------------------------

function gitApi(): GitPluginAPI {
  const getFallbackClient = () => {
    const firstServerId = useConnectionStore.getState().savedConnections[0]?.id;
    return firstServerId
      ? useConnectionStore.getState().getClientForServer(firstServerId)
      : undefined;
  };

  return {
    getStatus: async () => {
      const result = await getFallbackClient()?.request<any>('git.status', {});
      return { branch: result.branch, staged: result.staged, unstaged: result.unstaged, untracked: result.untracked };
    },
    stage: async (paths) => { await getFallbackClient()?.request('git.stage', { paths }); },
    commit: async (message) => {
      const result = await getFallbackClient()?.request<any>('git.commit', { message });
      return { hash: result.output ?? '' };
    },
    diff: async (path) => {
      const result = await getFallbackClient()?.request<any>('git.diffFile', { path });
      return result.diff ?? '';
    },
  };
}

export const gitPlugin: WorkspacePluginDefinition = {
  id: 'git', name: 'Git', description: 'Version control — stage, commit, push, branch',
  scope: 'workspace', kind: 'core', icon: GitBranch, component: GitPanel, navOrder: 3, api: gitApi,
};

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.base },
  empty: { flex: 1, backgroundColor: colors.bg.base, alignItems: 'center', justifyContent: 'center', gap: spacing[3], padding: spacing[6] },
  branchHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: colors.bg.raised },
  branchInfo: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flex: 1 },
  branchName: { fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.semibold, color: colors.fg.primary, fontFamily: typography.fontFamily.mono },
  aheadBehind: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  aheadBehindText: { fontSize: typography.fontSize.xs, color: colors.fg.tertiary, fontFamily: typography.fontFamily.mono },
  headerActions: { flexDirection: 'row', gap: spacing[1] },
  smallButton: { width: 32, height: 32, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  tabBar: { flexDirection: 'row', backgroundColor: colors.bg.raised, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[1], paddingVertical: spacing[2] },
  tabActive: { borderBottomWidth: 2, borderBottomColor: colors.accent.primary },
  tabText: { fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.medium, color: colors.fg.muted },
  tabTextActive: { color: colors.accent.primary },
  listContent: { paddingBottom: spacing[4] },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
  filePath: { flex: 1, fontSize: typography.fontSize.sm, color: colors.fg.secondary, fontFamily: typography.fontFamily.mono },
  fileActions: { flexDirection: 'row', gap: spacing[1] },
  sectionAction: { paddingHorizontal: spacing[2], paddingVertical: 2 },
  sectionActionText: { fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.medium, color: colors.accent.primary },
  emptyList: { alignItems: 'center', justifyContent: 'center', paddingTop: spacing[16], gap: spacing[2] },
  emptyListText: { fontSize: typography.fontSize.sm, color: colors.fg.tertiary },
  commitBar: { paddingHorizontal: spacing[4], paddingVertical: spacing[2], backgroundColor: colors.bg.raised, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  commitBarButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], backgroundColor: colors.accent.primary, borderRadius: radii.md, paddingVertical: spacing[3] },
  commitBarText: { fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.semibold, color: colors.fg.onAccent },
  commitRow: { flexDirection: 'row', paddingHorizontal: spacing[4], paddingVertical: spacing[2], gap: spacing[3] },
  commitDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent.primary, marginTop: 6 },
  commitInfo: { flex: 1, gap: 2 },
  commitMessage: { fontSize: typography.fontSize.sm, color: colors.fg.primary, fontWeight: typography.fontWeight.medium },
  commitMeta: { flexDirection: 'row', gap: spacing[2] },
  commitHash: { fontSize: typography.fontSize.xs, fontFamily: typography.fontFamily.mono, color: colors.accent.primary },
  commitAuthor: { fontSize: typography.fontSize.xs, color: colors.fg.tertiary },
  commitDate: { fontSize: typography.fontSize.xs, color: colors.fg.muted },
  branchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  branchRowActive: { backgroundColor: colors.accent.subtle },
  branchRowName: { flex: 1, fontSize: typography.fontSize.sm, fontFamily: typography.fontFamily.mono, color: colors.fg.secondary },
  branchRowNameActive: { color: colors.accent.primary, fontWeight: typography.fontWeight.medium },
  currentBadge: { backgroundColor: colors.accent.subtle, paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: radii.sm },
  currentBadgeText: { fontSize: typography.fontSize.xs, color: colors.accent.primary, fontWeight: typography.fontWeight.medium },
  branchHash: { fontSize: typography.fontSize.xs, fontFamily: typography.fontFamily.mono, color: colors.fg.muted },
});
