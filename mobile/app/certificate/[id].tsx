import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen, SectionTitle } from '@/components/ui/Screen';
import { useAuth } from '@/lib/auth-context';
import {
  CERTIFICATE_NOTE,
  CERTIFICATE_RECITAL,
  certificateParticulars,
} from '@/lib/certificate';
import type { Certificate, DocumentTypeValue } from '@/lib/database.types';
import { type DocumentType } from '@/lib/fees';
import { shareCertificatePdf } from '@/lib/pdf';
import { supabase } from '@/lib/supabase';
import { verificationUrlFor } from '@/lib/verification';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

interface CertificateDetail extends Certificate {
  transactions: {
    rbin: string | null;
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
          '*, transactions!inner(rbin, document_type, parties, consideration, branch_id, user_id, ' +
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
  // The QR encodes a lookup by RBIN, so there is nothing to encode until one
  // has been issued.
  const verifyUrl = transaction?.rbin != null ? verificationUrlFor(transaction.rbin) : null;

  async function handleDownload() {
    if (certificate === null || transaction === null || transaction.rbin === null) {
      return;
    }
    setGenerating(true);
    setPdfError(null);
    try {
      await shareCertificatePdf({
        certificateNumber: certificate.certificate_number,
        rbin: transaction.rbin,
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
          <View style={styles.crest}>
            <Image
              source={require('@/assets/images/nba-logo.png')}
              style={styles.seal}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
            <View style={styles.crestText}>
              <Text style={styles.org}>NIGERIAN BAR ASSOCIATION</Text>
              <Text style={styles.branchName}>
                {(transaction?.branches?.name ?? 'Branch')
                  .replace(/^NBA\s+/i, '')
                  .toUpperCase()}
              </Text>
            </View>
          </View>

          <View style={styles.rule} />
          <Text style={styles.certTitle}>CERTIFICATE OF COMPLIANCE</Text>
          <View style={styles.rule} />

          <Text style={styles.lead}>THIS IS TO CERTIFY THAT</Text>
          <Text style={styles.recital}>{CERTIFICATE_RECITAL}</Text>

          {revoked ? (
            <View style={styles.revokedBanner}>
              <Text style={styles.revokedText}>
                REVOKED{certificate.revocation_reason !== null
                  ? `: ${certificate.revocation_reason}`
                  : ''}
              </Text>
            </View>
          ) : null}

          {/*
            The same six particulars the PDF prints, in the same order, from
            the same function. Numbered as the branch numbers them, but stacked
            rather than tabulated: a label column that works on A4 would leave
            a phone with about eight characters per line for the value.
          */}
          {transaction !== null
            ? certificateParticulars({
                practitionerName: transaction.profiles?.full_name ?? 'Not recorded',
                rbin: transaction.rbin ?? 'Not issued',
                scn: transaction.profiles?.scn ?? null,
                parties: transaction.parties,
                documentType: transaction.document_type as DocumentType,
                consideration: transaction.consideration,
              }).map((particular, index) => (
                <View key={particular.label} style={styles.particular}>
                  <Text style={styles.particularLabel}>
                    {index + 1}. {particular.label}
                  </Text>
                  <Text style={styles.particularValue}>{particular.value}</Text>
                </View>
              ))
            : null}

          <Text style={styles.note}>{CERTIFICATE_NOTE}</Text>

          <View style={styles.issueBlock}>
            <View>
              <Text style={styles.issueLabel}>Date of Issue</Text>
              <Text style={styles.issueValue}>
                {new Date(certificate.issued_at).toLocaleDateString()}
              </Text>
            </View>
            <View>
              <Text style={styles.issueLabel}>Certificate No.</Text>
              <Text style={styles.issueValue}>{certificate.certificate_number}</Text>
            </View>
          </View>

          <View style={styles.footerRow}>
            {/* The QR encodes the public verification URL for this RBIN. It is
                on the certificate itself, not just this screen, because the
                thing a land registry receives is the document. */}
            {verifyUrl !== null ? (
              <View style={styles.qrBlock}>
                <QRCode
                  value={verifyUrl}
                  size={78}
                  color="#14301F"
                  backgroundColor="#FBF7EF"
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
              <Text style={styles.signatureRole}>CHAIRMAN</Text>
              <Text style={styles.signatureRole}>
                {(transaction?.branches?.name ?? 'NBA Branch').toUpperCase()}
              </Text>
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
              looking up the RBIN at the address below. The public record shows the practitioner,
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
            A verification code appears here once a RBIN has been issued for this transaction.
          </Text>
        )}
      </Card>

      {pdfError !== null ? <Text style={styles.pdfError}>{pdfError}</Text> : null}

      <Button
        label="Download PDF"
        onPress={handleDownload}
        loading={generating}
        disabled={transaction?.rbin == null}
        style={styles.action}
      />
      {transaction?.rbin == null ? (
        <Text style={styles.pdfHint}>
          The PDF becomes available once your branch has verified payment and issued a RBIN.
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
  /*
   * The branch's paper and gold, adapted for a phone.
   *
   * The printed certificate is a fixed A4 document with a two-rule engraved
   * frame and the particulars tabulated against a label column. Neither
   * survives a 390px screen: the frame eats the width, and a label column wide
   * enough for PARTIES TO THE DOCUMENT leaves the value about eight characters
   * a line. So the frame is a single gold rule, and the particulars stack.
   *
   * Colours are literals rather than theme tokens on purpose. This is the
   * branch's own document, and it should not shift if the app's palette is
   * ever retuned.
   */
  certificate: {
    borderWidth: 2,
    borderColor: '#B8912F',
    borderRadius: 4,
    backgroundColor: '#FBF7EF',
    padding: 5,
  },
  inner: {
    borderWidth: 1,
    borderColor: '#CBB98C',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  crest: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  seal: {
    width: 54,
    height: 54,
  },
  crestText: {
    flex: 1,
  },
  org: {
    fontSize: fontSize.bodyLarge,
    fontFamily: fontFamily.headingBold,
    fontWeight: fontWeight.bold,
    color: '#123D24',
    lineHeight: 22,
  },
  branchName: {
    fontSize: fontSize.caption,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: '#123D24',
    letterSpacing: 2.5,
    marginTop: 2,
  },
  certTitle: {
    fontSize: 22,
    fontFamily: fontFamily.headingBold,
    fontWeight: fontWeight.bold,
    color: '#123D24',
    textAlign: 'center',
    letterSpacing: 0.5,
    lineHeight: 27,
  },
  rule: {
    height: 1,
    backgroundColor: '#B99B45',
    marginVertical: spacing.md,
  },
  lead: {
    fontSize: fontSize.caption,
    fontStyle: 'italic',
    color: '#14301F',
    textAlign: 'center',
    letterSpacing: 1,
    marginTop: spacing.xs,
  },
  recital: {
    fontSize: fontSize.caption,
    color: '#14301F',
    textAlign: 'center',
    lineHeight: 21,
    marginTop: spacing.sm,
  },
  particular: {
    marginTop: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: '#DCD2B4',
    paddingBottom: spacing.xs,
  },
  particularLabel: {
    fontSize: 11,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: '#5C6B5B',
    letterSpacing: 0.6,
  },
  particularValue: {
    fontSize: fontSize.body,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: '#14301F',
    marginTop: 3,
    lineHeight: 21,
  },
  note: {
    fontSize: 11,
    fontStyle: 'italic',
    color: '#40503F',
    textAlign: 'center',
    lineHeight: 17,
    marginTop: spacing.xl,
  },
  issueBlock: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  issueLabel: {
    fontSize: 10,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: '#5C6B5B',
    letterSpacing: 0.5,
  },
  issueValue: {
    fontSize: fontSize.caption,
    color: '#14301F',
    marginTop: 2,
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
    color: '#5C6B5B',
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
    color: '#14301F',
    borderTopWidth: 1,
    borderTopColor: '#14301F',
    paddingTop: spacing.xs,
  },
  signatureRole: {
    fontSize: 10,
    color: '#40503F',
    letterSpacing: 0.4,
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
