import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { getHost, getToken, ApiError } from './api';

// ATTACHMENTS — the camera, the photo library, and files.
//
// These go to /api/command, NOT /api/stream: the streaming route does not read `attachments`
// at all, while the command route does and runs them through vision (server/index.ts ~811).
// So a message with a photo answers in one piece instead of streaming, which is honest —
// pretending to stream by revealing a finished answer word by word would be theatre.
//
// Everything is sent as base64 in the JSON body. The server allows 30mb (express.json limit),
// so images are requested at 0.7 quality — a phone photo at full size is several megabytes of
// base64 and would fail the limit rather than the upload.

// The server's shape, not a shape of our own: /api/command filters attachments by
// `kind === "image"` (with `data`) or `kind === "text"` (with `text`). Sending {mime, data}
// without a kind means images.length is 0 and the whole thing silently falls through to the
// ordinary text path — which is exactly what happened the first time: SAM answered "no new
// question has been made" over a photo it never saw.
export type Attachment =
  | { kind: 'image'; mime: string; data: string; name?: string }
  | { kind: 'text'; text: string; name?: string };

/** Ask for a photo from the library. Returns null if the user backs out or denies access. */
export async function pickPhoto(): Promise<Attachment | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.7,
    base64: true,
  });
  if (r.canceled || !r.assets?.[0]?.base64) return null;
  const a = r.assets[0];
  return { kind: 'image', mime: a.mimeType || 'image/jpeg', data: a.base64!, name: a.fileName || 'photo.jpg' };
}

/** Take a photo. Same shape, different door — iOS asks for camera permission separately. */
export async function takePhoto(): Promise<Attachment | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const r = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true });
  if (r.canceled || !r.assets?.[0]?.base64) return null;
  const a = r.assets[0];
  return { kind: 'image', mime: a.mimeType || 'image/jpeg', data: a.base64!, name: a.fileName || 'photo.jpg' };
}

/** Any file. Read as base64 so it travels the same way an image does. */
export async function pickFile(): Promise<Attachment | null> {
  const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  const mime = a.mimeType || 'application/octet-stream';
  const res = await fetch(a.uri);

  if (mime.startsWith('image/')) {
    const blob = await res.blob();
    const data: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('could not read that file'));
      reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]+,/, ''));
      reader.readAsDataURL(blob);
    });
    return { kind: 'image', mime, data, name: a.name };
  }

  // The server understands exactly two kinds. A PDF or a binary has nowhere to go, so say so
  // rather than attaching something that will be silently ignored.
  const readable = /^text\/|json|xml|javascript|typescript|csv|markdown/.test(mime) || /\.(md|txt|csv|json|ts|tsx|js|jsx|py|sh|ya?ml)$/i.test(a.name || '');
  if (!readable) throw new Error(`SAM can read images and text files — ${a.name || 'that file'} is neither.`);
  const text = await res.text();
  return { kind: 'text', text, name: a.name };
}

/**
 * Send a message that carries attachments. One request, one answer — /api/command returns the
 * finished reply rather than a stream.
 */
export async function sendWithAttachments(
  message: string,
  attachments: Attachment[],
  history: { role: 'user' | 'sam'; text: string }[],
): Promise<{ text: string; tier?: string; provider?: string }> {
  const [host, token] = await Promise.all([getHost(), getToken()]);
  if (!host || !token) throw new ApiError(401, 'not paired');

  const res = await fetch(`${host}/api/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      message,
      history: history.slice(-10),
      attachments: attachments.map((a) =>
        a.kind === 'image' ? { kind: 'image', mime: a.mime, data: a.data } : { kind: 'text', text: a.text },
      ),
    }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body?.error || `that didn't send (${res.status})`);
  // /api/command answers under `text` for a normal turn and `reply` for a yard-routed one.
  return { text: body?.text || body?.reply || '', tier: body?.tier, provider: body?.provider };
}
