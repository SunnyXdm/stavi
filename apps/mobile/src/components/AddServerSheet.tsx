// WHAT: Add Server sheet used by Sessions Home.
// WHY:  Phase 2 repurposes the old Connect root into a callback-driven add server flow.
// HOW:  Wraps AddServerModal and optionally auto-connects the new server via connection store.
// SEE:  apps/mobile/src/components/AddServerModal.tsx, apps/mobile/src/stores/connection.ts

import React, { useCallback } from 'react';
import { Alert } from 'react-native';
import { AddServerModal } from './AddServerModal';
import { useConnectionStore, type SavedConnection } from '../stores/connection';

interface AddServerSheetProps {
  visible: boolean;
  onClose: () => void;
  onComplete?: (connection: SavedConnection) => void;
}

export function AddServerSheet({ visible, onClose, onComplete }: AddServerSheetProps) {
  const connectServer = useConnectionStore((state) => state.connectServer);

  const handleComplete = useCallback(
    async (connection: SavedConnection) => {
      try {
        await connectServer(connection.id);
      } catch (err) {
        Alert.alert(
          'Connection Failed',
          err instanceof Error ? err.message : 'Unable to connect to server',
          [{ text: 'OK' }],
        );
      }
      onComplete?.(connection);
    },
    [connectServer, onComplete],
  );

  return (
    <AddServerModal
      visible={visible}
      onClose={onClose}
      onComplete={handleComplete}
    />
  );
}
