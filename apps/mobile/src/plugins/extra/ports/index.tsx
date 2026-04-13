// ============================================================
// Extra Plugin: Ports
// ============================================================
// Lists TCP ports listening on the server via system.ports RPC.
// Grouped by process name — matches lunel's Ports layout.
// Header: search + refresh icons.

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Network, RefreshCw, X } from 'lucide-react-native';
import type { PluginDefinition, PluginPanelProps } from '@stavi/shared';
import { colors, typography, spacing, radii } from '../../../theme';
import { useConnectionStore } from '../../../stores/connection';
import { staviClient } from '../../../stores/stavi-client';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

interface PortEntry {
  port: string;
  pid: string;
  process: string;
  address: string;
}

interface PortSection {
  title: string;
  data: PortEntry[];
}

// ----------------------------------------------------------
// Panel Component
// ----------------------------------------------------------

function PortsPanel({ instanceId, isActive }: PluginPanelProps) {
  const connectionState = useConnectionStore((s) => s.state);
  const [sections, setSections] = useState<PortSection[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPorts = useCallback(async () => {
    if (staviClient.getState() !== 'connected') return;
    setLoading(true);
    try {
      const result = await staviClient.request<{ ports: PortEntry[] }>('system.ports', {});
      const ports = result.ports ?? [];

      // Group by process name — lunel's pattern
      const byProcess = new Map<string, PortEntry[]>();
      for (const p of ports) {
        const name = p.process || 'unknown';
        if (!byProcess.has(name)) byProcess.set(name, []);
        byProcess.get(name)!.push(p);
      }

      const grouped: PortSection[] = Array.from(byProcess.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([title, data]) => ({ title, data }));

      setSections(grouped);
    } catch (err) {
      console.error('[Ports] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (connectionState === 'connected' && isActive) {
      fetchPorts();
    }
  }, [connectionState, isActive, fetchPorts]);

  if (connectionState !== 'connected') {
    return (
      <View style={styles.centered}>
        <Network size={32} color={colors.fg.muted} />
        <Text style={styles.emptyText}>Connect to a server to view ports</Text>
      </View>
    );
  }

  const totalPorts = sections.reduce((acc, s) => acc + s.data.length, 0);

  return (
    <View style={styles.container}>
      {/* Header with refresh */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {totalPorts > 0 ? `${totalPorts} listening ports` : 'Listening Ports'}
        </Text>
        <Pressable style={styles.iconBtn} onPress={fetchPorts} hitSlop={8}>
          {loading
            ? <ActivityIndicator size="small" color={colors.fg.muted} />
            : <RefreshCw size={18} color={colors.fg.muted} />
          }
        </Pressable>
      </View>

      {loading && sections.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent.primary} />
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.centered}>
          <Network size={32} color={colors.fg.muted} />
          <Text style={styles.emptyText}>No listening ports found</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item, idx) => `${item.port}:${idx}`}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <View style={styles.portRow}>
              <Text style={styles.portNumber}>:{item.port}</Text>
              <Text style={styles.portMeta}>
                PID {item.pid}
                {item.address && item.address !== '*' ? ` · ${item.address}` : ''}
              </Text>
              {/* Kill button — UI only for now */}
              <Pressable
                style={styles.killBtn}
                hitSlop={8}
                onPress={() => {/* TODO: kill process */}}
              >
                <X size={14} color={colors.semantic.error} />
              </Pressable>
            </View>
          )}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={fetchPorts}
              tintColor={colors.accent.primary}
            />
          }
          stickySectionHeadersEnabled
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

// ----------------------------------------------------------
// Plugin Definition
// ----------------------------------------------------------

export const portsPlugin: PluginDefinition = {
  id: 'ports',
  name: 'Ports',
  description: 'Scan and manage network ports',
  kind: 'extra',
  icon: Network,
  component: PortsPanel,
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
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
    fontWeight: typography.fontWeight.medium,
  },
  iconBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeader: {
    backgroundColor: colors.bg.base,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[1],
  },
  sectionTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.secondary,
  },
  portRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  portNumber: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.mono,
    color: colors.semantic.success,
    width: 72,
  },
  portMeta: {
    flex: 1,
    fontSize: typography.fontSize.xs,
    color: colors.fg.secondary,
    fontFamily: typography.fontFamily.mono,
  },
  killBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.semantic.error + '18',
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.semantic.error + '44',
  },
  listContent: {
    paddingBottom: spacing[6],
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
    textAlign: 'center',
  },
});
