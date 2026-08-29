import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Screen, ScreenHeading, SectionTitle } from '@/components/ui/Screen';
import { ATTRIBUTION, ORDER_FULL_NAME, PRODUCT_NAME } from '@/lib/branding';
import { fontFamily, fontSize, fontWeight, palette, spacing } from '@/theme/tokens';

interface Faq {
  question: string;
  answer: string;
}

/**
 * The questions here are the ones the product's own design raises, rather than
 * generic filler: which amount to enter for a given instrument, why the figure
 * is a minimum, and why a certificate has not arrived yet. Each maps to
 * something a practitioner will otherwise contact their branch about.
 */
const faqs: readonly Faq[] = [
  {
    question: 'What amount should I enter?',
    answer:
      'It depends on the instrument, and the calculator relabels the field to match. Conveyancing is charged on the consideration, a gift on market value, an exchange on the higher of the two properties, a mortgage on the loan, and a lease or tenancy on ONE YEAR of rent rather than the total over the term.',
  },
  {
    question: 'Why is a mortgage cheaper than an assignment of the same value?',
    answer:
      'They fall under different sub-scales. Conveyancing is Scale 4A, which starts at 10%. Mortgages are Scale 4B, which starts at 4%. Leases and tenancies are Scale 4C and are charged on annual rent.',
  },
  {
    question: 'What fee applies to an Irrevocable Power of Attorney?',
    answer:
      'None that the calculator can compute. A Power of Attorney is not a Scale 4 instrument: its fee is agreed with the client under paragraph 2 of the Order, having regard to complexity, time and value.',
  },
  {
    question: 'Is the calculated fee the amount I must charge?',
    answer:
      'It is the prescribed minimum, not a quote. You may charge more. Charging below the scale requires an application to the Bar Remuneration Committee.',
  },
  {
    question: 'Why have I not received a Certificate of Compliance?',
    answer:
      'A certificate is issued only after a branch administrator verifies your proof of payment. If your transaction still shows Pending Verification, it is waiting on your branch. If it was rejected, the reason is shown on the transaction.',
  },
  {
    question: 'I registered without a branch code. Can I add one?',
    answer:
      'Yes. Open Edit Profile and use Request branch affiliation. A branch administrator has to approve it, because your branch determines who verifies your payments and issues your certificates.',
  },
  {
    question: 'Do I lose my certificates if my subscription lapses?',
    answer:
      'No. Certificates already issued to you remain available to download indefinitely. A lapsed subscription only stops new receipts being generated.',
  },
];

export default function HelpScreen() {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Screen>
      <ScreenHeading
        title="Help & Support"
        subtitle="Answers to common questions, and how to reach your branch."
      />

      <Card>
        <SectionTitle icon="quiz" underline>
          Frequently asked
        </SectionTitle>

        {faqs.map((faq, index) => {
          const expanded = open === faq.question;
          return (
            <Pressable
              key={faq.question}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => setOpen(expanded ? null : faq.question)}
              style={[styles.faq, index === faqs.length - 1 && styles.faqLast]}>
              <View style={styles.faqHeader}>
                <Text style={styles.question}>{faq.question}</Text>
                <MaterialIcons
                  name={expanded ? 'expand-less' : 'expand-more'}
                  size={22}
                  color={palette.textMuted}
                />
              </View>
              {expanded ? <Text style={styles.answer}>{faq.answer}</Text> : null}
            </Pressable>
          );
        })}
      </Card>

      <Card style={styles.card}>
        <SectionTitle icon="support-agent" underline>
          Contact your branch
        </SectionTitle>
        <Text style={styles.body}>
          Questions about a specific payment, a rejected proof, or your branch affiliation are
          handled by your branch, not by this app. Your branch secretariat holds those records.
        </Text>
        <Pressable
          accessibilityRole="link"
          onPress={() => Linking.openURL('mailto:support@nbaanaocha.org')}
          style={styles.contactRow}>
          <MaterialIcons name="mail-outline" size={20} color={palette.primary} />
          <Text style={styles.contactText}>support@nbaanaocha.org</Text>
        </Pressable>
      </Card>

      <Card style={styles.card}>
        <SectionTitle icon="info-outline" underline>
          About
        </SectionTitle>
        <Text style={styles.body}>
          {PRODUCT_NAME}. {ATTRIBUTION}.
        </Text>
        <Text style={[styles.body, styles.legal]}>
          Fees are calculated under the {ORDER_FULL_NAME}, made under section 15(3) of the Legal
          Practitioners Act. That Order is an instrument of the Legal Practitioners Remuneration
          Committee, not of the Nigerian Bar Association.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.lg,
  },
  faq: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  faqLast: {
    borderBottomWidth: 0,
  },
  faqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  question: {
    flex: 1,
    fontSize: fontSize.body,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.text,
  },
  answer: {
    fontSize: fontSize.body,
    color: palette.textMuted,
    lineHeight: 21,
    marginTop: spacing.sm,
  },
  body: {
    fontSize: fontSize.body,
    color: palette.textMuted,
    lineHeight: 21,
  },
  legal: {
    fontSize: fontSize.caption,
    marginTop: spacing.md,
    lineHeight: 18,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  contactText: {
    fontSize: fontSize.body,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.primary,
  },
});
