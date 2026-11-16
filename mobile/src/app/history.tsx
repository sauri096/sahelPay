import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { TxRow } from '../components/ui';
import { api, HistoryItem } from '../lib/api';
import { useAuth } from '../lib/auth';
import { colors } from '../lib/theme';

export default function History() {
  const { me } = useAuth();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);

  const loadMore = useCallback(async (reset = false) => {
    setLoading(true);
    const before = !reset && items.length ? `&before=${encodeURIComponent(items[items.length - 1].createdAt)}` : '';
    const r = await api<{ items: HistoryItem[] }>(`/transactions?limit=30${before}`).catch(() => ({ items: [] }));
    setItems((prev) => (reset ? r.items : [...prev, ...r.items]));
    setDone(r.items.length < 30);
    setLoading(false);
  }, [items]);

  useEffect(() => { loadMore(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 20 }}
      data={items}
      keyExtractor={(t) => t.id + t.net}
      renderItem={({ item }) => (
        <View style={{ backgroundColor: colors.card, borderRadius: 14, paddingHorizontal: 14, marginBottom: 8 }}>
          <TxRow t={item} currency={me?.wallet.currency ?? 'XOF'} />
          <Text style={{ color: colors.muted, fontSize: 12, paddingBottom: 10 }}>
            Réf {item.reference}{item.fee > 0 && item.direction === 'out' ? ` · frais ${item.fee} F` : ''}
            {item.description ? ` · ${item.description}` : ''}
          </Text>
        </View>
      )}
      onEndReached={() => { if (!loading && !done) loadMore(); }}
      ListEmptyComponent={loading ? undefined : <Text style={{ color: colors.muted, textAlign: 'center' }}>Aucune opération.</Text>}
      ListFooterComponent={loading ? <ActivityIndicator color={colors.primary} /> : undefined}
    />
  );
}
