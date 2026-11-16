import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, ErrorText, PinPad, Screen, Title } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const { signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState(0);

  const submit = async (pin: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string }>('/auth/login', { body: { phone, pin } });
      await signIn(r.token);
      router.replace('/home');
    } catch (e: any) {
      setError(e.message);
      setReset((x) => x + 1);
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    try {
      const r = await api<{ devCode?: string }>('/auth/otp/request', { body: { phone } });
      router.push({ pathname: '/otp', params: { phone, devCode: r.devCode ?? '', mode: 'reset' } });
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <Screen>
      <Title sub={phone}>Entrez votre code PIN</Title>
      <ErrorText>{error}</ErrorText>
      <PinPad onComplete={submit} disabled={busy} resetSignal={reset} />
      <Button title="Code PIN oublié ?" variant="ghost" onPress={forgot} />
    </Screen>
  );
}
