// WHAT: Add Server sheet used by Sessions Home.
// WHY:  Phase 2 repurposes the old Connect root into a callback-driven add server flow.
//       Phase 6 adds QR pairing; the shortcut renders INSIDE AddServerModal (onPairQr)
//       because RN Modals are separate native windows — a sibling rendered here was
//       permanently hidden underneath, making the scanner unreachable.
// HOW:  Wraps AddServerModal and optionally auto-connects the new server via connection store.
//       The modal's "Scan QR code instead" row navigates to PairServerScreen.
// SEE:  apps/mobile/src/components/AddServerModal.tsx, apps/mobile/src/stores/connection.ts,
//       apps/mobile/src/navigation/PairServerScreen.tsx

import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { AppNavigation } from '../navigation/types';
import { AddServerModal } from './AddServerModal';
import { useConnectionStore, type SavedConnection } from '../stores/connection';
import { showAlert } from './sheets/AppSheets';
import { classifyConnectError } from '../utils/connect-errors';

interface AddServerSheetProps {
  visible: boolean;
  onClose: () => void;
  onComplete?: (connection: SavedConnection) => void;
}

export function AddServerSheet({ visible, onClose, onComplete }: AddServerSheetProps) {
  const navigation = useNavigation<AppNavigation>();
  const connectServer = useConnectionStore((state) => state.connectServer);

  const handleComplete = useCallback(
    async (connection: SavedConnection) => {
      try {
        await connectServer(connection.id);
      } catch (err) {
        const friendly = classifyConnectError(err, { host: connection.host, port: connection.port });
        void showAlert({
          title: friendly.title,
          message: `${friendly.message}\n\nThe server was saved — retry any time from the home screen.`,
        });
      }
      onComplete?.(connection);
    },
    [connectServer, onComplete],
  );

  const handlePairQr = useCallback(() => {
    onClose();
    navigation.navigate('PairServer');
  }, [navigation, onClose]);

  return (
    <AddServerModal
      visible={visible}
      onClose={onClose}
      onComplete={handleComplete}
      onPairQr={handlePairQr}
    />
  );
}
