import * as SecureStore from 'expo-secure-store';

// A reply the person wants a human to look at. Apple reviews an AI chat app for
// this control. The record is the reason plus the reply, nothing else.

export const REPORT_REASONS = ['harmful', 'sexual', 'illegal', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

const KEY = 'sam.reports';
const MAX_KEPT = 20;
const MAX_TEXT = 2000;

export function reportRecord(reason: string, text: string): { reason: ReportReason; text: string } | null {
  if (!(REPORT_REASONS as readonly string[]).includes(reason)) return null;
  const body = text.trim().slice(0, MAX_TEXT);
  if (!body) return null;
  return { reason: reason as ReportReason, text: body };
}

export async function saveReport(record: { reason: ReportReason; text: string }): Promise<void> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const prev = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(prev) ? prev : [];
    list.push({ ...record, at: new Date().toISOString() });
    await SecureStore.setItemAsync(KEY, JSON.stringify(list.slice(-MAX_KEPT)));
  } catch {
    // The button still confirms. A locked Keychain must not trap the tap.
  }
}
