import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Whether the onboarding slides have been seen.
 *
 * Stored on the device rather than the profile deliberately: it describes
 * "has this person used this app before", not their account, and it has to
 * work before anyone has signed in.
 *
 * This is a context rather than a bare hook because two consumers need the
 * SAME state: the root layout, which decides whether to mount the slides, and
 * the slides themselves, which mark them seen. With a plain hook each caller
 * got its own useState, so marking them seen updated only the screen's copy,
 * the layout kept rendering the slides, and the Skip and Get started buttons
 * appeared to do nothing.
 */
const STORAGE_KEY = 'onboarding.seen.v1';

interface OnboardingState {
  /** Undefined while still reading from storage. */
  seen: boolean | undefined;
  markSeen: () => Promise<void>;
}

const OnboardingContext = createContext<OnboardingState | undefined>(undefined);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [seen, setSeen] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => setSeen(value === 'true'))
      // A storage failure must not lock anyone out. Treat it as already seen
      // so the user still reaches the login screen.
      .catch(() => setSeen(true));
  }, []);

  const markSeen = useCallback(async () => {
    // Set state first so the navigator swaps groups immediately, rather than
    // waiting on the disk write.
    setSeen(true);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // Losing the flag only means the slides show again next launch.
    }
  }, []);

  const value = useMemo(() => ({ seen, markSeen }), [seen, markSeen]);

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboardingSeen(): OnboardingState {
  const context = useContext(OnboardingContext);
  if (context === undefined) {
    throw new Error('useOnboardingSeen must be used inside OnboardingProvider');
  }
  return context;
}
