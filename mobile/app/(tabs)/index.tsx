import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SelectField, TextField } from '@/components/ui/Field';
import { Screen, SectionTitle } from '@/components/ui/Screen';
import { useAuth } from '@/lib/auth-context';
import { ORDER_SHORT_NAME } from '@/lib/branding';
import {
  calculateFee,
  documentTypeLabels,
  documentTypeMeta,
  FeeCalculationError,
  scale2023,
  type DocumentType,
  type FeeCalculationResult,
} from '@/lib/fees';
import { consumeCalculatorReset } from '@/lib/calculator-reset';
import { formatNaira, groupNairaInput, parseNairaInput } from '@/lib/money';
import { firstNameOf, greetingFor } from '@/lib/names';
import { shareEngagementLetterPdf } from '@/lib/pdf';
import { fontFamily, fontSize, fontWeight, palette, spacing } from '@/theme/tokens';

const documentTypeOptions = (Object.keys(documentTypeLabels) as DocumentType[]).map((value) => ({
  value,
  label: documentTypeLabels[value],
}));

export default function CalculatorScreen() {
  const { profile } = useAuth();
  const firstName = firstNameOf(profile?.full_name) ?? 'Counsel';
  const greeting = greetingFor(new Date().getHours());

  const [documentType, setDocumentType] = useState<DocumentType | ''>('');
  const [amountText, setAmountText] = useState('');

  const [result, setResult] = useState<FeeCalculationResult | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [calculationError, setCalculationError] = useState<string | null>(null);

  const [clientName, setClientName] = useState('');
  const [matter, setMatter] = useState('');
  const [engagementErrors, setEngagementErrors] = useState<Record<string, string>>({});
  const [letterBusy, setLetterBusy] = useState(false);
  const [letterError, setLetterError] = useState<string | null>(null);

  async function handleEngagementLetter() {
    if (result === null) return;

    const next: Record<string, string> = {};
    if (clientName.trim() === '') {
      next.clientName = 'Terms of engagement are addressed to someone, so the client is required.';
    }
    if (matter.trim() === '') {
      next.matter = 'Describe the matter, so the letter records what was instructed.';
    }
    setEngagementErrors(next);
    if (Object.keys(next).length > 0) return;

    setLetterBusy(true);
    setLetterError(null);
    try {
      await shareEngagementLetterPdf({
        facts: {
          practitionerName: profile?.full_name ?? 'Legal Practitioner',
          scn: profile?.scn ?? null,
          clientName: clientName.trim(),
          matter: matter.trim(),
          result,
          // Today, because the 14 day period runs from when instructions were
          // accepted and a practitioner generating this now is doing so on the
          // day they took them. A practitioner issuing terms late should say
          // so themselves rather than have the document quietly backdate it.
          instructedOn: new Date(),
        },
      });
    } catch (error) {
      setLetterError(
        error instanceof Error ? error.message : 'The letter could not be generated. Try again.'
      );
    } finally {
      setLetterBusy(false);
    }
  }

  const meta = documentType === '' ? null : documentTypeMeta[documentType];
  const isDiscretionary = meta?.scale === 'discretionary';

  // Clear once the calculation has become a transaction. The tab stays mounted
  // while the receipt flow runs above it, so returning here would otherwise
  // show a filled-in form for a document already in Transactions, inviting a
  // second receipt for the same payment.
  useFocusEffect(
    useCallback(() => {
      if (consumeCalculatorReset()) {
        setDocumentType('');
        setAmountText('');
        setResult(null);
        setErrors({});
        setCalculationError(null);
      }
    }, []),
  );

  function handleCalculate() {
    const nextErrors: Record<string, string> = {};

    if (documentType === '') {
      nextErrors.documentType = 'Select the document type.';
    }

    const amount = parseNairaInput(amountText);
    if (!isDiscretionary && amount === null) {
      nextErrors.amount = 'Enter the amount, for example 45,000,000.';
    }

    setErrors(nextErrors);
    setCalculationError(null);

    if (Object.keys(nextErrors).length > 0 || documentType === '') {
      setResult(null);
      return;
    }

    try {
      setResult(calculateFee(scale2023, { documentType, amount: amount ?? 0 }));
    } catch (error) {
      setResult(null);
      // The engine refuses to guess. Show why: for Power of Attorney the
      // reason is the substantive answer, not a failure.
      setCalculationError(
        error instanceof FeeCalculationError
          ? error.message
          : 'The fee could not be calculated. Please try again.'
      );
    }
  }

  return (
    <Screen resetScrollOnFocus>
      <View style={styles.greeting}>
        <Text style={styles.greetingHello}>{greeting},</Text>
        <Text style={styles.greetingName}>{firstName}</Text>
      </View>

      <Card style={styles.card}>
        <SectionTitle icon="description">Transaction Details</SectionTitle>

        {/*
          No State of Transaction input. The reference implementation in the
          NBA Remuneration Portal has no state dimension, and inventing one
          would produce figures that disagree with the portal for the same
          transaction. See DESIGN_REVIEW.md, "State Bands".
        */}
        <SelectField
          label="Document / Transaction Type"
          placeholder="Select Document Type"
          value={documentType}
          onChange={(next) => {
            setDocumentType(next);
            setResult(null);
            setCalculationError(null);
          }}
          options={documentTypeOptions}
          error={errors.documentType}
          hint={meta === null ? undefined : `Scale ${meta.scale} - ${meta.basisLabel}.`}
        />

        {/*
          The label follows the document type. A tenancy is charged on annual
          rent, a gift on market value, an exchange on the higher of the two
          properties. Asking for "consideration" throughout would invite the
          wrong figure and produce a plausible but incorrect fee.
        */}
        {isDiscretionary ? null : (
          <TextField
            label={`${meta?.basisLabel ?? 'Amount'} (₦)`}
            prefix="₦"
            placeholder="0.00"
            keyboardType="numeric"
            value={amountText}
            // Regrouped on every keystroke. A consideration routinely runs to
            // eight or nine figures, and an unseparated number that long
            // cannot be checked at a glance — being out by a factor of ten
            // produces a plausible fee rather than an obviously absurd one.
            onChangeText={(text) => setAmountText(groupNairaInput(text))}
            error={errors.amount}
            hint={
              meta?.basis === 'annual_rent'
                ? 'Enter one year of rent, not the total over the term.'
                : undefined
            }
          />
        )}

        <Button label="Calculate Fee" onPress={handleCalculate} />
      </Card>

      <Card style={styles.resultCard}>
        <View style={styles.resultHeader}>
          <Text style={styles.resultTitle}>PRESCRIBED MINIMUM FEE</Text>
          <Text style={styles.resultSubtitle}>Per the {ORDER_SHORT_NAME}</Text>
        </View>

        <View style={styles.resultBody}>
          {calculationError !== null ? (
            <View style={styles.noticeState}>
              <MaterialIcons name="info-outline" size={32} color={palette.accentText} />
              <Text style={styles.noticeText}>{calculationError}</Text>
            </View>
          ) : result === null ? (
            <View style={styles.emptyState}>
              <MaterialIcons name="receipt-long" size={44} color={palette.borderStrong} />
              <Text style={styles.emptyText}>
                Enter transaction details and calculate to see the fee breakdown.
              </Text>
            </View>
          ) : (
            <FeeBreakdown result={result} />
          )}
        </View>
      </Card>

      {/* Separate from the result card, and below the receipt action, because
          it answers a different question. The receipt is about paying the
          branch; this is about the practitioner's own obligation to their
          client, which exists whether or not a receipt is ever generated. */}
      {result !== null ? (
        <Card style={styles.card}>
          <SectionTitle icon="drafts">Terms of Engagement</SectionTitle>
          <Text style={styles.engagementNote}>
            The {ORDER_SHORT_NAME} requires written terms to reach your client within 14 days of
            accepting instructions. This produces them from the calculation above.
          </Text>

          <TextField
            label="Client"
            value={clientName}
            onChangeText={setClientName}
            placeholder="Name of the client instructing you"
            error={engagementErrors.clientName}
          />

          <TextField
            label="The matter"
            value={matter}
            onChangeText={setMatter}
            placeholder="e.g. the sale of the property at 12 Ziks Avenue, Awka"
            error={engagementErrors.matter}
          />

          {letterError !== null ? <Text style={styles.letterError}>{letterError}</Text> : null}

          <Button
            label="Generate Terms of Engagement"
            variant="outline"
            loading={letterBusy}
            onPress={handleEngagementLetter}
          />
        </Card>
      ) : null}
    </Screen>
  );
}

function FeeBreakdown({ result }: { result: FeeCalculationResult }) {
  const meta = documentTypeMeta[result.input.documentType];

  return (
    <View>
      <Text style={styles.totalLabel}>{meta.fullRateParty}</Text>
      <Text style={styles.totalValue}>{formatNaira(result.professionalFee)}</Text>
      <Text style={styles.bandNote}>
        Scale {result.scale} - {documentTypeLabels[result.input.documentType]}
      </Text>

      <View style={styles.divider} />

      {result.breakdown.map((line) => (
        <View key={line.description} style={styles.breakdownRow}>
          <Text style={styles.breakdownDescription}>{line.description}</Text>
          <Text style={styles.breakdownAmount}>{formatNaira(line.amount)}</Text>
        </View>
      ))}

      <View style={styles.divider} />

      {/*
        The other party's practitioner is entitled to half the scale fee, so
        showing only one figure would leave half the profession guessing.
      */}
      {result.halfRateFee !== null && meta.halfRateParty !== null ? (
        <View style={styles.halfRateBlock}>
          <Text style={styles.halfRateLabel}>{meta.halfRateParty} (half rate)</Text>
          <Text style={styles.halfRateValue}>{formatNaira(result.halfRateFee)}</Text>
        </View>
      ) : null}

      <View style={styles.breakdownRow}>
        <Text style={styles.summaryLabel}>Payable to NBA branch</Text>
        <Text style={styles.summaryValue}>{formatNaira(result.branchFee)}</Text>
      </View>
      <View style={styles.breakdownRow}>
        <Text style={styles.grandTotalLabel}>Total</Text>
        <Text style={styles.grandTotalValue}>{formatNaira(result.total)}</Text>
      </View>

      <Text style={styles.minimumNote}>
        This is the prescribed minimum, exclusive of VAT and of disbursements such as stamp duties,
        registration fees and Governor's Consent. Charging below scale requires an application to
        the Legal Practitioners' Remuneration Committee.
      </Text>

      {/*
        The entry point to everything downstream. Until this existed the
        calculator computed a figure and stopped, so no transaction could be
        created and the receipt, proof upload, verification and certificate
        screens were all unreachable.
      */}
      <Button
        label="Generate Receipt"
        onPress={() =>
          router.push({
            pathname: '/transaction/new',
            params: {
              documentType: result.input.documentType,
              amount: String(result.input.amount),
              professionalFee: String(result.professionalFee),
              branchFee: String(result.branchFee),
            },
          })
        }
        style={styles.generate}
      />
      <Text style={styles.generateNote}>
        Creates a reference to quote when paying your branch. Calculating is free; a subscription is
        required to generate a receipt.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  greeting: {
    marginBottom: spacing.lg,
  },
  greetingHello: {
    fontSize: fontSize.body,
    fontFamily: fontFamily.body,
    color: palette.textMuted,
  },
  greetingName: {
    fontSize: fontSize.heading,
    fontFamily: fontFamily.headingBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
  },
  card: {
    marginBottom: spacing.lg,
  },
  resultCard: {
    padding: 0,
    overflow: 'hidden',
  },
  resultHeader: {
    padding: spacing.lg,
    backgroundColor: palette.surfaceMuted,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  resultTitle: {
    fontSize: fontSize.label,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
    letterSpacing: 0.5,
  },
  resultSubtitle: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    marginTop: spacing.xs,
  },
  resultBody: {
    padding: spacing.lg,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  emptyText: {
    fontSize: fontSize.body,
    color: palette.textMuted,
    textAlign: 'center',
    lineHeight: 21,
  },
  noticeState: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  noticeText: {
    fontSize: fontSize.body,
    color: palette.text,
    textAlign: 'center',
    lineHeight: 21,
  },
  totalLabel: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
  },
  totalValue: {
    fontSize: fontSize.display,
    fontFamily: fontFamily.headingBold,
    fontWeight: fontWeight.bold,
    color: palette.primary,
  },
  bandNote: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    marginTop: spacing.xs,
  },
  divider: {
    height: 1,
    backgroundColor: palette.border,
    marginVertical: spacing.md,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  breakdownDescription: {
    flex: 1,
    fontSize: fontSize.label,
    color: palette.textMuted,
  },
  breakdownAmount: {
    fontSize: fontSize.label,
    fontFamily: fontFamily.bodyMedium,
    color: palette.text,
  },
  halfRateBlock: {
    backgroundColor: palette.surfaceMuted,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  halfRateLabel: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
  },
  halfRateValue: {
    fontSize: fontSize.title,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.text,
  },
  summaryLabel: {
    fontSize: fontSize.body,
    color: palette.textMuted,
  },
  summaryValue: {
    fontSize: fontSize.body,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.text,
  },
  grandTotalLabel: {
    fontSize: fontSize.bodyLarge,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
  },
  grandTotalValue: {
    fontSize: fontSize.bodyLarge,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.primary,
  },
  minimumNote: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    lineHeight: 17,
    marginTop: spacing.lg,
  },
  generate: {
    marginTop: spacing.lg,
  },
  generateNote: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 17,
  },
  engagementNote: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  letterError: {
    fontSize: fontSize.caption,
    color: palette.danger,
    marginBottom: spacing.sm,
  },
});
