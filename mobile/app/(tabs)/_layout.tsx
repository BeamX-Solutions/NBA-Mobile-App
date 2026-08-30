import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/ui/AppHeader';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

/**
 * Icons come from @expo/vector-icons rather than expo-symbols.
 *
 * expo-symbols wraps SF Symbols, which are an Apple technology: on this SDK
 * it renders only a `fallback` prop on Android, so the tab bar would have
 * been blank there. MaterialIcons ships with Expo and renders identically on
 * iOS, Android and web.
 */
type IconName = ComponentProps<typeof MaterialIcons>['name'];

/**
 * `title` is the tab bar label. The top bar carries no title at all: each
 * screen renders its own heading, and duplicating it there is what let four
 * different product names drift into the app.
 */
const tabs: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: 'Calculator', icon: 'calculate' },
  { name: 'transactions', title: 'Transactions', icon: 'receipt-long' },
  { name: 'certificates', title: 'Certificates', icon: 'verified' },
  { name: 'profile', title: 'Profile', icon: 'person' },
];

export default function TabLayout() {
  // The tab bar sits over the home indicator on gesture-navigation devices.
  // Without adding the bottom inset to both the height and the padding, the
  // labels are pushed into that strip and clipped by the edge of the screen.
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.textMuted,
        // The mockups mark the active tab with an amber pill behind the icon
        // and label. tabBarItemStyle rounds the highlighted area into it.
        tabBarActiveBackgroundColor: palette.accent,
        tabBarItemStyle: {
          borderRadius: radius.button,
          marginHorizontal: spacing.xs,
          marginVertical: spacing.xs,
        },
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
          height: 68 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: spacing.xs,
        },
        tabBarLabelStyle: {
          fontSize: fontSize.caption,
          fontFamily: fontFamily.bodySemibold,
          fontWeight: fontWeight.semibold,
          marginBottom: spacing.xs,
        },
      }}>
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            header: () => <AppHeader />,
            tabBarIcon: ({ color }) => (
              <MaterialIcons name={tab.icon} size={24} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
