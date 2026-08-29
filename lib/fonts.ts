import {
  PlayfairDisplay_600SemiBold,
  PlayfairDisplay_700Bold,
} from '@expo-google-fonts/playfair-display';
import {
  SourceSans3_400Regular,
  SourceSans3_500Medium,
  SourceSans3_600SemiBold,
  SourceSans3_700Bold,
  useFonts,
} from '@expo-google-fonts/source-sans-3';

/**
 * The same families as the NBA Remuneration Portal, so the app and the portal
 * read as one product: Playfair Display for headings, Source Sans 3 for body.
 *
 * Every weight that gets used has to be loaded explicitly. React Native will
 * not synthesise a bold from a regular file for a custom family, so a missing
 * weight silently renders as regular rather than failing loudly.
 */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    PlayfairDisplay_600SemiBold,
    PlayfairDisplay_700Bold,
    SourceSans3_400Regular,
    SourceSans3_500Medium,
    SourceSans3_600SemiBold,
    SourceSans3_700Bold,
  });

  // A font that fails to load must not hold the app on the splash screen
  // forever. Falling back to the system face is a cosmetic loss; an app that
  // never starts is not.
  return loaded || error !== null;
}
