import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { safeBody } from './scrub';

// SAM reaching your pocket. Two things arrive here:
//
//   1. LOCAL notifications the app raises itself (a task it was watching finished).
//   2. REMOTE pushes from APNs — which needs an Apple push key the operator owns, so the
//      transport is a DRIVE step, not something buildable here. What IS built here is the
//      receiving half: the handler, the sound and the permission.
//
// One asymmetry worth being precise about, because it decides where redaction has to live:
// safeBody() below can only protect notifications THIS APP composes. A remote push is rendered
// by iOS straight from the APNs payload — the handler picks whether it shows and whether it
// makes a sound, but it never gets to rewrite the text. So for remote push the scrubbing must
// stay upstream, on the server, exactly where B4 already does it (server/push.ts). The copy in
// lib/scrub.ts is the last line for the local path, not a safety net for the remote one.

const SOUND_KEY = 'sam.notify.sound';

// Whether the banner makes a sound. Read at delivery time, not cached at startup, so
// toggling it in the app takes effect on the very next notification.
export async function soundEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(SOUND_KEY)) !== 'off';
}
export async function setSoundEnabled(on: boolean): Promise<void> {
  await SecureStore.setItemAsync(SOUND_KEY, on ? 'on' : 'off');
}

// How a notification behaves when it lands while SAM is OPEN in the foreground. iOS suppresses
// these by default, which is wrong for us: the whole point is that a long task finishing is
// worth knowing about even while you're looking at the app.
Notifications.setNotificationHandler({
  handleNotification: async () => {
    const sound = await soundEnabled();
    return {
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: sound,
      shouldSetBadge: false,
    };
  },
});

/** Ask once, and report where we ended up. Never throws — a phone that says no still has a
 *  perfectly working app, it just doesn't get told things. */
export async function ensurePermission(): Promise<Notifications.PermissionStatus> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return current.status;
    // Don't re-prompt a hard denial: iOS silently no-ops the second ask, so a "granted?" that
    // never changes would look like a bug. The operator has to go to Settings from here.
    if (!current.canAskAgain) return current.status;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.status;
  } catch {
    return 'undetermined' as Notifications.PermissionStatus;
  }
}

/** Raise a notification now. `body` is scrubbed and capped exactly like pushNotify() does
 *  server-side — a lock screen is a public surface. */
export async function notify(title: string, body: string, data?: Record<string, unknown>): Promise<void> {
  const sound = await soundEnabled();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: safeBody(title, 60),
      body: safeBody(body),
      sound: sound ? 'default' : undefined,
      data: data ?? {},
    },
    trigger: null, // immediately
  });
}

/** The device's APNs/FCM token, for when the operator wires a real push transport. Returns
 *  null on a simulator (no APNs registration) rather than throwing — that's the normal case
 *  during development, not an error worth surfacing. */
export async function devicePushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const { data } = await Notifications.getDevicePushTokenAsync();
    return typeof data === 'string' ? data : null;
  } catch {
    return null;
  }
}
