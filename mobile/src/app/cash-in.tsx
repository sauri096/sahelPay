import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { Button, ErrorText, Field, PinConfirm, Screen, Title } from '../components/ui';
import { api, newIdempotencyKey, Transaction } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money } from '../lib/format';
import { DEFAULT_PREFIX } from '../lib/config';
import { colors } from '../lib/theme';

/** Écran agent : le client remet des espèces, l'agent crédite son compte. */
export default function CashIn() {
  const { me } = useAuth();
  const [phone, setPhone] = useState(DEFAULT_PREFIX);
  const [amount, setAmount] = useState('');
  const [customer, setCustomer] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const idem = useRef(newIdempotencyKey());

  useEffect(() => {
    setCustomer(null);
    if (phone.replace(/\D/g, '').length < 11) return;
    const t = setTimeout(() => {
      api<{ fullName: string; role: string }>(`/users/lookup?phone=${encodeURIComponent(phone)}`)
        .then((r) => setCustomer(r.role === 'customer' ? r.fullName : ''))
        .catch(() => setCustomer(''));
    }, 350);
    return () => clearTimeout(t);
  }, [phone]);

  const n = Number(amount.replace(/\D/g, ''));
  const float = me?.wallet.balance ?? 0;

  const submit = async (pin: string) => {
    const r = await api<{ transaction: Transaction }>('/agent/cash-in', {
      body: { customerPhone: phone, amount: n, pin }, idempotencyKey: idem.current,
    });
    setConfirming(false);
    router.replace({
      pathname: '/receipt',
      params: { title: 'Dépôt effectué', amount: String(r.transaction.amount), fee: '0', to: customer ?? phone, reference: r.transaction.reference },
    });
  };

  return (
    <Screen>
      <Title sub={`Float disponible : ${money(float)}`}>Dépôt d'espèces</Title>
      <Field label="Numéro du client" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
      {customer ? <Text style={{ color: colors.success, fontWeight: '700', marginTop: -8, marginBottom: 14 }}>✓ {customer}</Text> : null}
      {customer === '' ? <ErrorText>Aucun compte client avec ce numéro</ErrorText> : null}
      <Field label="Montant reçu en espèces (FCFA)" keyboardType="number-pad" value={amount} onChangeText={setAmount} />
      {n > float ? <ErrorText>Float insuffisant : contactez SahelPay pour vous réapprovisionner</ErrorText> : null}
      <Button title="Créditer le client" disabled={!customer || !n || n > float} onPress={() => setConfirming(true)} />
      <PinConfirm
        visible={confirming}
        title={`Déposer ${money(n)}`}
        summary={<Text style={{ textAlign: 'center', color: colors.muted, marginTop: 4 }}>sur le compte de {customer}</Text>}
        onSubmit={submit}
        onClose={() => setConfirming(false)}
      />
    </Screen>
  );
}
