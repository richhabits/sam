// Home/Lock Screen widget state. The widget process cannot hold the pairing token or
// reach the Mac; the app writes a small JSON snapshot into the App Group, and the
// widget reads that. Native SAMWidgetStore.save is a no-op on Android / Expo Go.

export const WIDGET_APP_GROUP = 'group.com.hectic.sam.mobile';

export type WidgetSnapshot = {
  paired: boolean;
  demo: boolean;
  line: string;
  detail: string;
};

export function encodeWidgetState(s: WidgetSnapshot): string {
  const line = String(s.line || '').slice(0, 80);
  const detail = String(s.detail || '').slice(0, 80);
  return JSON.stringify({
    paired: !!s.paired,
    demo: !!s.demo,
    line,
    detail,
  });
}

export function parseWidgetState(raw: string | null | undefined): WidgetSnapshot {
  const fallback: WidgetSnapshot = {
    paired: false,
    demo: false,
    line: 'Ask SAM',
    detail: 'Open the app to connect',
  };
  if (!raw) return fallback;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return fallback;
    return {
      paired: !!o.paired,
      demo: !!o.demo,
      line: String(o.line || fallback.line).slice(0, 80),
      detail: String(o.detail || fallback.detail).slice(0, 80),
    };
  } catch {
    return fallback;
  }
}

export function publishWidgetState(s: WidgetSnapshot): void {
  const json = encodeWidgetState(s);
  try {
    // Lazy so unit tests never load react-native's Flow entry.
    const { NativeModules } = require('react-native');
    NativeModules.SAMWidgetStore?.save?.(json);
  } catch {
    /* native module missing in Expo Go / tests — widget stays on last snapshot */
  }
}
