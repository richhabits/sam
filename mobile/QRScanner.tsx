// In-app QR scanner for desktop pairing.
//
// Before this, the only path from "phone in hand" to "paired" was the system Camera app: leave
// SAM, scan, hope the sam:// banner appears and re-opens SAM with the link. When that handoff
// didn't fire cleanly, the only fallback was typing a 32-character hex code by hand — which is
// what people were actually doing. This scans the same QR (Dashboard.tsx already encodes
// sam://pair?code=…&host=…) without ever leaving the app, using the exact parser
// (mobile/lib/pairlink.ts) the deep-link path already relies on.
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useCallback, useRef, useState } from 'react';
import { Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { parsePairLink, type PairLink } from './lib/pairlink';
import { samColor, samSpace, samType } from './lib/samTheme';

export default function QRScanner({
  visible,
  onClose,
  onScanned,
}: {
  visible: boolean;
  onClose: () => void;
  onScanned: (link: PairLink) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [notAPairCode, setNotAPairCode] = useState(false);
  const scanned = useRef(false);

  const handleScan = useCallback(
    ({ data }: { data: string }) => {
      if (scanned.current) return;
      const link = parsePairLink(data);
      if (!link) {
        // A QR that isn't SAM's pairing link — say so instead of silently doing nothing, which
        // reads as "the scanner is broken" when it's actually "wrong QR code".
        setNotAPairCode(true);
        return;
      }
      scanned.current = true;
      setNotAPairCode(false);
      onScanned(link);
    },
    [onScanned],
  );

  const handleClose = useCallback(() => {
    scanned.current = false;
    setNotAPairCode(false);
    onClose();
  }, [onClose]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={handleClose}>
      <SafeAreaView style={[st.screen, { backgroundColor: samColor.ground }]}>
        <View style={st.header}>
          <Text style={[samType.h3, { color: samColor.ink }]}>Scan QR Code</Text>
          <Pressable onPress={handleClose} hitSlop={12}>
            <Text style={[samType.rowTitle, { color: samColor.accent }]}>Cancel</Text>
          </Pressable>
        </View>

        {!permission ? (
          <View style={st.center} />
        ) : !permission.granted ? (
          <View style={st.center}>
            <Text style={[samType.body, { color: samColor.ink, textAlign: 'center', marginBottom: 16, paddingHorizontal: 32 }]}>
              SAM needs camera access to scan the pairing QR code shown on your Mac/PC.
            </Text>
            <Pressable onPress={requestPermission} style={[st.button, { backgroundColor: samColor.accent }]}>
              <Text style={[samType.rowTitle, { color: samColor.ground }]}>Allow Camera</Text>
            </Pressable>
          </View>
        ) : (
          <View style={st.cameraWrap}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={handleScan}
            />
            <View style={st.frame} pointerEvents="none" />
            <View style={st.captionWrap} pointerEvents="none">
              <Text style={[samType.bodySm, { color: samColor.ink, textAlign: 'center' }]}>
                {notAPairCode
                  ? "That QR isn't a SAM pairing code — open Dashboard → Devices → Pair a phone on your Mac/PC"
                  : 'Point at the QR code on your Mac/PC'}
              </Text>
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: samSpace.gutter,
    height: 44,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cameraWrap: { flex: 1 },
  frame: {
    position: 'absolute',
    top: '30%',
    left: '15%',
    right: '15%',
    bottom: '35%',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    borderRadius: 16,
  },
  captionWrap: { position: 'absolute', bottom: 60, left: 0, right: 0, paddingHorizontal: 32 },
  button: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
});
