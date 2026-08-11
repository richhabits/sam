import { beforeEach, describe, expect, it, vi } from 'vitest';

// "Forget this device" used to delete the phone's token and stop there. The session it
// authenticated with stayed alive on the Mac for its full 30-day rolling life: a destructive
// row that removed the operator's ACCESS to the device rather than the device's access to them,
// with only the Mac's own list left to notice. These pin both halves — the revoke that must now
// happen, and the honesty that has to survive the Mac being unreachable.

const store = new Map<string, string>();
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => store.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => { store.set(k, v); },
  deleteItemAsync: async (k: string) => { store.delete(k); },
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios', isPad: false } }));

import { forgetDevice } from './api';
import { leaveDemo } from './demo';

const fetchSpy = vi.fn();
const HOST = 'http://172.20.10.3:8787';

beforeEach(async () => {
  store.clear();
  await leaveDemo();
  store.set('sam.host', HOST);
  store.set('sam.token', 'a-real-token');
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});

const ok = () => ({ ok: true, json: async () => ({ ok: true }) });

describe('forgetDevice tells the Mac, not just the keychain', () => {
  it('calls the self-revoke route on the paired host', async () => {
    fetchSpy.mockResolvedValue(ok());
    const { revokedOnMac } = await forgetDevice();
    expect(revokedOnMac).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${HOST}/api/pair/forget`);
    expect(init.method).toBe('POST');
    // Authenticated as the device being revoked — that is what lets the server derive WHICH
    // session to close without the phone naming one.
    expect(init.headers.Authorization).toBe('Bearer a-real-token');
  });

  it('wipes the local token on success', async () => {
    fetchSpy.mockResolvedValue(ok());
    await forgetDevice();
    expect(store.get('sam.token')).toBeUndefined();
  });

  it('reports revokedOnMac:false when the Mac cannot be reached', async () => {
    // A sleeping Mac, a different network, a pulled cable. The operator has to be told, because
    // a live session for this phone is still sitting in a device list they cannot see from here.
    fetchSpy.mockRejectedValue(new Error('Network request failed'));
    await expect(forgetDevice()).resolves.toEqual({ revokedOnMac: false });
  });

  it('reports revokedOnMac:false when the server refuses', async () => {
    // Includes the 500 the route returns when it could not find the session to revoke — a
    // refusal is not a revocation, and must never be reported as one.
    fetchSpy.mockResolvedValue({ ok: false, json: async () => ({ error: 'could not be found' }) });
    await expect(forgetDevice()).resolves.toEqual({ revokedOnMac: false });
  });

  it('still wipes the local token when the Mac could not be told', async () => {
    // The trap this avoids: refusing to forget locally until the Mac answers would leave a
    // phone that cannot be un-paired because the machine it is paired to is asleep.
    fetchSpy.mockRejectedValue(new Error('Network request failed'));
    await forgetDevice();
    expect(store.get('sam.token')).toBeUndefined();
  });
});
