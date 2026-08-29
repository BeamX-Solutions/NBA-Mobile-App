import { useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { ATTRIBUTION, PRODUCT_NAME } from '@/lib/branding';
import { useOnboardingSeen } from '@/lib/onboarding';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

interface Slide {
  image: ImageSourcePropType;
  title: string;
  body: string;
}

/**
 * Three slides covering what the app does end to end. The concepts are not
 * self evident even to lawyers: that the amount a fee is charged on differs
 * by instrument, that the figure is a prescribed minimum rather than a quote,
 * and that a certificate only arrives once the branch has verified payment.
 *
 * Photographs are bundled rather than fetched at runtime, so the slides render
 * instantly and work with no connection. All three are from Unsplash, whose
 * licence permits commercial use without attribution. Each was reviewed
 * individually: a search for "certificate" also returns real people's military
 * discharge papers and trademarked fan art, neither of which belongs in a
 * legal compliance product.
 */
const slides: readonly Slide[] = [
  {
    image: require('@/assets/images/onboarding-calculate.jpg'),
    title: 'Calculate the prescribed minimum',
    body: 'Choose the instrument and enter the amount it is charged on: the consideration, the loan, or one year of rent. The fee is computed under the Remuneration Order, band by band, and shown in full.',
  },
  {
    image: require('@/assets/images/onboarding-submit.jpg'),
    title: 'Pay your branch and upload proof',
    body: 'Generate a receipt showing what is payable to your branch, pay by transfer, then attach the payment slip for your branch to review.',
  },
  {
    image: require('@/assets/images/onboarding-certificate.jpg'),
    title: 'Receive your Certificate of Compliance',
    body: 'Once your branch verifies payment you are issued a Bar Association Identification Number and a Certificate of Compliance, available to download at any time.',
  },
];

const { width } = Dimensions.get('window');

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { markSeen } = useOnboardingSeen();
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const isLast = index === slides.length - 1;

  // No navigation call here. Marking the slides seen flips the guard in the
  // root layout, which unmounts this group and mounts (auth) on its own. That
  // is the same pattern the session uses, and it avoids navigating to a route
  // that is not mounted yet.
  async function finish() {
    await markSeen();
  }

  function next() {
    if (isLast) {
      finish();
      return;
    }
    const target = index + 1;
    setIndex(target);
    scrollRef.current?.scrollTo({ x: target * width, animated: true });
  }

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const page = Math.round(event.nativeEvent.contentOffset.x / width);
    if (page !== index) {
      setIndex(page);
    }
  }

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        style={styles.pager}>
        {slides.map((slide) => (
          <View key={slide.title} style={[styles.slide, { width }]}>
            <Image source={slide.image} style={styles.image} resizeMode="cover" />
            {/* Softens the bottom of the photo into the page so the text sits
                on a clean ground regardless of what the image contains. */}
            <View style={styles.imageFade} />

            <View style={styles.copy}>
              <Text style={styles.title}>{slide.title}</Text>
              <Text style={styles.body}>{slide.body}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.topBar, { top: insets.top + spacing.sm }]}>
        <Image
          source={require('@/assets/images/nba-logo.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Skip onboarding"
          onPress={finish}
          hitSlop={12}
          style={styles.skipButton}>
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.dots}>
          {slides.map((slide, slideIndex) => (
            <View
              key={slide.title}
              style={[styles.dot, slideIndex === index && styles.dotActive]}
            />
          ))}
        </View>

        <Button label={isLast ? 'Get started' : 'Next'} onPress={next} />

        <Text style={styles.attribution}>
          {PRODUCT_NAME} - {ATTRIBUTION}
        </Text>
      </View>
    </View>
  );
}

const IMAGE_HEIGHT = 340;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.background,
  },
  pager: {
    flexGrow: 0,
  },
  slide: {
    flex: 1,
  },
  image: {
    width: '100%',
    height: IMAGE_HEIGHT,
  },
  imageFade: {
    position: 'absolute',
    top: IMAGE_HEIGHT - 28,
    left: 0,
    right: 0,
    height: 32,
    backgroundColor: palette.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  copy: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  title: {
    fontSize: fontSize.heading,
    fontFamily: fontFamily.headingBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
    textAlign: 'center',
  },
  body: {
    fontSize: fontSize.bodyLarge,
    color: palette.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 24,
  },
  topBar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logo: {
    width: 44,
    height: 44,
  },
  skipButton: {
    backgroundColor: palette.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  skip: {
    fontSize: fontSize.label,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.text,
  },
  footer: {
    marginTop: 'auto',
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: palette.borderStrong,
  },
  dotActive: {
    width: 22,
    backgroundColor: palette.primary,
  },
  attribution: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    textAlign: 'center',
  },
});
