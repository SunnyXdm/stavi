import React, { memo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

export const ProviderIcon = memo(function ProviderIcon({
  provider,
  size = 20,
}: {
  provider: string;
  size?: number;
}) {
  if (provider === 'claude') {
    return (
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Defs>
            <LinearGradient id="claudeGrad" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
              <Stop stopColor="#E98A5B" />
              <Stop offset="1" stopColor="#B54A2F" />
            </LinearGradient>
          </Defs>
          <Rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="url(#claudeGrad)" />
          <Path
            d="M15.9 7.4c-1.1-.9-2.4-1.4-3.9-1.4-3.3 0-6 2.7-6 6s2.7 6 6 6c1.4 0 2.8-.5 3.9-1.4l-1.5-1.9c-.7.6-1.5.9-2.4.9-2.1 0-3.7-1.7-3.7-3.7 0-2.1 1.7-3.7 3.7-3.7.9 0 1.8.3 2.4.9l1.5-1.7Z"
            fill="#FFF7F0"
          />
          <Path
            d="M17.8 8.3 12.8 12l5 3.7c.8-1 1.2-2.3 1.2-3.7 0-1.4-.4-2.7-1.2-3.7Z"
            fill="#FFF7F0"
            opacity="0.95"
          />
        </Svg>
      </View>
    );
  }

  if (provider === 'codex') {
    return (
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Defs>
            <LinearGradient id="codexGrad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
              <Stop stopColor="#1FCC93" />
              <Stop offset="1" stopColor="#0B7A69" />
            </LinearGradient>
          </Defs>
          <Rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="url(#codexGrad)" />
          <Circle cx="12" cy="12" r="6.4" fill="none" stroke="#ECFFF7" strokeWidth="2.2" opacity="0.95" />
          <Path
            d="M12 5.6c2 0 3.9.8 5.3 2.2L14.9 10c-.8-.8-1.8-1.2-2.9-1.2-1.1 0-2.1.4-2.9 1.2-.8.8-1.2 1.8-1.2 2.9 0 1.1.4 2.1 1.2 2.9.8.8 1.8 1.2 2.9 1.2 1.1 0 2.1-.4 2.9-1.2l2.4 2.2A7.44 7.44 0 0 1 12 20.4a7.4 7.4 0 0 1-5.3-2.2A7.22 7.22 0 0 1 4.4 13c0-2 .8-3.9 2.3-5.2A7.4 7.4 0 0 1 12 5.6Z"
            fill="#ECFFF7"
          />
        </Svg>
      </View>
    );
  }

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="#2A313E" />
        <Path
          d="M8 12h8M12 8v8"
          stroke="#E7EDF7"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
});
