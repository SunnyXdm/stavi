// WHAT: SessionDrawer — animated swipe-from-left session management overlay.
// WHY:  Phase 2 adds per-plugin session lists (AI chats, terminal tabs) without consuming
//       permanent screen width. Follows the lunel drawer pattern: gesture-driven overlay.
// HOW:  Animated.Value 0→1 drives translateX (drawer) + scrim opacity, useNativeDriver: true.
//       Drawer panel swipe-left-to-close (when open). Opened via the header
//       hamburger. Content is context-sensitive via SessionRegistry.
// SEE:  apps/mobile/src/stores/session-registry.ts, plans/09-navigation-overhaul.md §2

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, Pressable, Animated, Easing, PanResponder,
  Dimensions, StyleSheet, TextInput, FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { AppNavigation } from '../navigation/types';
import { PenLine, House, Settings as SettingsIcon, X } from 'lucide-react-native';
import { usePluginRegistry } from '../stores/plugin-registry';
import { useSessionRegistry } from '../stores/session-registry';
import { useSessionsStore } from '../stores/sessions-store';
import { useTheme } from '../theme';
import { typography, spacing, radii } from '../theme';
import type { SessionEntry } from '@stavi/shared';

export interface SessionDrawerProps {
  visible: boolean;
  sessionId: string;
  onClose: () => void;
  onOpen?: () => void;
}

const OPEN_MS = 250;
const CLOSE_MS = 200;

export function SessionDrawer({ visible, sessionId, onClose, onOpen }: SessionDrawerProps) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<AppNavigation>();
  const windowWidth = Dimensions.get('window').width;
  const drawerWidth = Math.min(windowWidth * 0.82, 340);
  const anim = useRef(new Animated.Value(0)).current;
  const [animState, setAnimState] = useState<'closed' | 'animating' | 'open'>('closed');
  const [query, setQuery] = useState('');
  const { colors } = useTheme();

  const s = useMemo(() => StyleSheet.create({
    scrim: { ...StyleSheet.absoluteFill, backgroundColor: colors.bg.scrim, zIndex: 20 },
    drawer: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.bg.raised, zIndex: 30, flexDirection: 'column' },
    header: { paddingHorizontal: spacing[5], paddingBottom: spacing[3], borderBottomWidth: 1, borderBottomColor: colors.divider },
    headerTitle: { fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.semibold, color: colors.fg.primary },
    body: { flex: 1 },
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[3], paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: colors.divider },
    searchInput: { flex: 1, height: 36, backgroundColor: colors.bg.base, borderWidth: 1, borderColor: colors.divider, borderRadius: radii.md, paddingHorizontal: spacing[3], fontSize: typography.fontSize.sm, color: colors.fg.primary },
    createBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: radii.md, borderWidth: 1, borderColor: colors.accent.primary },
    createLabel: { fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.medium, color: colors.accent.primary },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3], gap: spacing[3] },
    rowActive: { backgroundColor: colors.bg.base },
    rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    dot: { width: 8, height: 8, borderRadius: radii.full, backgroundColor: colors.fg.muted },
    dotActive: { backgroundColor: colors.accent.primary },
    rowText: { flex: 1 },
    rowTitle: { fontSize: typography.fontSize.sm, color: colors.fg.primary },
    rowSub: { fontSize: typography.fontSize.xs, color: colors.fg.muted, marginTop: 2 },
    rowClose: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: radii.sm },
    minimalBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing[6] },
    minimalHint: { fontSize: typography.fontSize.sm, color: colors.fg.muted, textAlign: 'center' },
    emptyText: { textAlign: 'center', fontSize: typography.fontSize.sm, color: colors.fg.muted },
    emptyCont: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[8] },
    bottomNav: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.bg.base },
    navBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], paddingVertical: spacing[3] },
    navLabel: { fontSize: typography.fontSize.xs, color: colors.fg.secondary },
  }), [colors]);

  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);
  const dwRef = useRef(drawerWidth);
  useEffect(() => { onOpenRef.current = onOpen; }, [onOpen]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    setAnimState('animating');
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: visible ? OPEN_MS : CLOSE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => setAnimState(visible ? 'open' : 'closed'));
  }, [visible, anim]);

  // NOTE: edge-swipe-to-OPEN was removed. The closed-state edge catcher was a
  // full-height 30dp strip at zIndex 10 that occluded any left-edge control —
  // most visibly the editor's file-tree toggle, whose taps it silently ate
  // (a PanResponder that doesn't claim a tap still blocks it from the view
  // behind). The hamburger is the open affordance; if edge-swipe-to-open is
  // wanted back, do it at the navigator level via react-native-gesture-handler
  // (which lets taps fall through), not a PanResponder overlay.

  const drawerPan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dx < -10,
    onPanResponderMove: (_, g) => {
      anim.setValue(Math.min(1, Math.max(0, 1 + g.dx / dwRef.current)));
    },
    onPanResponderRelease: (_, g) => {
      if (g.dx < -(dwRef.current * 0.3)) { onCloseRef.current(); }
      else { Animated.timing(anim, { toValue: 1, duration: OPEN_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }
    },
  })).current;

  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [-drawerWidth, 0] });
  const scrimOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  const activeTabId = usePluginRegistry((s) => s.getActiveTabId(sessionId));
  const openTabs = usePluginRegistry((s) => s.getOpenTabs(sessionId));
  const definitions = usePluginRegistry((s) => s.definitions);
  const activeTab = useMemo(() => openTabs.find((t) => t.id === activeTabId), [openTabs, activeTabId]);
  const activePluginId = activeTab?.pluginId ?? null;
  const activeDef = activePluginId ? definitions[activePluginId] : undefined;
  const pluginName = activeDef?.name ?? activePluginId ?? 'Sessions';
  // Only plugins that declare supportsSessions get the search + list + "New".
  // Others (Editor/Git/Browser/Explorer) show a minimal plugin-name drawer —
  // no useless "No sessions for this tool" placeholder.
  const showsSessions = activeDef?.supportsSessions === true;
  const registration = useSessionRegistry((s) =>
    activePluginId && showsSessions ? s.registrations[activePluginId] : undefined,
  );
  // Custom drawer body (e.g. the editor's file tree) — needs the full Session.
  const DrawerContent = activeDef?.drawerContent;
  const workspaceSession = useSessionsStore((s) => s.getSession(sessionId));

  const filteredSessions = useMemo(() => {
    if (!registration) return [];
    if (!query.trim()) return registration.sessions;
    const q = query.toLowerCase();
    return registration.sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [registration, query]);

  const handleSelect = useCallback((id: string) => { registration?.onSelectSession(id); onClose(); }, [registration, onClose]);
  const handleCreate = useCallback(() => { registration?.onCreateSession?.(); onClose(); }, [registration, onClose]);
  const handleHome = useCallback(() => { onClose(); navigation.navigate('SessionsHome'); }, [onClose, navigation]);
  const handleSettings = useCallback(() => { onClose(); navigation.navigate('Settings'); }, [onClose, navigation]);

  const renderItem = useCallback(({ item, index }: { item: SessionEntry; index: number }) => {
    const isActive = item.id === registration?.activeSessionId || !!item.isActive;
    const isLast = index === filteredSessions.length - 1;
    const onCloseSession = registration?.onCloseSession;
    return (
      <Pressable style={[s.row, isActive && s.rowActive, !isLast && s.rowBorder]} onPress={() => handleSelect(item.id)}>
        <View style={[s.dot, isActive && s.dotActive]} />
        <View style={s.rowText}>
          <Text style={s.rowTitle} numberOfLines={1}>{item.title}</Text>
          {item.subtitle ? <Text style={s.rowSub} numberOfLines={1}>{item.subtitle}</Text> : null}
        </View>
        {onCloseSession && (
          <Pressable style={s.rowClose} onPress={() => onCloseSession(item.id)} hitSlop={8}>
            <X size={14} color={colors.fg.muted} />
          </Pressable>
        )}
      </Pressable>
    );
  }, [registration, filteredSessions.length, handleSelect, colors, s]);

  const keyExtractor = useCallback((item: SessionEntry) => item.id, []);

  // Nothing is rendered while closed — no edge catcher (see note above).
  if (animState === 'closed') return null;

  return (
    <>
      <Animated.View style={[s.scrim, { opacity: scrimOpacity }]} pointerEvents="auto">
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} />
      </Animated.View>
      <Animated.View style={[s.drawer, { width: drawerWidth, transform: [{ translateX }] }]} {...drawerPan.panHandlers}>
            <View style={[s.header, { paddingTop: (insets.top || 0) + spacing[4] }]}>
              <Text style={s.headerTitle}>{pluginName}</Text>
            </View>
            <View style={s.body}>
              {DrawerContent && workspaceSession ? (
                <DrawerContent session={workspaceSession} close={onClose} />
              ) : registration ? (
                <>
                  <View style={s.searchRow}>
                    <TextInput
                      style={s.searchInput} value={query} onChangeText={setQuery}
                      placeholder="Search…" placeholderTextColor={colors.fg.muted}
                      clearButtonMode="while-editing" autoCorrect={false}
                    />
                    {registration.onCreateSession && (
                      <Pressable style={s.createBtn} onPress={handleCreate} hitSlop={6}>
                        <PenLine size={14} color={colors.accent.primary} />
                        <Text style={s.createLabel}>{registration.createLabel ?? 'New'}</Text>
                      </Pressable>
                    )}
                  </View>
                  <FlatList
                    data={filteredSessions} renderItem={renderItem} keyExtractor={keyExtractor}
                    keyboardShouldPersistTaps="handled"
                    ListEmptyComponent={<Text style={s.emptyText}>No sessions found</Text>}
                    contentContainerStyle={filteredSessions.length === 0 ? s.emptyCont : undefined}
                  />
                </>
              ) : (
                // Plugin without sessions (Editor/Git/Browser/Explorer): the
                // header already shows its name — keep the body empty so the
                // drawer is just a tidy nav surface, not a fake list.
                <View style={s.minimalBody}>
                  <Text style={s.minimalHint}>{pluginName}</Text>
                </View>
              )}
            </View>
            <View style={[s.bottomNav, { paddingBottom: insets.bottom || spacing[3] }]}>
              <Pressable style={s.navBtn} onPress={handleHome} hitSlop={4}>
                <House size={18} color={colors.fg.secondary} />
                <Text style={s.navLabel}>Home</Text>
              </Pressable>
              <Pressable style={s.navBtn} onPress={handleSettings} hitSlop={4}>
                <SettingsIcon size={18} color={colors.fg.secondary} />
                <Text style={s.navLabel}>Settings</Text>
              </Pressable>
            </View>
      </Animated.View>
    </>
  );
}

// Styles are created inside the component via useMemo (see SessionDrawer body above).
