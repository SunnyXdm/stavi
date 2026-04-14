// WHAT: Backward-compatible wrapper for the Add Server sheet.
// WHY:  Phase 2 moved the old Connect root into callback-driven add-server UI.
// HOW:  Re-exports the AddServerSheet surface under the legacy ConnectScreen name.
// SEE:  apps/mobile/src/components/AddServerSheet.tsx, apps/mobile/src/navigation/SessionsHomeScreen.tsx

import React from 'react';
import { AddServerSheet } from '../components/AddServerSheet';
import type { SavedConnection } from '../stores/connection';

interface ConnectScreenProps {
  visible: boolean;
  onClose: () => void;
  onComplete: (connection: SavedConnection) => void;
}

export function ConnectScreen({ visible, onClose, onComplete }: ConnectScreenProps) {
  return (
    <AddServerSheet
      visible={visible}
      onClose={onClose}
      onComplete={onComplete}
    />
  );
}
