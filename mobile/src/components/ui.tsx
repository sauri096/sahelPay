import { ReactNode, useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput,
  TextInputProps, View, ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HistoryItem } from '../lib/api';
import { dateTime, money, txLabel } from '../lib/format';
import { colors, radius } from '../lib/theme';

export function Screen({ children, scroll = true, style }: { children: ReactNode; scroll?: boolean; style?: ViewStyle }) {
  const body = <View style={[styles.screenInner, style]}>{children}</View>;
  return (
    <SafeAreaView style={styles.screen} edges={['bottom', 'left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>{body}</ScrollView> : body}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Title({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={styles.title}>{children}</Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
  );
}

export function Button({
  title, onPress, loading, disabled, variant = 'primary',
}: { title: string; onPress: () => void; loading?: boolean; disabled?: boolean; variant?: 'primary' | 'ghost' | 'danger' }) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.btn,
        variant === 'ghost' && styles.btnGhost,
        variant === 'danger' && { backgroundColor: colors.danger },
        off && { opacity: 0.5 },
        pressed && { opacity: 0.85 },
      ]}
    >
      {loading ? <ActivityIndicator color={variant === 'ghost' ? colors.primary : '#fff'} />
        : <Text style={[styles.btnText, variant === 'ghost' && { color: colors.primary }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} style={[styles.input, error ? { borderColor: colors.danger } : null]} {...props} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function ErrorText({ children }: { children?: string | null }) {
  return children ? <Text style={[styles.error, { marginBottom: 12 }]}>{children}</Text> : null;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, strong && { fontWeight: '800', fontSize: 17 }]}>{value}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Clavier PIN (4 chiffres)
// ---------------------------------------------------------------------------
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

export function PinPad({ onComplete, disabled, resetSignal }: { onComplete: (pin: string) => void; disabled?: boolean; resetSignal?: number }) {
  const [pin, setPin] = useState('');
  useEffect(() => setPin(''), [resetSignal]);

  const press = (k: string) => {
    if (disabled || !k) return;
    if (k === '⌫') return setPin((p) => p.slice(0, -1));
    setPin((p) => {
      const next = (p + k).slice(0, 4);
      if (next.length === 4) setTimeout(() => onComplete(next), 80);
      return next;
    });
  };

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={styles.dots}>
        {[0, 1, 2, 3].map((i) => <View key={i} style={[styles.dot, i < pin.length && styles.dotOn]} />)}
      </View>
      <View style={styles.pad}>
        {KEYS.map((k, i) => (
          <Pressable key={i} onPress={() => press(k)} style={({ pressed }) => [styles.key, pressed && k ? { backgroundColor: colors.border } : null]}>
            <Text style={styles.keyText}>{k}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** Fenêtre de confirmation par PIN avant tout débit. */
export function PinConfirm({
  visible, title, summary, onSubmit, onClose,
}: {
  visible: boolean; title: string; summary?: ReactNode;
  onSubmit: (pin: string) => Promise<void>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reset, setReset] = useState(0);

  useEffect(() => {
    if (visible) { setError(null); setReset((r) => r + 1); }
  }, [visible]);

  const submit = async (pin: string) => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(pin);
    } catch (e: any) {
      setError(e.message);
      setReset((r) => r + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheet}>
          <Text style={[styles.title, { fontSize: 20, textAlign: 'center' }]}>{title}</Text>
          {summary}
          <Text style={[styles.sub, { textAlign: 'center', marginVertical: 8 }]}>Entrez votre code PIN pour confirmer</Text>
          <ErrorText>{error}</ErrorText>
          {busy ? <ActivityIndicator style={{ marginVertical: 12 }} color={colors.primary} /> : null}
          <PinPad onComplete={submit} disabled={busy} resetSignal={reset} />
          <Button title="Annuler" variant="ghost" onPress={onClose} disabled={busy} />
        </View>
      </View>
    </Modal>
  );
}

export function TxRow({ t, currency }: { t: HistoryItem; currency: string }) {
  const incoming = t.net > 0;
  return (
    <View style={styles.tx}>
      <View style={[styles.txIcon, { backgroundColor: incoming ? '#E3F4EA' : '#F3ECE2' }]}>
        <Text style={{ fontSize: 16 }}>{incoming ? '↓' : '↑'}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.txTitle} numberOfLines={1}>{txLabel(t)}</Text>
        <Text style={styles.txSub}>{dateTime(t.createdAt)}{t.status === 'reversed' ? ' · annulée' : ''}</Text>
      </View>
      <Text style={[styles.txAmount, { color: incoming ? colors.success : colors.text }]}>
        {incoming ? '+' : '−'}{money(Math.abs(t.net), currency)}
      </Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenInner: { flex: 1, padding: 20 },
  title: { fontSize: 26, fontWeight: '800', color: colors.text },
  sub: { fontSize: 15, color: colors.muted, marginTop: 6, lineHeight: 21 },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  btnGhost: { backgroundColor: 'transparent' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 6 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: 14, paddingVertical: 14, fontSize: 17, color: colors.text,
  },
  error: { color: colors.danger, fontSize: 14, marginTop: 4 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 18, marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  rowLabel: { color: colors.muted, fontSize: 15 },
  rowValue: { color: colors.text, fontSize: 15, fontWeight: '600' },
  dots: { flexDirection: 'row', gap: 16, marginVertical: 20 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.primary },
  dotOn: { backgroundColor: colors.primary },
  pad: { flexDirection: 'row', flexWrap: 'wrap', width: 288, justifyContent: 'center' },
  key: { width: 96, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 32 },
  keyText: { fontSize: 26, fontWeight: '600', color: colors.text },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
  tx: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  txIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  txTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  txSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  txAmount: { fontSize: 15, fontWeight: '700' },
});
