import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, Card, ErrorText, Field, Row, Screen } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money } from '../lib/format';
import { colors, radius } from '../lib/theme';

const DOCS = [['cni', 'Carte d\'identité'], ['passport', 'Passeport'], ['carte_consulaire', 'Carte consulaire'], ['permis', 'Permis']] as const;
const ROLE_LABEL = { customer: 'Particulier', merchant: 'Commerçant', agent: 'Agent', admin: 'Administrateur' };

export default function Profile() {
  const { me, signOut } = useAuth();
  const [docType, setDocType] = useState<string>('cni');
  const [docNumber, setDocNumber] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const { user, limits } = me;

  const submitKyc = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/kyc', { body: { docType, docNumber } });
      setMsg('Demande envoyée. Vous serez notifié après vérification.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <Row label="Nom" value={user.fullName} />
        <Row label="Téléphone" value={user.phone} />
        <Row label="Type de compte" value={ROLE_LABEL[user.role]} />
        {user.publicCode ? <Row label="Code" value={user.publicCode} /> : null}
        <Row label="Niveau de vérification" value={user.kycLevel === 0 ? 'Basique' : user.kycLevel === 1 ? 'Vérifié' : 'Premium'} />
      </Card>

      {limits ? (
        <Card>
          <Text style={{ fontWeight: '800', fontSize: 16, color: colors.text, marginBottom: 6 }}>Mes plafonds</Text>
          <Row label="Solde maximum" value={money(limits.maxBalance)} />
          <Row label="Envois par jour" value={money(limits.dailyOut)} />
          <Row label="Utilisé aujourd'hui" value={money(limits.usedToday)} />
        </Card>
      ) : null}

      {user.role === 'customer' && user.kycLevel === 0 ? (
        <Card>
          <Text style={{ fontWeight: '800', fontSize: 16, color: colors.text, marginBottom: 10 }}>Vérifier mon identité</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {DOCS.map(([v, l]) => (
              <Pressable
                key={v}
                onPress={() => setDocType(v)}
                style={{
                  paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.sm, borderWidth: 1.5,
                  borderColor: docType === v ? colors.primary : colors.border, backgroundColor: docType === v ? '#E6F2ED' : colors.card,
                }}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>{l}</Text>
              </Pressable>
            ))}
          </View>
          <Field label="Numéro du document" value={docNumber} onChangeText={setDocNumber} autoCapitalize="characters" />
          <ErrorText>{error}</ErrorText>
          {msg ? <Text style={{ color: colors.success, marginBottom: 8 }}>{msg}</Text> : null}
          <Button title="Envoyer pour vérification" onPress={submitKyc} loading={busy} disabled={docNumber.length < 4 || !!msg} />
        </Card>
      ) : null}

      <Button title="Se déconnecter" variant="danger" onPress={async () => { await signOut(); router.replace('/welcome'); }} />
    </Screen>
  );
}
