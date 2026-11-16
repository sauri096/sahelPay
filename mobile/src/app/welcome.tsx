import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ErrorText, Field } from '../components/ui';
import { api } from '../lib/api';
import { DEFAULT_PREFIX } from '../lib/config';
import { colors } from '../lib/theme';


export default function Welcome() {
  const [phone, setPhone] = useState(DEFAULT_PREFIX);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ phone: string; devCode?: string }>('/auth/otp/request', { body: { phone } });
      router.push({ pathname: '/otp', params: { phone: r.phone, devCode: r.devCode ?? '' } });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.root}>
      <View style={s.hero}>
        <Text style={s.logo}>SahelPay</Text>
        <Text style={s.tagline}>Envoyez, payez et retirez votre argent, simplement.</Text>
      </View>
      <View style={s.panel}>
        <Field
          label="Votre numéro de téléphone"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
          autoComplete="tel"
          placeholder="+221 77 123 45 67"
        />
        <ErrorText>{error}</ErrorText>
        <Button title="Continuer" onPress={next} loading={loading} disabled={phone.replace(/\D/g, '').length < 9} />
        <Text style={s.legal}>Un code de vérification vous sera envoyé par SMS.</Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  hero: { flex: 1, justifyContent: 'center', padding: 28 },
  logo: { color: '#fff', fontSize: 42, fontWeight: '900', letterSpacing: -1 },
  tagline: { color: '#D4EDE4', fontSize: 18, marginTop: 10, lineHeight: 25 },
  panel: { backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 40 },
  legal: { color: colors.muted, textAlign: 'center', marginTop: 14, fontSize: 13 },
});
