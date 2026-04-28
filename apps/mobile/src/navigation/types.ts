// WHAT: Root navigation type — eliminates NativeStackNavigationProp<any> across the app.
// WHY:  Typed navigation catches navigate('wrong-screen') and missing params at compile time.
// HOW:  RootStackParamList is the single source of truth for the stack.
//       All screens import AppNavigation / AppRoute from here, not from @react-navigation directly.
// SEE:  apps/mobile/src/App.tsx (NativeStackNavigator uses this param list),
//       plans/13-roadmap.md Phase A2.1

import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';

export type RootStackParamList = {
  SessionsHome: undefined;
  Workspace: { sessionId: string };
  Settings: undefined;
  PairServer: undefined;
};

/** Typed navigation prop for the root stack. */
export type AppNavigation = NativeStackNavigationProp<RootStackParamList>;

/** Typed route prop for a specific screen. */
export type AppRoute<S extends keyof RootStackParamList> = RouteProp<RootStackParamList, S>;
