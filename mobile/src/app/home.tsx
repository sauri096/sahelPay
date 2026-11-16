import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { Card, TxRow } from '../components/ui';
import { api, HistoryItem } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money } from '../lib/format';
import { colors, radius } from '../lib/theme';

export default function Home() {
  const { me, refresh } = useAuth();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [hidden, setHidden] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    await refresh().catch(() => undefined);
    const r = await api<{ items: HistoryItem[] }>('/transactions?limit=8').catch(() => ({ items: [] }));
    setItems(r.items);
  }, [refresh]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!me) return null;
  const { user, wallet } = me;
  const role = user.role;

  const actions: { label: string; icon: string; to: () => void }[] =
    role === 'agent'
      ? [
        { label: 'Dépôt client', icon: '⬇', to: () => router.push('/cash-in') },
        { label: 'Mon QR', icon: '▣', to: () => router.push('/my-qr') },
        { label: 'Historique', icon: '☰', to: () => router.push('/history') },
      ]
      : role === 'merchant'
        ? [
          { label: 'Encaisser', icon: '▣', to: () => router.push('/my-qr') },
          { label: 'Envoyer', icon: '↗', to: () => router.push('/send') },
          { label: 'Historique', icon: '☰', to: () => router.push('/history') },
        ]
        : [
          { label: 'Envoyer', icon: '↗', to: () => router.push('/send') },
          { label: 'Scanner', icon: '⌗', to: () => router.push('/scan') },
          { label: 'Retirer', icon: '⬆', to: () => router.push({ pathname: '/scan', params: { intent: 'cashout' } }) },
          { label: 'Historique', icon: '☰', to: () => router.push('/history') },
        ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.primary }} edges={['top']}>
      <ScrollView
        style={{ backgroundColor: colors.bg }}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        <View style={s.header}>
          <View style={s.topRow}>
            <View>
              <Text style={s.hello}>Bonjour {user.fullName.split(' ')[0]}</Text>
              {user.businessName ? <Text style={s.business}>{user.businessName} · {user.publicCode}</Text> : null}
            </View>
            <Pressable onPress={() => router.push('/profile')} style={s.avatar} accessibilityLabel="Profil">
              <Text style={{ color: colors.primary, fontWeight: '800' }}>{user.fullName.slice(0, 1).toUpperCase()}</Text>
            </Pressable>
          </View>

          <Pressable onPress={() => setHidden((h) => !h)} accessibilityLabel="Afficher ou masquer le solde">
            <Text style={s.balanceLabel}>{role === 'agent' ? 'Float disponible' : 'Solde'} · touchez pour {hidden ? 'afficher' : 'masquer'}</Text>
            <Text style={s.balance}>{hidden ? '••••••' : money(wallet.balance, wallet.currency)}</Text>
          </Pressable>

          {role === 'customer' ? (
            <Pressable style={s.qrCard} onPress={() => router.push('/my-qr')}>
              <QRCode value={me.qr} size={140} />
              <Text style={s.qrHint}>Montrez ce code pour recevoir de l'argent</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={s.actions}>
          {actions.map((a) => (
            <Pressable key={a.label} onPress={a.to} style={s.action}>
              <View style={s.actionIcon}><Text style={{ fontSize: 22, color: colors.primary }}>{a.icon}</Text></View>
              <Text style={s.actionLabel}>{a.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ paddingHorizontal: 20 }}>
          {me.limits && user.kycLevel === 0 ? (
            <Pressable onPress={() => router.push('/profile')}>
              <Card style={{ backgroundColor: '#FFF4E0' }}>
                <Text style={{ fontWeight: '700', color: colors.text }}>Augmentez vos plafonds</Text>
                <Text style={{ color: colors.muted, marginTop: 4 }}>
                  Plafond actuel : {money(me.limits.dailyOut)} / jour. Vérifiez votre pièce d'identité →
                </Text>
              </Card>
            </Pressable>
          ) : null}
          <Card>
            <Text style={{ fontWeight: '800', fontSize: 17, color: colors.text, marginBottom: 4 }}>Opérations récentes</Text>
            {items.length === 0 ? <Text style={{ color: colors.muted, paddingVertical: 12 }}>Aucune opération pour le moment.</Text> : null}
            {items.map((t) => <TxRow key={t.id + t.net} t={t} currency={wallet.currency} />)}
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { backgroundColor: colors.primary, padding: 20, paddingBottom: 28, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  hello: { color: '#fff', fontSize: 20, fontWeight: '700' },
  business: { color: '#CFE8DE', marginTop: 2 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  balanceLabel: { color: '#CFE8DE', fontSize: 13 },
  balance: { color: '#fff', fontSize: 38, fontWeight: '900', marginTop: 4 },
  qrCard: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 16, alignItems: 'center', marginTop: 18 },
  qrHint: { color: colors.muted, marginTop: 10, fontSize: 13 },
  actions: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 20, paddingHorizontal: 10 },
  action: { alignItems: 'center', width: 80 },
  actionIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#E6F2ED', alignItems: 'center', justifyContent: 'center' },
  actionLabel: { marginTop: 8, fontSize: 13, fontWeight: '600', color: colors.text, textAlign: 'center' },
});
