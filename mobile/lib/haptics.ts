import * as Haptics from 'expo-haptics';

// ── TACTILE HAPTICS ENGINE (iOS Taptic & Android Haptic Feedback) ───────────
//
// Gives physical, tactile weight to user interactions across iOS & Android:
// - Light taps for navigation, chips, switches
// - Medium impacts for sending messages, primary actions
// - Success & error notifications for completions and alerts
// - Selection ticks for segmented controls and pickers

export const haptic = {
  /** Subtle crisp tap for chips, toggles, plus button */
  light: () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } catch { /* unsupported platform */ }
  },

  /** Solid tactile punch for sending messages, opening sheets */
  medium: () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } catch { /* unsupported platform */ }
  },

  /** Rigid impact for modals and destructive confirmations */
  heavy: () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    } catch { /* unsupported platform */ }
  },

  /** Mechanical selection tick for tabs and segmented controls */
  selection: () => {
    try {
      void Haptics.selectionAsync().catch(() => {});
    } catch { /* unsupported platform */ }
  },

  /** Double-pulse celebration for pairing, stream completion, code copy */
  success: () => {
    try {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch { /* unsupported platform */ }
  },

  /** Warning/error vibration for failed actions */
  error: () => {
    try {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } catch { /* unsupported platform */ }
  },
};
