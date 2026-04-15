// WHAT: Fixed brand colors for third-party AI providers.
// WHY:  These are NOT theme tokens — they are brand assets that do not change
//       with dark/light mode. Extracting them prevents hardcoded hex values
//       scattered across ConfigSheet and ModelPopover.
// HOW:  Imported by provider-selection UI. Never imported by the theme system.
//       Any new provider should be added here before adding it to the UI.
// SEE:  theme/tokens.ts (for actual theme tokens),
//       plugins/workspace/ai/ConfigSheet.tsx,
//       plugins/workspace/ai/ModelPopover.tsx

export const providerBrands = {
  claude:   { color: '#7C3AED', label: 'Claude' },
  codex:    { color: '#10B981', label: 'Codex' },
  opencode: { color: '#F97316', label: 'OpenCode' },
  cursor:   { color: '#6B6B6B', label: 'Cursor' },
  gemini:   { color: '#4285F4', label: 'Gemini' },
} as const;

export type ProviderId = keyof typeof providerBrands;
