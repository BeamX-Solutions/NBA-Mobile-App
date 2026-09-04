import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { DetailRow, Screen, ScreenHeading } from '@/components/ui/Screen';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { ATTRIBUTION, PRODUCT_NAME } from '@/lib/branding';
import { documentTypeLabels, type DocumentType } from '@/lib/fees';
import { supabase } from '@/lib/supabase';
import type { VerificationResult } from '@/lib/verification';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

type Status = 'idle' | 'checking' | 'valid' | 'revoked' | 'notFound' | 'error';

/**
 * Public verification of a Certificate of Compliance.
 *
 * Deliberately outside every auth guard: the people who most need this, a land
 * registry clerk or opposing counsel, will never have an account. It reads
 * through the verify_rbin database function, which returns only what
 * establishes authenticity and never the consideration or the party names.
 */
export default function VerifyScreen() {
  const params = useLocalSearchParams<{ rbin?: string }>();
  const initial = typeof params.rbin === 'string' ? decodeURIComponent(params.rbin) : '';

  const [input, setInput] = useState(initial);
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<VerificationResult | null>(null);

  const check = useCallback(async (rbin: string) => {
    const trimmed = rbin.trim();
    if (trimmed === '') {
      return;
    }
    setStatus('checking');
    setResult(null);

    const { data, error } = await supabase.rpc('verify_rbin', { p_rbin: trimmed });

    if (error) {
      setStatus('error');
      return;
    }

    const rows = (data ?? []) as VerificationResult[];
    if (rows.length === 0) {
      setStatus('notFound');
      return;
    }

    setResult(rows[0]);
    setStatus(rows[0].revoked ? 'revoked' : 'valid');
  }, []);

  // Scanning the QR code lands here with the RBIN already in the path, so the
  // check runs without the user doing anything.
  useEffect(() => {
    if (initial !== '') {
      check(initial);
    }
  }, [initial, check]);

  return (
    <Screen>
      <View style={styles.brand}>
        <Image
          source={require('@/assets/images/nba-logo.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </View>

      <ScreenHeading
        title="Verify a Certificate"
        subtitle="Enter the Bar Association Identification Number printed on a Certificate of Compliance."
      />

      <Card>
        <TextField
          label="RBIN"
          placeholder="NBA/2026/00042"
          autoCapitalize="characters"
          autoCorrect={false}
          value={input}
          onChangeText={setInput}
        />
        <Button
          label="Verify"
          onPress={() => check(input)}
          loading={status === 'checking'}
          disabled={input.trim() === ''}
        />
      </Card>

      {status === 'checking' ? <LoadingState label="Checking the register" /> : null}

      {status === 'error' ? (
        <ErrorState
          body="The register could not be reached. This does not mean the certificate is invalid."
          onRetry={() => check(input)}
        />
      ) : null}

      {status === 'notFound' ? (
        <Card style={styles.resultCard}>
          <View style={[styles.banner, styles.bannerBad]}>
            <MaterialIcons name="gpp-bad" size={28} color={palette.danger} />
            <Text style={[styles.bannerText, styles.bannerTextBad]}>No such certificate</Text>
          </View>
          <Text style={styles.explain}>
            No issued certificate carries this RBIN. Check the number for transcription errors,
            particularly the year. If it is correct as printed, the document should not be relied
            on and the issuing branch should be contacted.
          </Text>
        </Card>
      ) : null}

      {result !== null && (status === 'valid' || status === 'revoked') ? (
        <Card style={styles.resultCard}>
          <View style={[styles.banner, status === 'valid' ? styles.bannerGood : styles.bannerBad]}>
            <MaterialIcons
              name={status === 'valid' ? 'verified' : 'gpp-bad'}
              size={28}
              color={status === 'valid' ? palette.primary : palette.danger}
            />
            <Text
              style={[
                styles.bannerText,
                status === 'valid' ? styles.bannerTextGood : styles.bannerTextBad,
              ]}>
              {status === 'valid' ? 'Genuine certificate' : 'Certificate revoked'}
            </Text>
          </View>

          {status === 'revoked' ? (
            <Text style={styles.explain}>
              This certificate was issued but has since been revoked
              {result.revocation_reason !== null ? `: ${result.revocation_reason}` : '.'} It should
              not be relied on.
            </Text>
          ) : null}

          <DetailRow label="RBIN" value={result.rbin} emphasise />
          <DetailRow label="Certificate Number" value={result.certificate_number} />
          <DetailRow label="Practitioner" value={result.practitioner_name} />
          <DetailRow label="Supreme Court Number" value={result.scn ?? 'Not recorded'} />
          <DetailRow
            label="Document Type"
            value={
              documentTypeLabels[result.document_type as DocumentType] ?? result.document_type
            }
          />
          <DetailRow label="Issuing Branch" value={result.branch_name} />
          <DetailRow
            label="Date of Issue"
            value={new Date(result.issued_at).toLocaleDateString('en-NG', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          />

          {/*
            States plainly what has and has not been established. A verifier
            should not infer that the transaction terms were checked: they
            were not, and the register does not hold them for disclosure.
          */}
          <Text style={styles.scope}>
            This confirms that the certificate was issued by the branch shown, to the practitioner
            shown, on the date shown. The consideration and the names of the parties are not
            disclosed. It is not confirmation that any fee was correctly assessed.
          </Text>
        </Card>
      ) : null}

      <Text style={styles.footer}>
        {PRODUCT_NAME} - {ATTRIBUTION}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  logo: {
    width: 60,
    height: 60,
  },
  resultCard: {
    marginTop: spacing.lg,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.input,
    marginBottom: spacing.md,
  },
  bannerGood: {
    backgroundColor: palette.successSurface,
  },
  bannerBad: {
    backgroundColor: palette.dangerSurface,
  },
  bannerText: {
    fontSize: fontSize.bodyLarge,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
  },
  bannerTextGood: {
    color: palette.primary,
  },
  bannerTextBad: {
    color: palette.danger,
  },
  explain: {
    fontSize: fontSize.body,
    color: palette.text,
    lineHeight: 21,
    marginBottom: spacing.md,
  },
  scope: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    lineHeight: 17,
    marginTop: spacing.lg,
  },
  footer: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
