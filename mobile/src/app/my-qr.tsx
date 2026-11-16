import { Share, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Button, Screen } from '../components/ui';
import { useAuth } from '../lib/auth';
import { colors } from '../lib/theme';

export default function MyQr() {
  const { me } = useAuth();
  if (!me) return null;
  const { user } = me;
  const label = user.role === 'customer' ? user.phone : user.publicCode;
  const hint = user.role === 'merchant'
    ? 'Vos clients scannent ce code pour vous payer. Imprimez-le et affichez-le en caisse.'
    : user.role === 'agent'
      ? 'Les clients scannent ce code pour retirer de l\'argent chez vous.'
      : 'Faites scanner ce code pour recevoir de l\'argent.';

  return (
    <Screen>
      <View style={{ alignItems: 'center', backgroundColor: colors.card, borderRadius: 24, padding: 28 }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text, marginBottom: 4 }}>{user.businessName ?? user.fullName}</Text>
        <Text style={{ color: colors.muted, marginBottom: 20, fontSize: 16, fontWeight: '600' }}>{label}</Text>
        <QRCode value={me.qr} size={240} color={colors.text} />
        <Text style={{ color: colors.muted, textAlign: 'center', marginTop: 20, lineHeight: 21 }}>{hint}</Text>
      </View>
      <Button title="Partager mon code" variant="ghost" onPress={() => Share.share({ message: `Payez-moi sur SahelPay : ${label}` })} />
    </Screen>
  );
}
