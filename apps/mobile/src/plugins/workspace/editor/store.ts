// WHAT: Zustand store for Editor plugin state, keyed by sessionId.
// WHY:  Centralizes openFiles, activeFile, expandedDirs, and showHidden per session
//       so state survives tab switches (opacity-swap pattern) and is consistent
//       across the FileTree + EditorTabs + EditorSurface components.
// HOW:  Zustand with persist (activeFile + openFiles only; showHidden and
//       expandedDirs are session-only, not persisted). Uses AsyncStorage via the
//       same persist key prefix as plugin-registry.
// SEE:  apps/mobile/src/plugins/workspace/editor/index.tsx,
//       apps/mobile/src/stores/plugin-registry.ts

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useConnectionStore } from '../../../stores/connection';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

export interface OpenFile {
  /** Absolute path on the server */
  path: string;
  /** Full content as loaded from fs.read */
  content: string;
  /** True while loading from server */
  loading: boolean;
  /** Error message if load failed */
  error?: string;
  /** Marks unsaved changes (driven by WebView contentChanged in 4b) */
  dirty: boolean;
  /** CodeMirror language ID (populated in 4b) */
  language?: string;
}

// ----------------------------------------------------------
// Store shape
// ----------------------------------------------------------

export interface EditorStoreState {
  /** Per-session list of open files */
  openFilesBySession: Record<string, OpenFile[]>;
  /** Per-session path of the currently active (visible) file */
  activeFileBySession: Record<string, string | null>;
  /** Per-session set of expanded directory paths in the file tree */
  expandedDirsBySession: Record<string, Set<string>>;
  /** Per-session flag: show hidden files in the tree */
  showHiddenBySession: Record<string, boolean>;

  // Actions
  openFile(sessionId: string, path: string, serverId: string): Promise<void>;
  closeFile(sessionId: string, path: string): void;
  setActiveFile(sessionId: string, path: string): void;
  toggleExpanded(sessionId: string, path: string): void;
  toggleShowHidden(sessionId: string): void;

  // Used by 4b to update dirty flag and content
  setFileDirty(sessionId: string, path: string, dirty: boolean): void;
  setFileContent(sessionId: string, path: string, content: string): void;
}

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

function ensureSession(state: EditorStoreState, sessionId: string): void {
  if (!state.openFilesBySession[sessionId]) {
    state.openFilesBySession[sessionId] = [];
  }
  if (state.activeFileBySession[sessionId] === undefined) {
    state.activeFileBySession[sessionId] = null;
  }
  if (!state.expandedDirsBySession[sessionId]) {
    state.expandedDirsBySession[sessionId] = new Set();
  }
  if (state.showHiddenBySession[sessionId] === undefined) {
    state.showHiddenBySession[sessionId] = false;
  }
}

// ----------------------------------------------------------
// Store
// ----------------------------------------------------------

export const useEditorStore = create<EditorStoreState>()(
  persist(
    (set, get) => ({
      openFilesBySession: {},
      activeFileBySession: {},
      expandedDirsBySession: {},
      showHiddenBySession: {},

      // -------------------------------------------------------
      // openFile — load file content from server, set as active
      // -------------------------------------------------------
      openFile: async (sessionId: string, path: string, serverId: string) => {
        const state = get();

        // Ensure per-session arrays exist (immer-style manual copy)
        const openFiles = state.openFilesBySession[sessionId] ?? [];
        const existing = openFiles.find((f) => f.path === path);

        if (existing && !existing.error) {
          // Already open and not errored — just switch to it
          set((s) => ({
            activeFileBySession: { ...s.activeFileBySession, [sessionId]: path },
          }));
          return;
        }

        // Add as loading (or replace errored entry)
        const loadingFile: OpenFile = {
          path,
          content: '',
          loading: true,
          dirty: false,
          error: undefined,
        };
        const filesWithLoading = existing
          ? openFiles.map((f) => (f.path === path ? loadingFile : f))
          : [...openFiles, loadingFile];

        set((s) => ({
          openFilesBySession: { ...s.openFilesBySession, [sessionId]: filesWithLoading },
          activeFileBySession: { ...s.activeFileBySession, [sessionId]: path },
        }));

        // Fetch from server
        try {
          const client = useConnectionStore.getState().getClientForServer(serverId);
          if (!client) {
            throw new Error('Not connected to server');
          }
          const result = await client.request<{ content: string }>('fs.read', { path });
          const content = result?.content ?? '(unable to read file)';

          set((s) => {
            const files = s.openFilesBySession[sessionId] ?? [];
            return {
              openFilesBySession: {
                ...s.openFilesBySession,
                [sessionId]: files.map((f) =>
                  f.path === path ? { ...f, content, loading: false } : f,
                ),
              },
            };
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to load';
          set((s) => {
            const files = s.openFilesBySession[sessionId] ?? [];
            return {
              openFilesBySession: {
                ...s.openFilesBySession,
                [sessionId]: files.map((f) =>
                  f.path === path ? { ...f, loading: false, error: message } : f,
                ),
              },
            };
          });
        }
      },

      // -------------------------------------------------------
      // closeFile
      // -------------------------------------------------------
      closeFile: (sessionId: string, path: string) => {
        set((s) => {
          const files = (s.openFilesBySession[sessionId] ?? []).filter(
            (f) => f.path !== path,
          );
          const current = s.activeFileBySession[sessionId];
          const nextActive =
            current === path
              ? (files[files.length - 1]?.path ?? null)
              : current ?? null;
          return {
            openFilesBySession: { ...s.openFilesBySession, [sessionId]: files },
            activeFileBySession: { ...s.activeFileBySession, [sessionId]: nextActive },
          };
        });
      },

      // -------------------------------------------------------
      // setActiveFile
      // -------------------------------------------------------
      setActiveFile: (sessionId: string, path: string) => {
        set((s) => ({
          activeFileBySession: { ...s.activeFileBySession, [sessionId]: path },
        }));
      },

      // -------------------------------------------------------
      // toggleExpanded — expand or collapse a directory in the tree
      // Note: expandedDirs is NOT persisted (session-only)
      // -------------------------------------------------------
      toggleExpanded: (sessionId: string, path: string) => {
        set((s) => {
          const current = s.expandedDirsBySession[sessionId] ?? new Set<string>();
          const next = new Set(current);
          if (next.has(path)) {
            next.delete(path);
          } else {
            next.add(path);
          }
          return {
            expandedDirsBySession: { ...s.expandedDirsBySession, [sessionId]: next },
          };
        });
      },

      // -------------------------------------------------------
      // toggleShowHidden — NOT persisted
      // -------------------------------------------------------
      toggleShowHidden: (sessionId: string) => {
        set((s) => ({
          showHiddenBySession: {
            ...s.showHiddenBySession,
            [sessionId]: !(s.showHiddenBySession[sessionId] ?? false),
          },
        }));
      },

      // -------------------------------------------------------
      // setFileDirty — called by WebView bridge (4b)
      // -------------------------------------------------------
      setFileDirty: (sessionId: string, path: string, dirty: boolean) => {
        set((s) => {
          const files = s.openFilesBySession[sessionId] ?? [];
          return {
            openFilesBySession: {
              ...s.openFilesBySession,
              [sessionId]: files.map((f) =>
                f.path === path ? { ...f, dirty } : f,
              ),
            },
          };
        });
      },

      // -------------------------------------------------------
      // setFileContent — called after save flow (4b)
      // -------------------------------------------------------
      setFileContent: (sessionId: string, path: string, content: string) => {
        set((s) => {
          const files = s.openFilesBySession[sessionId] ?? [];
          return {
            openFilesBySession: {
              ...s.openFilesBySession,
              [sessionId]: files.map((f) =>
                f.path === path ? { ...f, content, dirty: false } : f,
              ),
            },
          };
        });
      },
    }),
    {
      name: 'stavi-editor-store',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      // Only persist openFiles (without content, to keep storage small) and activeFile
      // expandedDirs and showHidden are session-only (not persisted)
      partialize: (state) => ({
        openFilesBySession: Object.fromEntries(
          Object.entries(state.openFilesBySession).map(([sessionId, files]) => [
            sessionId,
            // Persist paths only — content will be re-fetched on restore
            files.map((f) => ({
              ...f,
              content: '',
              loading: true,
              dirty: false,
              error: undefined,
            })),
          ]),
        ),
        activeFileBySession: state.activeFileBySession,
      }),
    },
  ),
);
