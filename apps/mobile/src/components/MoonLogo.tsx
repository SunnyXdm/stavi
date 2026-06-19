// WHAT: Stavi's moon mark — the SAME artwork as the launcher icon.
// WHY:  "Stavi" means moon. The splash/welcome previously showed a hand-drawn
//       vector that didn't match the launcher icon; both now share one source
//       of truth (generated art, also baked into android mipmaps).
// HOW:  Renders the full icon (dark night square) with launcher-style rounded
//       corners so it reads as "the app icon" on either theme, dark or light.
// SEE:  android/app/src/main/res/mipmap-*/, src/assets/images/app-icon.png

import React, { memo } from 'react';
import { Image } from 'react-native';

const ICON = require('../assets/images/app-icon.png');

export const MoonLogo = memo(function MoonLogo({ size = 96 }: { size?: number }) {
  return (
    <Image
      source={ICON}
      style={{ width: size, height: size, borderRadius: size * 0.22 }}
      resizeMode="cover"
    />
  );
});
