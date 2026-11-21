/**
 * Supervisor mode: scan riders at the bus door. Every scan is recorded as
 * ridership (ground truth for the prediction model).
 *
 * Accepts the rider's app QR, their university ID card barcode (camera), or
 * input from a barcode gun / card reader that types like a keyboard. After a
 * valid scan, the rider's ID card (another barcode number, or its chip) can be
 * linked so the card alone works next time.
 */
import { useRef, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeType } from 'expo-camera';
import { useQuery } from '@tanstack/react-query';
import { groupByOperator } from '@diu/shared';
import { api } from '../src/lib/api';
import { useAuth } from '../src/lib/auth';
import { Button, Card, Segmented, T, useTheme } from '../src/components/ui';

interface Bus { id: string; code: string; operatorCode: string; operatorName: string }
interface ScanResult { valid: boolean; reason: string | null; name: string | null; boardingId?: string }
type ReaderKind = 'barcode' | 'chip';

/** Our app QR codes look like v1.c.<uuid>.<step>.<sig>; anything else is an ID card. */
const isAppQr = (data: string) => data.startsWith('v1.');
/** ID cards use one of these; the app QR is 'qr'. */
const BARCODE_TYPES: BarcodeType[] = ['qr', 'code128', 'code39', 'code93', 'codabar', 'ean13', 'ean8', 'upc_a', 'upc_e', 'itf14', 'pdf417', 'datamatrix', 'aztec'];

export default function ScanScreen() {
  const t = useTheme();
  const { signOut } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [busId, setBusId] = useState<string | null>(null);
  const [last, setLast] = useState<ScanResult | null>(null);
  const [count, setCount] = useState(0);
  const [source, setSource] = useState<'camera' | 'reader'>('camera');
  const [readerKind, setReaderKind] = useState<ReaderKind>('barcode');
  const [typed, setTyped] = useState('');
  /** Set after a valid scan when the supervisor chose to link the rider's ID card. */
  const [linking, setLinking] = useState<{ boardingId: string; name: string | null; kind: ReaderKind } | null>(null);
  const busy = useRef(false);
  const lastData = useRef('');
  const buses = useQuery({ queryKey: ['supervisor-buses'], queryFn: () => api<Bus[]>('/boarding/buses') });
  const [filter, setFilter] = useState('');
  const shown = (buses.data ?? []).filter((b) => !filter || b.operatorCode === filter);
  const companies: [string, string][] = [['', 'All'], ...groupByOperator(buses.data ?? []).map(({ operatorCode, buses: list }): [string, string] => [operatorCode, list[0]!.operatorName])];

  /** One entry point for camera and reader input. */
  const handle = async (data: string, kind: ReaderKind) => {
    if (busy.current || !busId || !data.trim()) return;
    busy.current = true;
    try {
      if (linking) {
        if (isAppQr(data)) { setLast({ valid: false, reason: 'That is the app QR. Scan the university ID card to link it.', name: linking.name }); return; }
        const r = await api<{ linked: boolean; name: string; note: string }>('/boarding/link-card', { body: { boardingId: linking.boardingId, code: data, kind: linking.kind } });
        setLast({ valid: true, reason: r.note, name: r.name });
        setLinking(null);
        return;
      }
      const scannedAt = new Date().toISOString();
      const r = isAppQr(data)
        ? await api<ScanResult>('/boarding/scan', { body: { qrToken: data, busId, method: 'qr', scannedAt } })
        : await api<ScanResult>('/boarding/scan-id', { body: { code: data, kind, busId, scannedAt } });
      setLast(r);
      if (r.valid) setCount((c) => c + 1);
    } catch (e) {
      setLast({ valid: false, reason: e instanceof Error ? e.message : 'Scan failed', name: null });
      if (linking) setLinking(null);
    } finally {
      setTimeout(() => { busy.current = false; lastData.current = ''; }, 1500);
    }
  };

  if (source === 'camera' && !permission) return <View style={{ flex: 1, backgroundColor: t.bg }} />;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, padding: 14, gap: 12 }}>
      <Segmented value={filter} onChange={setFilter} options={companies} />
      <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6 }}>
        {shown.map((b) => <Button key={b.id} title={b.code} primary={b.id === busId} onPress={() => setBusId(b.id)} />)}
      </ScrollView>
      <Segmented value={source} onChange={setSource} options={[['camera', 'Camera'], ['reader', 'Card reader / gun']]} />

      {source === 'camera' ? (
        !permission?.granted ? (
          <Card><T bold>Camera access is needed to scan QR codes and ID card barcodes.</T><Button primary title="Allow camera" onPress={requestPermission} /></Card>
        ) : (
          <View style={{ flex: 1, borderRadius: 16, overflow: 'hidden' }}>
            <CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }} onBarcodeScanned={({ data }) => {
              if (data === lastData.current) return;
              lastData.current = data;
              void handle(data, 'barcode');
            }} />
          </View>
        )
      ) : (
        <Card>
          <Segmented value={linking?.kind ?? readerKind} onChange={(k) => (linking ? setLinking({ ...linking, kind: k }) : setReaderKind(k))} options={[['barcode', 'Barcode gun'], ['chip', 'Chip reader']]} />
          <T muted size={12}>Keep this box selected. The reader types the number and presses Enter.</T>
          <TextInput autoFocus value={typed} onChangeText={setTyped} placeholder="Waiting for the reader…" placeholderTextColor={t.muted}
            onSubmitEditing={() => { const v = typed; setTyped(''); void handle(v, linking?.kind ?? readerKind); }} blurOnSubmit={false}
            style={{ borderWidth: 1, borderColor: t.line, borderRadius: 10, padding: 12, color: t.ink, fontFamily: 'monospace' }} />
        </Card>
      )}

      <Card style={{ backgroundColor: last ? (last.valid ? t.okSoft : t.critSoft) : t.surface }}>
        <T bold size={18} color={last ? (last.valid ? t.ok : t.crit) : undefined}>
          {!busId ? 'Choose your bus first' : linking ? `Now scan ${linking.name ?? 'the rider'}'s ID card ${linking.kind === 'chip' ? 'chip' : 'barcode'}` : last ? (last.valid ? `OK · ${last.name ?? ''}` : 'Not valid') : 'Scan the app QR or the ID card'}
        </T>
        {!linking && last?.reason && <T>{last.reason}</T>}
        {last?.valid && last.boardingId && !linking && (
          <View style={{ gap: 6 }}>
            <T muted size={12}>Match the name with the photo on the ID card. If their ID card did not work, link it now:</T>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Button title="Link ID card barcode" onPress={() => setLinking({ boardingId: last.boardingId!, name: last.name, kind: 'barcode' })} />
              <Button title="Link chip" onPress={() => { setSource('reader'); setLinking({ boardingId: last.boardingId!, name: last.name, kind: 'chip' }); }} />
            </View>
          </View>
        )}
        {linking && <Button title="Cancel linking" onPress={() => setLinking(null)} />}
        <T muted>{count} rider(s) boarded on this trip</T>
      </Card>
      <Button title="Sign out" onPress={() => signOut()} />
    </View>
  );
}
