import { DarkTheme, Stack, ThemeProvider, type Theme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { NoticeToast } from '@/components/ui/NoticeToast';
import { initializeApp } from '@/store/bindings';
import { colors } from '@/theme/theme';

const theme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.danger,
  },
};

export default function RootLayout() {
  // Wire services → store and start Bluetooth monitoring once for the app's lifetime.
  useEffect(() => initializeApp(), []);

  return (
    <KeyboardProvider>
      <ThemeProvider value={theme}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
            <Stack.Screen name="(tabs)" />
          </Stack>
          <NoticeToast />
        </View>
      </ThemeProvider>
    </KeyboardProvider>
  );
}

export { ErrorBoundary } from 'expo-router';
