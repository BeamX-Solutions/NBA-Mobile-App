import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamily, fontSize, fontWeight, palette, spacing } from '@/theme/tokens';

/**
 * Persistent bar shown while the device has no usable connection.
 *
 * The calculator is designed to work offline, so being disconnected is not an
 * error state here: it is a mode in which some things still work and others
 * silently will not. Saying which is the point of the banner. Without it a
 * failed upload looks like a bug rather than a missing connection.
 */
export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      // isInternetReachable is null while unknown; only treat an explicit
      // false as offline so the banner does not flash on startup.
      const reachable = state.isInternetReachable;
      setOffline(state.isConnected === false || reachable === false);
    });
    return unsubscribe;
  }, []);

  if (!offline) {
    return null;
  }

  return (
    <View style={[styles.bar, { paddingTop: insets.top + spacing.xs }]} accessibilityRole="alert">
      <MaterialIcons name="cloud-off" size={16} color={palette.textInverse} />
      <Text style={styles.text}>
        You are offline. The calculator still works; receipts and uploads will not.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: palette.text,
  },
  text: {
    flex: 1,
    fontSize: fontSize.caption,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.textInverse,
  },
});
