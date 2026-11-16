import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { Button, Card, ErrorText, Field, PinConfirm, Row, Screen, Title } from '../components/ui';
import { api, newIdempotencyKey, Transaction } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money } from '../lib/format';
import { colors } from '../lib/theme';

interface Quote { amount: number; fee: number; totalDebited: number; feePaidBy: 'sender' | 'merchant' }

/** Paiement marchand ou retrait chez un agent, après scan du QR code. */
export default function Pay() {
  const { kind, code } = useLocalSearchParams<{ kind: 'merchant' | 'cashout'; code: string }>();
  const { me } = useAuth();
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [confirming, setConfirming] = useState(false);
  const idem = useRef(newIdempotencyKey());
  const isCashout = kind === 'cashout';

  useEffect(() => {
    api<{ name: string; role: string }>(`/codes/${encodeURIComponent(code)}`)
      .then((r) => setName(r.name))
      .catch((e) => setError(e.message));
  }, [code]);

  const n = Number(amount.replace(/\D/g, ''));
  useEffect(() => {
    setQuote(null);
    if (!n) return;
    const t = setTimeout(() => {
      api<Quote>(`/fees/quote?type=${isCashout ? 'cash_out' : 'merchant_payment'}&amount=${n}`).then(setQuote).catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [n, isCashout]);

  const balance = me?.wallet.balance ?? 0;
  const tooMuch = quote ? quote.totalDebited > balance : false;

  const submit = async (pin: string) => {
    const r = await api<{ transaction: Transaction }>(isCashout ? '/cash-out' : '/payments/merchant', {
      body: isCashout ? { agentCode: code, amount: n, pin } : { merchantCode: code, amount: n, pin },
      idempotencyKey: idem.current,
    });
    setConfirming(false);
    router.replace({
      pathname: '/receipt',
      params: {
        title: isCashout ? 'Retrait validé' : 'Paiement effectué',
        subtitle: isCashout ? 'L\'agent doit maintenant vous remettre les espèces.' : '',
        amount: String(r.transaction.amount),
        fee: String(isCashout ? r.transaction.fee : 0),
        to: name ?? code,
        reference: r.transaction.reference,
      },
    });
  };

  if (error && !name) {
    return (
      <Screen>
        <Title>Code invalide</Title>
        <ErrorText>{error}</ErrorText>
        <Button title="Retour" onPress={() => router.back()} />
      </Screen>
    );
  }
  if (!name) return <Screen><ActivityIndicator color={colors.primary} /></Screen>;

  return (
    <Screen>
      <Title sub={code}>{isCashout ? `Retrait chez ${name}` : `Payer ${name}`}</Title>
      <Field label="Montant (FCFA)" keyboardType="number-pad" value={amount} onChangeText={setAmount} autoFocus />
      {quote ? (
        <Card>
          <Row label="Montant" value={money(quote.amount)} />
          {quote.feePaidBy === 'sender' ? <Row label="Frais (1 %)" value={money(quote.fee)} /> : <Row label="Frais" value="Aucun pour vous" />}
          <Row label="Total débité" value={money(quote.totalDebited)} strong />
        </Card>
      ) : null}
      {tooMuch ? <ErrorText>{`Solde insuffisant (${money(balance)})`}</ErrorText> : null}
      <Button title={isCashout ? 'Retirer' : 'Payer'} disabled={!n || tooMuch} onPress={() => setConfirming(true)} />
      <PinConfirm
        visible={confirming}
        title={`${isCashout ? 'Retirer' : 'Payer'} ${money(n)}`}
        summary={<Text style={{ textAlign: 'center', color: colors.muted, marginTop: 4 }}>{name}</Text>}
        onSubmit={submit}
        onClose={() => setConfirming(false)}
      />
    </Screen>
  );
}
