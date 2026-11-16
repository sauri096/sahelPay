import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, Screen, Title } from '../components/ui';
import { parseQr } from '../lib/format';
import { colors } from '../lib/theme';

export default function Scan() {
  const { intent } = useLocalSearchParams<{ intent?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState('');
  const handled = useRef(false);

  const handle = (data: string) => {
    if (handled.current) return;
    const t = parseQr(data) ?? (/^[AM]-[A-Z0-9]{6}$/i.test(data.trim())
      ? parseQr(`SAHELPAY:${data.trim()[0].toUpperCase()}:${data.trim().toUpperCase()}`)
      : null);
    if (!t) {
      setError('QR code non reconnu');
      return;
    }
    if (intent === 'cashout' && t.kind !== 'agent') {
      setError('Pour retirer, scannez le QR code d\'un agent SahelPay');
      return;
    }
    handled.current = true;
    if (t.kind === 'user') router.replace({ pathname: '/send', params: { phone: t.phone } });
    else router.replace({ pathname: '/pay', params: { kind: t.kind === 'agent' ? 'cashout' : 'merchant', code: t.code } });
  };

  if (manual || (permission && !permission.granted && !permission.canAskAgain)) {
    return (
      <Screen>
        <Title sub="Saisissez le code affiché chez l'agent ou le marchand (ex. M-7K2P9Q)">Code manuel</Title>
        <Field label="Code" autoCapitalize="characters" value={code} onChangeText={setCode} />
        {error ? <Text style={{ color: colors.danger, marginBottom: 10 }}>{error}</Text> : null}
        <Button title="Continuer" onPress={() => handle(code)} disabled={code.length < 8} />
        <Button title="Fermer" variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (!permission?.granted) {
    return (
      <Screen>
        <Title sub="SahelPay a besoin de la caméra pour scanner les QR codes de paiement.">Autoriser la caméra</Title>
        <Button title="Autoriser" onPress={requestPermission} />
        <Button title="Saisir un code à la place" variant="ghost" onPress={() => setManual(true)} />
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={(r) => handle(r.data)}
      />
      <SafeAreaView style={s.overlay}>
        <Text style={s.title}>{intent === 'cashout' ? 'Scannez le QR de l\'agent' : 'Scannez un QR SahelPay'}</Text>
        <View style={s.frame} />
        {error ? <Text style={s.error}>{error}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable style={s.pill} onPress={() => setManual(true)}><Text style={s.pillText}>Saisir un code</Text></Pressable>
          <Pressable style={s.pill} onPress={() => router.back()}><Text style={s.pillText}>Fermer</Text></Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'space-around', padding: 20 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  frame: { width: 250, height: 250, borderWidth: 3, borderColor: colors.accent, borderRadius: 24 },
  error: { color: '#fff', backgroundColor: colors.danger, padding: 10, borderRadius: 10, overflow: 'hidden' },
  pill: { backgroundColor: 'rgba(255,255,255,0.9)', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 24 },
  pillText: { fontWeight: '700', color: colors.text },
});
