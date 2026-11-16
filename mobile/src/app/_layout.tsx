import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../lib/auth';
import { colors } from '../lib/theme';

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
          headerBackTitle: 'Retour',
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
        <Stack.Screen name="otp" options={{ title: 'Vérification' }} />
        <Stack.Screen name="register" options={{ title: 'Créer mon compte' }} />
        <Stack.Screen name="login" options={{ title: 'Connexion' }} />
        <Stack.Screen name="home" options={{ headerShown: false }} />
        <Stack.Screen name="send" options={{ title: 'Envoyer de l\'argent' }} />
        <Stack.Screen name="scan" options={{ title: 'Scanner', headerShown: false }} />
        <Stack.Screen name="pay" options={{ title: 'Payer' }} />
        <Stack.Screen name="cash-in" options={{ title: 'Dépôt client' }} />
        <Stack.Screen name="history" options={{ title: 'Historique' }} />
        <Stack.Screen name="my-qr" options={{ title: 'Mon QR code' }} />
        <Stack.Screen name="profile" options={{ title: 'Mon profil' }} />
        <Stack.Screen name="receipt" options={{ headerShown: false, gestureEnabled: false }} />
      </Stack>
    </AuthProvider>
  );
}
