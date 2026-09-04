import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DetailRow, Screen, SectionTitle } from '@/components/ui/Screen';
import { useAuth } from '@/lib/auth-context';
import { CERTIFICATE_ORDER_NAME } from '@/lib/branding';
import type { Certificate, DocumentTypeValue } from '@/lib/database.types';
import { documentTypeLabels, type DocumentType } from '@/lib/fees';
import { formatNaira } from '@/lib/money';
import { shareCertificatePdf } from '@/lib/pdf';
import { supabase } from '@/lib/supabase';
import { verificationUrlFor } from '@/lib/verification';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

interface CertificateDetail extends Certificate {
  transactions: {
    bain: string | null;
    document_type: DocumentTypeValue;
    parties: string;
    consideration: number;
    branch_id: string;
    branches: { name: string; branch_code: string; chairman_name: string | null } | null;
    profiles: { full_name: string; scn: string | null } | null;
  } | null;
}

export default function CertificateDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const [certificate, setCertificate] = useState<CertificateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Declared with the rest, above every early return. React identifies a hook
  // by its call order, so a useState below the loading and not-found returns
  // exists on some renders and not others, and the component crashes the
  // moment it transitions from loading to loaded.
  const [generating, setGenerating] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // This screen shows the holder's own certificate, including the
      // consideration. !inner plus the user_id filter scopes it to the owner:
      // a branch admin is permitted by RLS to read every certificate in the
      // branch, and this is not the screen for that.
      const { data, error: loadError } = await supabase
        .from('certificates')
        .select(
          // profiles is reached through transactions, which references it
          // twice (user_id and verified_by), so the foreign key is named here
          // too or the whole query fails as ambiguous.
          '*, transactions!inner(bain, document_type, parties, consideration, branch_id, user_id, ' +
            'branches(name, branch_code, chairman_name), ' +
            'profiles!transactions_user_id_fkey(full_name, scn))',
        )
        .eq('id', id)
        .eq('transactions.user_id', profile?.id ?? '')
        .single();

      if (loadError) {
        setError('This certificate could not be loaded.');
        return;
      }
      // The nested select is beyond what the untyped client can infer, so the
      // shape is asserted here. Replace with generated types once the schema
      // is pushed and `supabase gen types` can run against it.
      setCertificate(data as unknown as CertificateDetail);
    } finally {
      setLoading(false);
    }
  }, [id, profile?.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <Screen scroll={false} style={styles.centered}>
        <ActivityIndicator color={palette.primary} size="large" />
      </Screen>
    );
  }

  if (certificate === null) {
    return (
      <Screen>
        <Card>
          <Text style={styles.error}>{error ?? 'This certificate could not be found.'}</Text>
        </Card>
      </Screen>
    );
  }

  const transaction = certificate.transactions;
  const revoked = certificate.revoked_at !== null;
  // The QR encodes a lookup by BAIN, so there is nothing to encode until one
  // has been issued.
  const verifyUrl = transaction?.bain != null ? verificationUrlFor(transaction.bain) : null;

  async function handleDownload() {
    if (certificate === null || transaction === null || transaction.bain === null) {
      return;
    }
    setGenerating(true);
    setPdfError(null);
    try {
      await shareCertificatePdf({
        certificateNumber: certificate.certificate_number,
        bain: transaction.bain,
        issuedAt: certificate.issued_at,
        practitionerName: transaction.profiles?.full_name ?? 'Practitioner',
        scn: transaction.profiles?.scn ?? null,
        parties: transaction.parties,
        documentType: transaction.document_type as DocumentType,
        consideration: transaction.consideration,
        branchName: transaction.branches?.name ?? 'NBA Branch',
        chairmanName: transaction.branches?.chairman_name ?? null,
        revoked: certificate.revoked_at !== null,
      });
    } catch (error) {
      setPdfError(
        error instanceof Error ? error.message : 'The PDF could not be generated. Please try again.'
      );
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Screen>
      <View style={styles.certificate}>
        <View style={styles.inner}>
          <Image
            source={require('@/assets/images/nba-logo.png')}
            style={styles.seal}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
          <Text style={styles.org}>NIGERIAN BAR ASSOCIATION</Text>
          <Text style={styles.certTitle}>CERTIFICATE OF COMPLIANCE</Text>

          <View style={styles.rule} />

          {/* The branch's own wording, at its instruction. The calculator still
              cites the statutory instrument, because that is where the figures
              come from; this recites the compliance regime the branch issues
              under. Two different claims, two different constants. */}
          <Text style={styles.recital}>
            This is to certify that the legal instrument described below has been prepared in
            accordance with the Rules of Professional Conduct, the Legal Practitioners Act and the {CERTIFICATE_ORDER_NAME}.
          </Text>

          {revoked ? (
            <View style={styles.revokedBanner}>
              <Text style={styles.revokedText}>
                REVOKED{certificate.revocation_reason !== null
                  ? `: ${certificate.revocation_reason}`
                  : ''}
              </Text>
            </View>
          ) : null}

          <DetailRow
            label="Name of Practitioner"
            value={transaction?.profiles?.full_name ?? 'Not recorded'}
          />
          <DetailRow
            label="Supreme Court Number (SCN)"
            value={transaction?.profiles?.scn ?? 'Not recorded'}
          />
          <DetailRow
            label="Branch"
            value={
              transaction?.branches !== null && transaction?.branches !== undefined
                ? `${transaction.branches.name} (${transaction.branches.branch_code})`
                : 'Not recorded'
            }
          />
          <DetailRow label="RBIN" value={transaction?.bain ?? 'Not issued'} />
          <DetailRow
            label="Document Type"
            value={
              transaction !== null ? documentTypeLabels[transaction.document_type] : 'Not recorded'
            }
          />
          <DetailRow label="Parties" value={transaction?.parties ?? 'Not recorded'} />
          <DetailRow
            label="Consideration Value"
            value={transaction !== null ? formatNaira(transaction.consideration) : 'Not recorded'}
          />
          <DetailRow
            label="Date of Issue"
            value={new Date(certificate.issued_at).toLocaleDateString()}
          />
          <DetailRow label="Certificate Number" value={certificate.certificate_number} emphasise />

          <View style={styles.footerRow}>
            {/* The QR encodes the public verification URL for this BAIN. It is
                on the certificate itself, not just this screen, because the
                thing a land registry receives is the document. */}
            {verifyUrl !== null ? (
              <View style={styles.qrBlock}>
                <QRCode
                  value={verifyUrl}
                  size={78}
                  color={palette.text}
                  backgroundColor={palette.surface}
                />
                <Text style={styles.qrCaption}>Scan to verify</Text>
              </View>
            ) : (
              <View style={styles.qrBlock} />
            )}

            <View style={styles.signature}>
              <Text style={styles.signatureName}>
                {transaction?.branches?.chairman_name ?? 'Branch Chairman'}
              </Text>
              <Text style={styles.signatureRole}>Hon. Chairman</Text>
            </View>
          </View>
        </View>
      </View>

      <Card style={styles.verifyCard}>
        <SectionTitle icon="qr-code-2" underline>
          Verification
        </SectionTitle>
        {verifyUrl !== null ? (
          <>
            <Text style={styles.verifyBody}>
              Anyone can confirm this certificate is genuine by scanning the code above, or by
              looking up the BAIN at the address below. The public record shows the practitioner,
              document type and issue date only. It never discloses the consideration or the names
              of the parties.
            </Text>
            <Pressable
              accessibilityRole="link"
              onPress={() => Linking.openURL(verifyUrl)}
              style={styles.verifyLinkRow}>
              <MaterialIcons name="open-in-new" size={18} color={palette.primary} />
              <Text style={styles.verifyLink}>{verifyUrl}</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.verifyBody}>
            A verification code appears here once a BAIN has been issued for this transaction.
          </Text>
        )}
      </Card>

      {pdfError !== null ? <Text style={styles.pdfError}>{pdfError}</Text> : null}

      <Button
        label="Download PDF"
        onPress={handleDownload}
        loading={generating}
        disabled={transaction?.bain == null}
        style={styles.action}
      />
      {transaction?.bain == null ? (
        <Text style={styles.pdfHint}>
          The PDF becomes available once your branch has verified payment and issued a BAIN.
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  certificate: {
    borderWidth: 3,
    borderColor: palette.primary,
    borderRadius: radius.card,
    backgroundColor: palette.surface,
    padding: spacing.sm,
  },
  inner: {
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.lg,
  },
  seal: {
    width: 64,
    height: 64,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  org: {
    fontSize: fontSize.title,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.primary,
    textAlign: 'center',
  },
  certTitle: {
    fontSize: fontSize.bodyLarge,
    color: palette.text,
    textAlign: 'center',
    letterSpacing: 1,
    marginTop: spacing.xs,
  },
  rule: {
    height: 1,
    backgroundColor: palette.border,
    marginVertical: spacing.lg,
  },
  recital: {
    fontSize: fontSize.body,
    fontStyle: 'italic',
    color: palette.text,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  revokedBanner: {
    backgroundColor: palette.dangerSurface,
    borderWidth: 1,
    borderColor: palette.danger,
    borderRadius: radius.input,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  revokedText: {
    fontSize: fontSize.label,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.danger,
    textAlign: 'center',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  qrBlock: {
    alignItems: 'center',
    minWidth: 78,
  },
  qrCaption: {
    fontSize: 9,
    color: palette.textMuted,
    marginTop: spacing.xs,
    letterSpacing: 0.3,
  },
  signature: {
    alignItems: 'flex-end',
    flex: 1,
  },
  signatureName: {
    fontSize: fontSize.label,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.text,
    borderTopWidth: 1,
    borderTopColor: palette.borderStrong,
    paddingTop: spacing.xs,
  },
  signatureRole: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
  },
  verifyCard: {
    marginTop: spacing.lg,
    backgroundColor: palette.accentSurface,
    borderColor: palette.accent,
  },
  verifyBody: {
    fontSize: fontSize.caption,
    color: palette.accentText,
    lineHeight: 17,
  },
  verifyLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  verifyLink: {
    flex: 1,
    fontSize: fontSize.caption,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.primary,
  },
  action: {
    marginTop: spacing.lg,
  },
  pdfError: {
    fontSize: fontSize.label,
    color: palette.danger,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  pdfHint: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 17,
  },
  verifyPending: {
    fontSize: fontSize.caption,
    color: palette.accentText,
    fontStyle: 'italic',
    marginTop: spacing.sm,
    lineHeight: 17,
  },
  error: {
    fontSize: fontSize.body,
    color: palette.danger,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
});
