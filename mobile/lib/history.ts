import * as SecureStore from 'expo-secure-store';
import { bound, type Stored } from './thread';

export { bound, type Stored } from './thread';

// The conversation survives closing the app.
//
// Losing every thread the moment you swipe the app away is the single most "unfinished" thing
// a chat client can do, and SAM's whole pitch is a memory that compounds. Stored via
// expo-secure-store because it is the storage this app ALREADY has — adding
// expo-file-system or async-storage means a native module and a ~15-minute rebuild
// (mobile/AGENTS.md) for something a few kilobytes of text does not justify.
//
// The Keychain is not a database, so this is bounded hard on both axes below. If the pocket
// ever needs full thread history, that is the moment to add real storage — not before.

const KEY = 'sam.thread';

export async function loadThread(): Promise<Stored[]> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A corrupt or unreadable thread is not worth blocking the app over — start fresh.
    return [];
  }
}

export async function saveThread(turns: Stored[]): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(bound(turns)));
  } catch {
    /* out of space or locked — the conversation still works, it just won't persist */
  }
}

export async function clearThread(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* nothing to clear */
  }
}
