import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';

import type { IconName } from '@/components/ui/primitives';
import { colors } from '@/theme/theme';

const TABS: { name: string; title: string; icon: IconName; iconActive: IconName }[] = [
  { name: 'index', title: 'Home', icon: 'happy-outline', iconActive: 'happy' },
  { name: 'control', title: 'Control', icon: 'game-controller-outline', iconActive: 'game-controller' },
  { name: 'companion', title: 'Companion', icon: 'chatbubbles-outline', iconActive: 'chatbubbles' },
  { name: 'sounds', title: 'Sounds', icon: 'musical-notes-outline', iconActive: 'musical-notes' },
  { name: 'settings', title: 'Settings', icon: 'settings-outline', iconActive: 'settings' },
];

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 64, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarAccessibilityLabel: tab.title,
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? tab.iconActive : tab.icon} size={24} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
