import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { Button, Card, ErrorText, Field, PinConfirm, Row, Screen } from '../components/ui';
import { api, newIdempotencyKey, Transaction } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money } from '../lib/format';
import { DEFAULT_PREFIX } from '../lib/config';
import { colors } from '../lib/theme';

interface Quote { amount: number; fee: number; totalDebited: number }

export default function Send() {
  const params = useLocalSearchParams<{ phone?: string }>();
  const { me } = useAuth();
  const [phone, setPhone] = useState(params.phone ?? DEFAULT_PREFIX);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [recipient, setRecipient] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const idem = useRef(newIdempotencyKey());

  // Affiche le nom du bénéficiaire avant l'envoi : c'est la meilleure protection contre les erreurs de numéro.
  useEffect(() => {
    setRecipient(null);
    if (phone.replace(/\D/g, '').length < 11) return;
    const t = setTimeout(() => {
      api<{ fullName: string; businessName: string | null }>(`/users/lookup?phone=${encodeURIComponent(phone)}`)
        .then((r) => setRecipient(r.businessName ?? r.fullName))
        .catch(() => setRecipient(''));
    }, 350);
    return () => clearTimeout(t);
  }, [phone]);

  const n = Number(amount.replace(/\D/g, ''));
  useEffect(() => {
    setQuote(null);
    if (!n) return;
    const t = setTimeout(() => {
      api<Quote>(`/fees/quote?type=transfer&amount=${n}`).then(setQuote).catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [n]);

  const balance = me?.wallet.balance ?? 0;
  const tooMuch = quote ? quote.totalDebited > balance : false;

  const submit = async (pin: string) => {
    const r = await api<{ transaction: Transaction }>('/transfers', {
      body: { toPhone: phone, amount: n, pin, note: note || undefined },
      idempotencyKey: idem.current,
    });
    setConfirming(false);
    router.replace({
      pathname: '/receipt',
      params: { title: 'Argent envoyé', amount: String(r.transaction.amount), fee: String(r.transaction.fee), to: recipient ?? phone, reference: r.transaction.reference },
    });
  };

  return (
    <Screen>
      <Field label="Numéro du bénéficiaire" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
      {recipient ? <Text style={{ color: colors.success, fontWeight: '700', marginTop: -8, marginBottom: 14 }}>✓ {recipient}</Text> : null}
      {recipient === '' ? <ErrorText>Aucun compte SahelPay avec ce numéro</ErrorText> : null}
      <Field label="Montant (FCFA)" keyboardType="number-pad" value={amount} onChangeText={setAmount} placeholder="5 000" />
      <Field label="Motif (facultatif)" value={note} onChangeText={setNote} maxLength={140} />
      {quote ? (
        <Card>
          <Row label="Montant" value={money(quote.amount)} />
          <Row label="Frais" value={quote.fee === 0 ? 'Gratuit' : money(quote.fee)} />
          <Row label="Total débité" value={money(quote.totalDebited)} strong />
        </Card>
      ) : null}
      {tooMuch ? <ErrorText>{`Solde insuffisant (${money(balance)})`}</ErrorText> : null}
      <ErrorText>{error}</ErrorText>
      <Button title="Envoyer" disabled={!recipient || !n || tooMuch} onPress={() => { setError(null); setConfirming(true); }} />
      <PinConfirm
        visible={confirming}
        title={`Envoyer ${money(n)}`}
        summary={<Text style={{ textAlign: 'center', color: colors.muted, marginTop: 4 }}>à {recipient} ({phone})</Text>}
        onSubmit={submit}
        onClose={() => setConfirming(false)}
      />
    </Screen>
  );
}
