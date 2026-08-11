import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
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

// devicePushToken() lived here — an APNs/FCM token getter with NO caller anywhere in the app,
// since the day it was written. Removed 2026-08-11 rather than left as scaffolding: an exported
// function that fetches a push token is read as evidence that push works, and it does not. The
// server's B4 push is Web Push / VAPID, which a native app cannot consume at all (see AGENTS.md),
// so this was a door onto a road that was never built. Notifications here are LOCAL only.
//
// When a real transport lands it needs an APNs key from the operator's Apple account, and the
// three lines this deleted are the least of that work.
