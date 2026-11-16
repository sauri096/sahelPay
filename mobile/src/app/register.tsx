import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, ErrorText, Field, PinPad, Screen, Title } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { colors, radius } from '../lib/theme';

type Step = 'info' | 'pin' | 'confirm';

export default function Register() {
  const { otpToken, mode } = useLocalSearchParams<{ otpToken: string; mode?: string }>();
  const isReset = mode === 'reset';
  const { signIn } = useAuth();
  const [step, setStep] = useState<Step>(isReset ? 'pin' : 'info');
  const [fullName, setFullName] = useState('');
  const [accountType, setAccountType] = useState<'customer' | 'merchant'>('customer');
  const [businessName, setBusinessName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState(0);

  const finish = async (confirmPin: string) => {
    if (confirmPin !== pin) {
      setError('Les deux codes ne correspondent pas, recommencez');
      setPin('');
      setStep('pin');
      setReset((r) => r + 1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = isReset
        ? await api<{ token: string }>('/auth/pin/reset', { body: { otpToken, newPin: pin } })
        : await api<{ token: string }>('/auth/register', {
          body: { otpToken, fullName, pin, accountType, businessName: accountType === 'merchant' ? businessName : undefined },
        });
      await signIn(r.token);
      router.replace('/home');
    } catch (e: any) {
      setError(e.message);
      setPin('');
      setStep('pin');
      setReset((r) => r + 1);
    } finally {
      setBusy(false);
    }
  };

  if (step === 'info') {
    return (
      <Screen>
        <Title sub="Quelques informations pour ouvrir votre compte">Bienvenue</Title>
        <Field label="Nom complet" value={fullName} onChangeText={setFullName} placeholder="Awa Sarr" autoComplete="name" />
        <Text style={{ fontWeight: '600', marginBottom: 8, color: colors.text }}>Type de compte</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
          {([['customer', 'Particulier'], ['merchant', 'Commerçant']] as const).map(([v, l]) => (
            <Pressable
              key={v}
              onPress={() => setAccountType(v)}
              style={{
                flex: 1, padding: 14, borderRadius: radius.md, borderWidth: 2, alignItems: 'center',
                borderColor: accountType === v ? colors.primary : colors.border,
                backgroundColor: accountType === v ? '#E6F2ED' : colors.card,
              }}
            >
              <Text style={{ fontWeight: '700', color: colors.text }}>{l}</Text>
            </Pressable>
          ))}
        </View>
        {accountType === 'merchant' ? (
          <Field label="Nom du commerce" value={businessName} onChangeText={setBusinessName} placeholder="Restaurant Teranga" />
        ) : null}
        <Button
          title="Continuer"
          onPress={() => setStep('pin')}
          disabled={fullName.trim().length < 2 || (accountType === 'merchant' && businessName.trim().length < 2)}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title sub={step === 'pin' ? 'Il vous sera demandé pour chaque opération. Ne le partagez jamais.' : 'Saisissez-le une seconde fois'}>
        {step === 'pin' ? (isReset ? 'Nouveau code PIN' : 'Choisissez un code PIN') : 'Confirmez le code PIN'}
      </Title>
      <ErrorText>{error}</ErrorText>
      <PinPad
        resetSignal={reset}
        disabled={busy}
        onComplete={(p) => {
          if (step === 'pin') {
            setPin(p);
            setStep('confirm');
            setReset((r) => r + 1);
          } else {
            finish(p);
          }
        }}
      />
      {busy ? <Text style={{ textAlign: 'center', color: colors.muted, marginTop: 12 }}>Création du compte…</Text> : null}
    </Screen>
  );
}
