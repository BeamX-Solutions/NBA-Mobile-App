import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/Field';
import { DetailRow, Screen, ScreenHeading, SectionTitle } from '@/components/ui/Screen';
import { useAuth } from '@/lib/auth-context';
import { requestCalculatorReset } from '@/lib/calculator-reset';
import { documentTypeLabels, documentTypeMeta, type DocumentType } from '@/lib/fees';
import { formatNaira } from '@/lib/money';
import { supabase } from '@/lib/supabase';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

/**
 * Step one of the transaction pipeline: turning a calculation into something
 * payable.
 *
 * The calculator is stateless and free. This is where a figure becomes a
 * record: an invoice reference quoted on the client's bank transfer to the
 * branch, the amount the client pays, and a row the branch can later verify
 * and pay the practitioner's share out of.
 *
 * The parties are collected here rather than on the calculator because they
 * are irrelevant to the arithmetic and mandatory on the record. A fee depends
 * only on the instrument and the amount; a certificate has to say who the
 * document was between.
 */
export default function NewTransactionScreen() {
  const { profile } = useAuth();
  const params = useLocalSearchParams<{
    documentType?: string;
    amount?: string;
    professionalFee?: string;
    branchFee?: string;
  }>();

  const documentType = (params.documentType ?? '') as DocumentType;
  const amount = Number(params.amount ?? 0);
  const professionalFee = Number(params.professionalFee ?? 0);
  const branchFee = Number(params.branchFee ?? 0);

  const [parties, setParties] = useState('');
  const [partiesError, setPartiesError] = useState<string | undefined>(undefined);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const meta = documentTypeMeta[documentType];
  const hasBranch = profile?.branch_id != null;
  const hasBank =
    profile?.bank_account_name != null &&
    profile.bank_account_number != null &&
    profile.bank_name != null;

  async function generate() {
    if (parties.trim() === '') {
      setPartiesError('Name the parties to the document.');
      return;
    }
    setPartiesError(undefined);
    setSubmitError(null);
    setSubmitting(true);

    try {
      // The whole creation runs server side: the invoice number cannot be set
      // by a client, and the subscription and branch checks would be
      // meaningless applied here.
      const { data, error } = await supabase.rpc('create_transaction', {
        p_document_type: documentType,
        p_consideration: amount,
        p_professional_fee: professionalFee,
        p_branch_fee: branchFee,
        p_parties: parties.trim(),
      });

      if (error) {
        setSubmitError(error.message);
        return;
      }

      const created = (data ?? []) as { transaction_id: string; invoice_number: string }[];
      if (created.length === 0) {
        setSubmitError('The invoice could not be generated. Please try again.');
        return;
      }

      // Only once a transaction actually exists. Abandoning this screen, or
      // failing the subscription check, leaves the calculator as it was so the
      // practitioner can come back and try again without retyping.
      requestCalculatorReset();

      router.replace(`/transaction/invoice/${created[0].transaction_id}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (meta === undefined) {
    return (
      <Screen>
        <ScreenHeading title="Generate Invoice" />
        <Card>
          <Text style={styles.blockedBody}>
            This invoice is missing its calculation. Return to the calculator and work the fee out
            again.
          </Text>
          <Button label="Back to calculator" onPress={() => router.replace('/(tabs)')} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeading
        title="Generate Invoice"
        subtitle="Confirm the figures and name the parties. This creates the invoice your client pays into the branch account."
      />

      {/*
        Checked here as well as in the database so the practitioner is told
        before filling the form in, not after submitting it. The database is
        still the enforcement point.
      */}
      {!hasBranch ? (
        <Card>
          <View style={styles.blocked}>
            <MaterialIcons name="account-balance" size={36} color={palette.accentText} />
            <Text style={styles.blockedTitle}>You need a branch first</Text>
            <Text style={styles.blockedBody}>
              An invoice names your branch's bank account, and a Certificate of Compliance is issued
              by a branch. Without one there is nobody to pay and nobody to verify the payment.
            </Text>
          </View>
          <Button
            label="Request branch affiliation"
            onPress={() => router.push('/profile/edit')}
          />
        </Card>
      ) : !hasBank ? (
        // Checked in the database too. The branch pays the practitioner's
        // share into this account, so without it the money has nowhere to go.
        <Card>
          <View style={styles.blocked}>
            <MaterialIcons name="account-balance-wallet" size={36} color={palette.accentText} />
            <Text style={styles.blockedTitle}>Add your bank details</Text>
            <Text style={styles.blockedBody}>
              Your client pays the fee into the branch account, and the branch sends your share to
              you. Add the account it should go to before generating an invoice.
            </Text>
          </View>
          <Button label="Add bank details" onPress={() => router.push('/profile/edit')} />
        </Card>
      ) : (
        <>
          <Card style={styles.card}>
            <SectionTitle icon="calculate">Calculated fee</SectionTitle>
            <DetailRow label="Document Type" value={documentTypeLabels[documentType]} />
            <DetailRow label={meta.basisLabel} value={formatNaira(amount)} />
            <DetailRow
              label="Client pays into branch account"
              value={formatNaira(professionalFee)}
              emphasise
            />
            <DetailRow label="Less 2% branch fee" value={formatNaira(branchFee)} />
            <DetailRow
              label="Branch sends to you"
              value={formatNaira(professionalFee - branchFee)}
            />
          </Card>

          <Card style={styles.card}>
            <SectionTitle icon="groups">Parties</SectionTitle>
            <TextField
              label="Parties to the Document"
              placeholder="e.g. Chinedu Okafor to Adeola Properties Ltd"
              value={parties}
              onChangeText={(text) => {
                setParties(text);
                setPartiesError(undefined);
              }}
              error={partiesError}
              multiline
              hint="This appears on the invoice and on your Certificate of Compliance, so use the names as they appear on the instrument."
            />
          </Card>

          {submitError !== null ? (
            <View style={styles.errorBox}>
              <MaterialIcons name="error-outline" size={20} color={palette.danger} />
              <Text style={styles.errorText}>{submitError}</Text>
            </View>
          ) : null}

          <Button label="Generate Invoice" onPress={generate} loading={submitting} />

          <Text style={styles.note}>
            Generating an invoice does not pay anything. It creates the reference your client quotes
            on their bank transfer to the branch.
          </Text>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.lg,
  },
  blocked: {
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  blockedTitle: {
    fontSize: fontSize.title,
    fontFamily: fontFamily.headingBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
  },
  blockedBody: {
    fontSize: fontSize.body,
    color: palette.textMuted,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: spacing.lg,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: palette.dangerSurface,
    borderRadius: radius.input,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  errorText: {
    flex: 1,
    fontSize: fontSize.label,
    color: palette.danger,
    lineHeight: 19,
  },
  note: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 17,
  },
});
