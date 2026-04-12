// ============================================================
// Core Plugin: Git — Full version control
// ============================================================
// Three-tab layout: Changes / History / Branches
// Changes: staged/unstaged/untracked with stage/unstage/discard
// History: commit log with hash/message/author/time
// Branches: list with checkout, create new
// CommitSheet: bottom sheet for commit flow

import React, { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
  Modal,
  Alert,
} from 'react-native';
import {
  GitBranch,
  GitCommit,
  ArrowUpDown,
  FileEdit,
  FilePlus,
  FileMinus,
  FileQuestion,
  FileCheck,
  RefreshCw,
  Plus,
  Minus,
  Undo2,
  ArrowUp,
  ArrowDown,
  X,
  Check,
  History,
  Layers,
} from 'lucide-react-native';
import type { PluginDefinition, PluginPanelProps } from '@stavi/shared';
import type { GitPluginAPI } from '@stavi/shared';
import { colors, typography, spacing, radii } from '../../../theme';
import { textStyles } from '../../../theme/styles';
import { useConnectionStore } from '../../../stores/connection';
import { staviClient } from '../../../stores/stavi-client';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

interface GitFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'unknown';
  staged: boolean;
}

interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  files: GitFile[];
  loading: boolean;
}

interface Commit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

interface Branch {
  name: string;
  hash: string;
  upstream: string | null;
  current: boolean;
}

type TabId = 'changes' | 'history' | 'branches';

// ----------------------------------------------------------
// File action button
// ----------------------------------------------------------

function FileActionButton({
  icon: Icon,
  color,
  onPress,
  disabled,
}: {
  icon: typeof Plus;
  color: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={[actionStyles.btn, disabled && { opacity: 0.4 }]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
    >
      <Icon size={14} color={color} />
    </Pressable>
  );
}

const actionStyles = StyleSheet.create({
  btn: {
    width: 28,
    height: 28,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.input,
  },
});

// ----------------------------------------------------------
// Section header
// ----------------------------------------------------------

function SectionHeader({
  label,
  count,
  color: headerColor,
  actions,
}: {
  label: string;
  count: number;
  color: string;
  actions?: React.ReactNode;
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    paddingTop: spacing[3],
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    letterSpacing: 0.5,
  },
  count: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
    fontFamily: typography.fontFamily.mono,
  },
  actions: { flexDirection: 'row', gap: spacing[1] },
});

// ----------------------------------------------------------
// CommitSheet — Bottom sheet for committing
// ----------------------------------------------------------

const CommitSheet = memo(function CommitSheet({
  visible,
  onClose,
  branch,
  stagedFiles,
  onCommit,
}: {
  visible: boolean;
  onClose: () => void;
  branch: string;
  stagedFiles: GitFile[];
  onCommit: (message: string) => Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const [committing, setCommitting] = useState(false);

  const isMainBranch = ['main', 'master'].includes(branch);

  const handleCommit = useCallback(async () => {
    if (!message.trim()) return;
    setCommitting(true);
    try {
      await onCommit(message.trim());
      setMessage('');
      onClose();
    } catch (err) {
      Alert.alert('Commit failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setCommitting(false);
    }
  }, [message, onCommit, onClose]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={commitStyles.backdrop}>
        <Pressable style={commitStyles.backdropPress} onPress={onClose} />
        <View style={commitStyles.sheet}>
          {/* Header */}
          <View style={commitStyles.header}>
            <View style={commitStyles.headerLeft}>
              <GitCommit size={18} color={colors.accent.primary} />
              <Text style={commitStyles.headerTitle}>Commit</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={20} color={colors.fg.muted} />
            </Pressable>
          </View>

          <ScrollView style={commitStyles.content} bounces={false}>
            {/* Branch */}
            <View style={commitStyles.branchRow}>
              <GitBranch size={14} color={colors.fg.tertiary} />
              <Text style={commitStyles.branchText}>{branch || 'detached'}</Text>
              {isMainBranch && (
                <View style={commitStyles.warningBadge}>
                  <Text style={commitStyles.warningText}>default branch</Text>
                </View>
              )}
            </View>

            {/* Files */}
            <Text style={commitStyles.filesLabel}>
              {stagedFiles.length} staged file{stagedFiles.length !== 1 ? 's' : ''}
            </Text>
            {stagedFiles.slice(0, 10).map((f) => (
              <View key={f.path} style={commitStyles.fileRow}>
                <View style={[commitStyles.statusBadge, { backgroundColor: getStatusBgColor(f.status) }]}>
                  <Text style={commitStyles.statusBadgeText}>{f.status[0].toUpperCase()}</Text>
                </View>
                <Text style={commitStyles.filePath} numberOfLines={1}>{f.path}</Text>
              </View>
            ))}
            {stagedFiles.length > 10 && (
              <Text style={commitStyles.moreText}>+{stagedFiles.length - 10} more files</Text>
            )}

            {/* Message input */}
            <TextInput
              style={commitStyles.messageInput}
              value={message}
              onChangeText={setMessage}
              placeholder="Commit message..."
              placeholderTextColor={colors.fg.muted}
              multiline
              autoFocus
            />

            {/* Commit button */}
            <Pressable
              style={[commitStyles.commitButton, (!message.trim() || committing) && commitStyles.commitButtonDisabled]}
              onPress={handleCommit}
              disabled={!message.trim() || committing}
            >
              {committing ? (
                <ActivityIndicator size="small" color={colors.fg.onAccent} />
              ) : (
                <>
                  <Check size={16} color={colors.fg.onAccent} />
                  <Text style={commitStyles.commitButtonText}>Commit</Text>
                </>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
});

const commitStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  backdropPress: { flex: 1 },
  sheet: { backgroundColor: colors.bg.base, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, maxHeight: '75%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[4], paddingVertical: spacing[3], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  headerTitle: { fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.semibold, color: colors.fg.primary },
  content: { paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[8] },
  branchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] },
  branchText: { fontSize: typography.fontSize.sm, fontFamily: typography.fontFamily.mono, color: colors.fg.secondary },
  warningBadge: { backgroundColor: colors.semantic.warningSubtle, paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: radii.sm },
  warningText: { fontSize: typography.fontSize.xs, color: colors.semantic.warning, fontWeight: typography.fontWeight.medium },
  filesLabel: { fontSize: typography.fontSize.xs, color: colors.fg.muted, marginBottom: spacing[2] },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: 3 },
  statusBadge: { width: 18, height: 18, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  statusBadgeText: { fontSize: 10, fontWeight: typography.fontWeight.bold, color: colors.fg.onAccent },
  filePath: { flex: 1, fontSize: typography.fontSize.sm, fontFamily: typography.fontFamily.mono, color: colors.fg.secondary },
  moreText: { fontSize: typography.fontSize.xs, color: colors.fg.muted, paddingVertical: spacing[1] },
  messageInput: { backgroundColor: colors.bg.input, borderRadius: radii.md, paddingHorizontal: spacing[4], paddingVertical: spacing[3], fontSize: typography.fontSize.base, color: colors.fg.primary, marginTop: spacing[4], minHeight: 80, maxHeight: 160, textAlignVertical: 'top' },
  commitButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], backgroundColor: colors.accent.primary, borderRadius: radii.md, paddingVertical: spacing[3], marginTop: spacing[3] },
  commitButtonDisabled: { opacity: 0.5 },
  commitButtonText: { fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.semibold, color: colors.fg.onAccent },
});

function getStatusBgColor(status: string) {
  switch (status) {
    case 'added': return colors.semantic.success;
    case 'modified': return colors.semantic.warning;
    case 'deleted': return colors.semantic.error;
    default: return colors.fg.muted;
  }
}

// ----------------------------------------------------------
// Tab bar
// ----------------------------------------------------------

const TABS: Array<{ id: TabId; label: string; icon: typeof Layers }> = [
  { id: 'changes', label: 'Changes', icon: Layers },
  { id: 'history', label: 'History', icon: History },
  { id: 'branches', label: 'Branches', icon: GitBranch },
];

// ----------------------------------------------------------
// Panel Component
// ----------------------------------------------------------

function GitPanel({ instanceId, isActive, bottomBarHeight }: PluginPanelProps) {
  const connectionState = useConnectionStore((s) => s.state);
  const [activeTab, setActiveTab] = useState<TabId>('changes');
  const [status, setStatus] = useState<GitStatus>({ branch: '', ahead: 0, behind: 0, files: [], loading: true });
  const [refreshing, setRefreshing] = useState(false);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [commitSheetVisible, setCommitSheetVisible] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  // Subscribe to git status
  useEffect(() => {
    if (connectionState !== 'connected') return;
    setStatus((prev) => ({ ...prev, loading: true }));

    unsubRef.current = staviClient.subscribe(
      'subscribeGitStatus',
      {},
      (event: any) => {
        const files: GitFile[] = [];
        if (event.staged) {
          for (const file of event.staged) {
            files.push({ path: file.path || file, status: file.status || 'modified', staged: true });
          }
        }
        if (event.unstaged) {
          for (const file of event.unstaged) {
            files.push({ path: file.path || file, status: file.status || 'modified', staged: false });
          }
        }
        if (event.untracked) {
          for (const file of event.untracked) {
            files.push({ path: typeof file === 'string' ? file : file.path, status: 'untracked', staged: false });
          }
        }
        setStatus({ branch: event.branch || '', ahead: event.ahead || 0, behind: event.behind || 0, files, loading: false });
      },
      (error) => {
        console.error('[Git] Subscription error:', error);
        setStatus((prev) => ({ ...prev, loading: false }));
      },
    );

    return () => { unsubRef.current?.(); unsubRef.current = null; };
  }, [connectionState]);

  // Load history/branches when tab changes
  useEffect(() => {
    if (connectionState !== 'connected') return;
    if (activeTab === 'history') {
      staviClient.request<{ commits: Commit[] }>('git.log', { limit: 50 }).then((r) => setCommits(r.commits || [])).catch(() => {});
    }
    if (activeTab === 'branches') {
      staviClient.request<{ branches: Branch[] }>('git.branches', {}).then((r) => setBranches(r.branches || [])).catch(() => {});
    }
  }, [activeTab, connectionState]);

  // Actions
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await staviClient.request('git.refreshStatus', {}); } catch {}
    setRefreshing(false);
  }, []);

  const handleStage = useCallback(async (paths: string[]) => {
    setActionLoading(paths[0]);
    try { await staviClient.request('git.stage', { paths }); } catch (err) { console.error('[Git] Stage error:', err); }
    setActionLoading(null);
  }, []);

  const handleUnstage = useCallback(async (paths: string[]) => {
    setActionLoading(paths[0]);
    try { await staviClient.request('git.unstage', { paths }); } catch (err) { console.error('[Git] Unstage error:', err); }
    setActionLoading(null);
  }, []);

  const handleDiscard = useCallback(async (paths: string[]) => {
    Alert.alert('Discard Changes', `Discard changes to ${paths.length} file(s)?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          setActionLoading(paths[0]);
          try { await staviClient.request('git.discard', { paths }); } catch (err) { console.error('[Git] Discard error:', err); }
          setActionLoading(null);
        },
      },
    ]);
  }, []);

  const handleCommit = useCallback(async (message: string) => {
    await staviClient.request('git.commit', { message });
  }, []);

  const handleCheckout = useCallback(async (branch: string) => {
    try {
      await staviClient.request('git.checkout', { branch });
      // Refresh branches
      const r = await staviClient.request<{ branches: Branch[] }>('git.branches', {});
      setBranches(r.branches || []);
    } catch (err) {
      Alert.alert('Checkout failed', err instanceof Error ? err.message : 'Unknown error');
    }
  }, []);

  const handlePush = useCallback(async () => {
    setActionLoading('push');
    try {
      await staviClient.request('git.push', {});
    } catch (err) {
      Alert.alert('Push failed', err instanceof Error ? err.message : 'Unknown error');
    }
    setActionLoading(null);
  }, []);

  const handlePull = useCallback(async () => {
    setActionLoading('pull');
    try {
      await staviClient.request('git.pull', { rebase: true });
    } catch (err) {
      Alert.alert('Pull failed', err instanceof Error ? err.message : 'Unknown error');
    }
    setActionLoading(null);
  }, []);

  // Derived
  const stagedFiles = useMemo(() => status.files.filter((f) => f.staged), [status.files]);
  const unstagedFiles = useMemo(() => status.files.filter((f) => !f.staged && f.status !== 'untracked'), [status.files]);
  const untrackedFiles = useMemo(() => status.files.filter((f) => f.status === 'untracked'), [status.files]);

  // Not connected
  if (connectionState !== 'connected') {
    return (
      <View style={styles.empty}>
        <GitBranch size={32} color={colors.fg.muted} />
        <Text style={[textStyles.body, { color: colors.fg.muted, textAlign: 'center' }]}>
          Connect to a server to view git status
        </Text>
      </View>
    );
  }

  // Loading
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
                {status.ahead > 0 ? `↑${status.ahead}` : ''}
                {status.behind > 0 ? ` ↓${status.behind}` : ''}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.headerActions}>
          <Pressable style={styles.smallButton} onPress={handlePull} disabled={actionLoading === 'pull'}>
            <ArrowDown size={14} color={colors.fg.tertiary} />
          </Pressable>
          <Pressable style={styles.smallButton} onPress={handlePush} disabled={actionLoading === 'push'}>
            <ArrowUp size={14} color={colors.fg.tertiary} />
          </Pressable>
          <Pressable style={styles.smallButton} onPress={handleRefresh}>
            <RefreshCw size={14} color={colors.fg.tertiary} />
          </Pressable>
        </View>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setActiveTab(tab.id)}
            >
              <tab.icon size={14} color={active ? colors.accent.primary : colors.fg.muted} />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Tab content */}
      {activeTab === 'changes' && (
        <>
          <FlatList
            data={[
              ...(stagedFiles.length > 0
                ? [{ type: 'header' as const, section: 'staged', label: 'Staged', count: stagedFiles.length }]
                : []),
              ...stagedFiles.map((f) => ({ type: 'file' as const, section: 'staged', file: f })),
              ...(unstagedFiles.length > 0
                ? [{ type: 'header' as const, section: 'unstaged', label: 'Changes', count: unstagedFiles.length }]
                : []),
              ...unstagedFiles.map((f) => ({ type: 'file' as const, section: 'unstaged', file: f })),
              ...(untrackedFiles.length > 0
                ? [{ type: 'header' as const, section: 'untracked', label: 'Untracked', count: untrackedFiles.length }]
                : []),
              ...untrackedFiles.map((f) => ({ type: 'file' as const, section: 'untracked', file: f })),
            ]}
            renderItem={({ item }) => {
              if (item.type === 'header') {
                const headerColor =
                  item.section === 'staged' ? colors.semantic.success
                  : item.section === 'unstaged' ? colors.semantic.warning
                  : colors.fg.muted;

                return (
                  <SectionHeader
                    label={item.label!}
                    count={item.count!}
                    color={headerColor}
                    actions={
                      item.section === 'staged' ? (
                        <Pressable
                          style={styles.sectionAction}
                          onPress={() => handleUnstage(stagedFiles.map((f) => f.path))}
                        >
                          <Text style={styles.sectionActionText}>Unstage all</Text>
                        </Pressable>
                      ) : item.section === 'unstaged' ? (
                        <View style={{ flexDirection: 'row', gap: spacing[2] }}>
                          <Pressable
                            style={styles.sectionAction}
                            onPress={() => handleStage(unstagedFiles.map((f) => f.path))}
                          >
                            <Text style={styles.sectionActionText}>Stage all</Text>
                          </Pressable>
                        </View>
                      ) : (
                        <Pressable
                          style={styles.sectionAction}
                          onPress={() => handleStage(untrackedFiles.map((f) => f.path))}
                        >
                          <Text style={styles.sectionActionText}>Stage all</Text>
                        </Pressable>
                      )
                    }
                  />
                );
              }

              const file = item.file!;
              const Icon = getFileStatusIcon(file.status);
              const iconColor = getFileStatusColor(file.status, file.staged);
              const isLoading = actionLoading === file.path;

              return (
                <View style={styles.fileRow}>
                  <Icon size={14} color={iconColor} />
                  <Text style={styles.filePath} numberOfLines={1}>{file.path}</Text>
                  {isLoading ? (
                    <ActivityIndicator size="small" color={colors.accent.primary} />
                  ) : (
                    <View style={styles.fileActions}>
                      {file.staged ? (
                        <FileActionButton
                          icon={Minus}
                          color={colors.semantic.error}
                          onPress={() => handleUnstage([file.path])}
                        />
                      ) : (
                        <>
                          <FileActionButton
                            icon={Plus}
                            color={colors.semantic.success}
                            onPress={() => handleStage([file.path])}
                          />
                          {file.status !== 'untracked' && (
                            <FileActionButton
                              icon={Undo2}
                              color={colors.semantic.error}
                              onPress={() => handleDiscard([file.path])}
                            />
                          )}
                        </>
                      )}
                    </View>
                  )}
                </View>
              );
            }}
            keyExtractor={(item, idx) =>
              item.type === 'header' ? `header-${item.section}` : `file-${item.file!.path}-${idx}`
            }
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent.primary} />
            }
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyList}>
                <FileCheck size={24} color={colors.semantic.success} />
                <Text style={styles.emptyListText}>Working tree clean</Text>
              </View>
            }
          />

          {/* Commit bar */}
          {stagedFiles.length > 0 && (
            <View style={styles.commitBar}>
              <Pressable
                style={styles.commitBarButton}
                onPress={() => setCommitSheetVisible(true)}
              >
                <GitCommit size={16} color={colors.fg.onAccent} />
                <Text style={styles.commitBarText}>
                  Commit {stagedFiles.length} file{stagedFiles.length !== 1 ? 's' : ''}
                </Text>
              </Pressable>
            </View>
          )}

          <CommitSheet
            visible={commitSheetVisible}
            onClose={() => setCommitSheetVisible(false)}
            branch={status.branch}
            stagedFiles={stagedFiles}
            onCommit={handleCommit}
          />
        </>
      )}

      {activeTab === 'history' && (
        <FlatList
          data={commits}
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

      {activeTab === 'branches' && (
        <FlatList
          data={branches}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.branchRow, item.current && styles.branchRowActive]}
              onPress={() => !item.current && handleCheckout(item.name)}
              disabled={item.current}
            >
              <GitBranch size={14} color={item.current ? colors.accent.primary : colors.fg.muted} />
              <Text
                style={[styles.branchRowName, item.current && styles.branchRowNameActive]}
                numberOfLines={1}
              >
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
// Helpers
// ----------------------------------------------------------

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
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return dateStr;
  }
}

// ----------------------------------------------------------
// Plugin API
// ----------------------------------------------------------

function gitApi(): GitPluginAPI {
  return {
    getStatus: async () => {
      const result = await staviClient.request<any>('git.status', {});
      return { branch: result.branch, staged: result.staged, unstaged: result.unstaged, untracked: result.untracked };
    },
    stage: async (paths) => {
      await staviClient.request('git.stage', { paths });
    },
    commit: async (message) => {
      const result = await staviClient.request<any>('git.commit', { message });
      return { hash: result.output ?? '' };
    },
    diff: async (path) => {
      const result = await staviClient.request<any>('git.diffFile', { path });
      return result.diff ?? '';
    },
  };
}

// ----------------------------------------------------------
// Plugin Definition
// ----------------------------------------------------------

export const gitPlugin: PluginDefinition<GitPluginAPI> = {
  id: 'git',
  name: 'Git',
  description: 'Version control — stage, commit, push, branch',
  kind: 'core',
  icon: GitBranch,
  component: GitPanel,
  navOrder: 4,
  api: gitApi,
};

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.base },
  empty: { flex: 1, backgroundColor: colors.bg.base, alignItems: 'center', justifyContent: 'center', gap: spacing[3], padding: spacing[6] },

  // Branch header
  branchHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: colors.bg.raised },
  branchInfo: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flex: 1 },
  branchName: { fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.semibold, color: colors.fg.primary, fontFamily: typography.fontFamily.mono },
  aheadBehind: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  aheadBehindText: { fontSize: typography.fontSize.xs, color: colors.fg.tertiary, fontFamily: typography.fontFamily.mono },
  headerActions: { flexDirection: 'row', gap: spacing[1] },
  smallButton: { width: 32, height: 32, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },

  // Tab bar
  tabBar: { flexDirection: 'row', backgroundColor: colors.bg.raised, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[1], paddingVertical: spacing[2] },
  tabActive: { borderBottomWidth: 2, borderBottomColor: colors.accent.primary },
  tabText: { fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.medium, color: colors.fg.muted },
  tabTextActive: { color: colors.accent.primary },

  // File list
  listContent: { paddingBottom: spacing[4] },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
  filePath: { flex: 1, fontSize: typography.fontSize.sm, color: colors.fg.secondary, fontFamily: typography.fontFamily.mono },
  fileActions: { flexDirection: 'row', gap: spacing[1] },
  sectionAction: { paddingHorizontal: spacing[2], paddingVertical: 2 },
  sectionActionText: { fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.medium, color: colors.accent.primary },
  emptyList: { alignItems: 'center', justifyContent: 'center', paddingTop: spacing[16], gap: spacing[2] },
  emptyListText: { fontSize: typography.fontSize.sm, color: colors.fg.tertiary },

  // Commit bar
  commitBar: { paddingHorizontal: spacing[4], paddingVertical: spacing[2], backgroundColor: colors.bg.raised, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  commitBarButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], backgroundColor: colors.accent.primary, borderRadius: radii.md, paddingVertical: spacing[3] },
  commitBarText: { fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.semibold, color: colors.fg.onAccent },

  // Commit rows
  commitRow: { flexDirection: 'row', paddingHorizontal: spacing[4], paddingVertical: spacing[2], gap: spacing[3] },
  commitDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent.primary, marginTop: 6 },
  commitInfo: { flex: 1, gap: 2 },
  commitMessage: { fontSize: typography.fontSize.sm, color: colors.fg.primary, fontWeight: typography.fontWeight.medium },
  commitMeta: { flexDirection: 'row', gap: spacing[2] },
  commitHash: { fontSize: typography.fontSize.xs, fontFamily: typography.fontFamily.mono, color: colors.accent.primary },
  commitAuthor: { fontSize: typography.fontSize.xs, color: colors.fg.tertiary },
  commitDate: { fontSize: typography.fontSize.xs, color: colors.fg.muted },

  // Branch rows
  branchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  branchRowActive: { backgroundColor: colors.accent.subtle },
  branchRowName: { flex: 1, fontSize: typography.fontSize.sm, fontFamily: typography.fontFamily.mono, color: colors.fg.secondary },
  branchRowNameActive: { color: colors.accent.primary, fontWeight: typography.fontWeight.medium },
  currentBadge: { backgroundColor: colors.accent.subtle, paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: radii.sm },
  currentBadgeText: { fontSize: typography.fontSize.xs, color: colors.accent.primary, fontWeight: typography.fontWeight.medium },
  branchHash: { fontSize: typography.fontSize.xs, fontFamily: typography.fontFamily.mono, color: colors.fg.muted },
});
