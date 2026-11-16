import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Button, ErrorText, Field, Screen, Title } from '../components/ui';
import { api } from '../lib/api';
import { colors } from '../lib/theme';

export default function Otp() {
  const { phone, devCode, mode } = useLocalSearchParams<{ phone: string; devCode?: string; mode?: string }>();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ otpToken: string; userExists: boolean }>('/auth/otp/verify', { body: { phone, code } });
      if (mode === 'reset') {
        router.replace({ pathname: '/register', params: { otpToken: r.otpToken, mode: 'reset' } });
      } else if (r.userExists) {
        router.replace({ pathname: '/login', params: { phone, otpToken: r.otpToken } });
      } else {
        router.replace({ pathname: '/register', params: { otpToken: r.otpToken } });
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Title sub={`Entrez le code à 6 chiffres envoyé au ${phone}`}>Code SMS</Title>
      {devCode ? <Text style={{ color: colors.muted, marginBottom: 12 }}>Mode développement : code {devCode}</Text> : null}
      <Field label="Code" keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} autoFocus autoComplete="sms-otp" textContentType="oneTimeCode" />
      <ErrorText>{error}</ErrorText>
      <Button title="Vérifier" onPress={verify} loading={loading} disabled={code.length !== 6} />
    </Screen>
  );
}
