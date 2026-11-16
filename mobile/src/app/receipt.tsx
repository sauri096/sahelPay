import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Row } from '../components/ui';
import { money } from '../lib/format';
import { colors } from '../lib/theme';

export default function Receipt() {
  const p = useLocalSearchParams<{ title: string; subtitle?: string; amount: string; fee: string; to: string; reference: string }>();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, padding: 20, justifyContent: 'center' }}>
      <View style={s.check}><Text style={{ color: '#fff', fontSize: 40, fontWeight: '900' }}>✓</Text></View>
      <Text style={s.title}>{p.title}</Text>
      {p.subtitle ? <Text style={s.sub}>{p.subtitle}</Text> : null}
      <Text style={s.amount}>{money(Number(p.amount))}</Text>
      <Card>
        <Row label="Bénéficiaire" value={p.to} />
        <Row label="Frais" value={Number(p.fee) ? money(Number(p.fee)) : 'Gratuit'} />
        <Row label="Référence" value={p.reference} />
        <Row label="Date" value={new Date().toLocaleString('fr-FR')} />
      </Card>
      <Button title="Terminé" onPress={() => router.replace('/home')} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  check: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.success, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '800', textAlign: 'center', marginTop: 18, color: colors.text },
  sub: { textAlign: 'center', color: colors.muted, marginTop: 6, fontSize: 15 },
  amount: { fontSize: 36, fontWeight: '900', textAlign: 'center', marginVertical: 18, color: colors.primary },
});
