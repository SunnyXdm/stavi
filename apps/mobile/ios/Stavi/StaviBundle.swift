// WHAT: Tiny native module exposing the iOS app bundle path to JS.
// WHY:  React Native does not expose the main-bundle path to JS, but the editor
//       WebView needs an absolute file:// URI into the bundle's editor/ dir
//       (where the "Copy Editor WebView Assets" build phase deposits the
//       CodeMirror index.html + bundle.js). getEditorUri() in
//       src/plugins/workspace/editor/components/EditorSurface.tsx reads this.
// HOW:  Exports a single `mainBundlePath` constant = Bundle.main.bundlePath.
// SEE:  StaviBundle.m (ObjC bridge), EditorSurface.tsx (consumer).
//
// REGISTRATION: StaviBundle.swift + StaviBundle.m must be added to the Xcode
// project's Sources build phase (they are NOT yet in project.pbxproj). Under
// the New Architecture, a constants-only RCT_EXTERN_MODULE registers via
// bridgeless interop — verify on-device that NativeModules.StaviBundle is
// defined after a clean iOS rebuild.

import Foundation

@objc(StaviBundle)
class StaviBundle: NSObject {
  @objc
  func constantsToExport() -> [String: Any] {
    return ["mainBundlePath": Bundle.main.bundlePath]
  }

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }
}
