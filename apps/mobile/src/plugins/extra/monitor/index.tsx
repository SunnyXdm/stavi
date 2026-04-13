// ============================================================
// Extra Plugin: Monitor
// ============================================================
// System resource overview: disk usage + memory stats from server.
// Data comes from system.stats RPC (df + vm_stat/free).

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { Activity, HardDrive, MemoryStick, RefreshCw } from 'lucide-react-native';
import type { PluginDefinition, PluginPanelProps } from '@stavi/shared';
import { colors, typography, spacing, radii } from '../../../theme';
import { useConnectionStore } from '../../../stores/connection';
import { staviClient } from '../../../stores/stavi-client';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

interface DiskStats {
  filesystem: string;
  size: string;
  used: string;
  avail: string;
  usePercent: string;
}

interface SystemStats {
  disk: DiskStats;
  memRaw: string;
}

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

function parseMemPercent(memRaw: string): number | null {
  // vm_stat (macOS): "Pages free: 12345." — estimate percent used from free/wired/active
  // free -h (Linux): look for "Mem:" line
  const linuxMatch = memRaw.match(/^Mem:\s+(\S+)\s+(\S+)\s+(\S+)/m);
  if (linuxMatch) {
    // total, used, free
    const total = parseSize(linuxMatch[1]);
    const used = parseSize(linuxMatch[2]);
    if (total > 0) return Math.round((used / total) * 100);
  }
  return null;
}

function parseSize(s: string): number {
  const m = s.match(/^([0-9.]+)([KMGTP]?)/i);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  const mult = { K: 1, M: 1024, G: 1024 * 1024, T: 1024 * 1024 * 1024, P: 1024 ** 4 }[unit] ?? 1;
  return val * mult;
}

function StatCard({ icon, label, value, sub, percent }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  percent?: number;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        {icon}
        <Text style={styles.cardLabel}>{label}</Text>
      </View>
      <Text style={styles.cardValue}>{value}</Text>
      {sub ? <Text style={styles.cardSub}>{sub}</Text> : null}
      {percent != null && (
        <View style={styles.barBg}>
          <View
            style={[
              styles.barFill,
              { width: `${Math.min(percent, 100)}%` as any, backgroundColor: barColor(percent) },
            ]}
          />
        </View>
      )}
      {percent != null && (
        <Text style={[styles.cardSub, { color: barColor(percent) }]}>{percent}% used</Text>
      )}
    </View>
  );
}

function barColor(pct: number): string {
  if (pct >= 90) return colors.semantic.error;
  if (pct >= 70) return colors.semantic.warning;
  return colors.semantic.success;
}

// ----------------------------------------------------------
// Panel Component
// ----------------------------------------------------------

function MonitorPanel({ instanceId, isActive }: PluginPanelProps) {
  const connectionState = useConnectionStore((s) => s.state);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchStats = useCallback(async () => {
    if (staviClient.getState() !== 'connected') return;
    setLoading(true);
    try {
      const result = await staviClient.request<SystemStats>('system.stats', {});
      setStats(result);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('[Monitor] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (connectionState === 'connected' && isActive) {
      fetchStats();
    }
  }, [connectionState, isActive, fetchStats]);

  // Auto-refresh every 10s while active
  useEffect(() => {
    if (!isActive || connectionState !== 'connected') return;
    const timer = setInterval(fetchStats, 10000);
    return () => clearInterval(timer);
  }, [isActive, connectionState, fetchStats]);

  if (connectionState !== 'connected') {
    return (
      <View style={styles.centered}>
        <Activity size={32} color={colors.fg.muted} />
        <Text style={styles.emptyText}>Connect to a server to view stats</Text>
      </View>
    );
  }

  const diskPct = stats?.disk.usePercent
    ? parseInt(stats.disk.usePercent.replace('%', ''), 10)
    : undefined;
  const memPct = stats?.memRaw ? parseMemPercent(stats.memRaw) ?? undefined : undefined;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Monitor</Text>
        <Pressable style={styles.refreshBtn} onPress={fetchStats} hitSlop={8}>
          {loading
            ? <ActivityIndicator size="small" color={colors.fg.muted} />
            : <RefreshCw size={16} color={colors.fg.muted} />
          }
        </Pressable>
      </View>

      {loading && !stats ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {stats?.disk && (
            <StatCard
              icon={<HardDrive size={18} color={colors.fg.secondary} />}
              label="Disk"
              value={`${stats.disk.used} / ${stats.disk.size}`}
              sub={stats.disk.avail + ' available'}
              percent={diskPct}
            />
          )}
          {stats?.memRaw && (
            <StatCard
              icon={<MemoryStick size={18} color={colors.fg.secondary} />}
              label="Memory"
              value={memPct != null ? `${memPct}% used` : 'See raw'}
              sub={undefined}
              percent={memPct}
            />
          )}
          {stats?.memRaw && (
            <View style={styles.rawCard}>
              <Text style={styles.rawTitle}>Raw memory info</Text>
              <Text style={styles.rawText}>{stats.memRaw.trim()}</Text>
            </View>
          )}
        </ScrollView>
      )}

      {lastRefresh && (
        <Text style={styles.refreshTime}>
          Updated {lastRefresh.toLocaleTimeString()}
        </Text>
      )}
    </View>
  );
}

// ----------------------------------------------------------
// Plugin Definition
// ----------------------------------------------------------

export const monitorPlugin: PluginDefinition = {
  id: 'monitor',
  name: 'Monitor',
  description: 'System resource monitoring',
  kind: 'extra',
  icon: Activity,
  component: MonitorPanel,
};

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.base,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    padding: spacing[6],
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
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.primary,
  },
  refreshBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    padding: spacing[4],
    gap: spacing[3],
  },
  card: {
    backgroundColor: colors.bg.raised,
    borderRadius: radii.lg,
    padding: spacing[4],
    gap: spacing[2],
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  cardLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardValue: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
    color: colors.fg.primary,
    fontFamily: typography.fontFamily.mono,
  },
  cardSub: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
  },
  barBg: {
    height: 6,
    backgroundColor: colors.bg.active,
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: radii.full,
  },
  rawCard: {
    backgroundColor: colors.bg.raised,
    borderRadius: radii.lg,
    padding: spacing[4],
  },
  rawTitle: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.muted,
    marginBottom: spacing[2],
  },
  rawText: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.secondary,
    fontFamily: typography.fontFamily.mono,
    lineHeight: 16,
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
    textAlign: 'center',
  },
  refreshTime: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
    textAlign: 'center',
    paddingVertical: spacing[2],
  },
});
