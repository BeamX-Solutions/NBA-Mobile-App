import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen, ScreenHeading } from '@/components/ui/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useAuth } from '@/lib/auth-context';
import type { Certificate, DocumentTypeValue } from '@/lib/database.types';
import { documentTypeLabels } from '@/lib/fees';
import { supabase } from '@/lib/supabase';
import { fontFamily, fontSize, fontWeight, palette, radius, spacing } from '@/theme/tokens';

/** A certificate joined with the identifying fields from its transaction. */
interface CertificateRow extends Certificate {
  transactions: {
    rbin: string | null;
    document_type: DocumentTypeValue;
    parties: string;
  } | null;
}

type ViewMode = 'grid' | 'list';

export default function CertificatesScreen() {
  const { session } = useAuth();
  const [certificates, setCertificates] = useState<CertificateRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  const load = useCallback(async () => {
    if (!session?.user) {
      return;
    }
    // certificates carries no user_id of its own, so ownership is asserted
    // through the transaction it belongs to. !inner makes the join a filter
    // rather than an optional embed, so a row whose transaction belongs to
    // someone else is excluded instead of returned with a null embed.
    const { data, error } = await supabase
      .from('certificates')
      .select('*, transactions!inner(rbin, document_type, parties, user_id)')
      .eq('transactions.user_id', session.user.id)
      .order('issued_at', { ascending: false });

    if (error) {
      setLoadError('Your certificates could not be loaded.');
      // Left null so the error state renders rather than an empty list.
      return;
    }
    setLoadError(null);
    setCertificates(data as CertificateRow[]);
  }, [session?.user]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loadError !== null) {
    return (
      <Screen resetScrollOnFocus onRefresh={refresh} refreshing={refreshing}>
        <ScreenHeading
          title="My Certificates"
          subtitle="View and download your official Certificates of Compliance."
        />
        <ErrorState body={loadError} onRetry={load} />
      </Screen>
    );
  }

  if (certificates === null) {
    return (
      <Screen resetScrollOnFocus>
        <ScreenHeading
          title="My Certificates"
          subtitle="View and download your official Certificates of Compliance."
        />
        <LoadingState label="Loading your certificates" />
      </Screen>
    );
  }

  if (certificates.length === 0) {
    return (
      <Screen resetScrollOnFocus onRefresh={refresh} refreshing={refreshing}>
        <ScreenHeading
          title="My Certificates"
          subtitle="View and download your official Certificates of Compliance."
        />
        <EmptyState
          icon="verified"
          title="No certificates yet"
          body="A Certificate of Compliance is issued once your branch verifies your payment. Upload proof of payment on a transaction to start that process."
          actionLabel="View transactions"
          onAction={() => router.replace('/(tabs)/transactions')}
        />
      </Screen>
    );
  }

  return (
    <Screen resetScrollOnFocus onRefresh={refresh} refreshing={refreshing}>
      <ScreenHeading
        title="My Certificates"
        subtitle="View and download your official Certificates of Compliance."
      />

      <View style={styles.viewToggle}>
        <ViewModeOption
          icon="grid-view"
          label="Grid"
          selected={viewMode === 'grid'}
          onPress={() => setViewMode('grid')}
        />
        <ViewModeOption
          icon="view-list"
          label="List"
          selected={viewMode === 'list'}
          onPress={() => setViewMode('list')}
        />
      </View>

      {certificates.map((certificate) => (
        <CertificateCard
          key={certificate.id}
          certificate={certificate}
          compact={viewMode === 'list'}
        />
      ))}

      <View style={styles.archive}>
        <MaterialIcons name="history" size={26} color={palette.textMuted} />
        <Text style={styles.archiveText}>Looking for older certificates? Request archive access.</Text>
        <Text style={styles.archiveLink}>Request Archive</Text>
      </View>
    </Screen>
  );
}

function ViewModeOption({
  icon,
  label,
  selected,
  onPress,
}: {
  icon: 'grid-view' | 'view-list';
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.viewOption, selected && styles.viewOptionSelected]}>
      <MaterialIcons
        name={icon}
        size={18}
        color={selected ? palette.text : palette.textMuted}
      />
      <Text style={[styles.viewOptionLabel, selected && styles.viewOptionLabelSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

function CertificateCard({
  certificate,
  compact,
}: {
  certificate: CertificateRow;
  compact: boolean;
}) {
  const issuedYear = new Date(certificate.issued_at).getFullYear().toString();
  const revoked = certificate.revoked_at !== null;

  async function handleShare() {
    const rbin = certificate.transactions?.rbin;
    await Share.share({
      message: rbin
        ? `NBA Certificate of Compliance ${certificate.certificate_number}, RBIN ${rbin}.`
        : `NBA Certificate of Compliance ${certificate.certificate_number}.`,
    });
  }

  return (
    <Card style={styles.card}>
      {/*
        The mockup shows a photographic thumbnail of the certificate. There is
        nothing to render one from until PDF generation exists, so grid view
        shows a labelled placeholder rather than a broken image frame. It also
        states plainly when the document is not downloadable yet, instead of
        offering a button that would fail.
      */}
      {!compact ? (
        <View style={[styles.thumbnail, revoked && styles.thumbnailRevoked]}>
          <MaterialIcons
            name={revoked ? 'gpp-bad' : 'workspace-premium'}
            size={40}
            color={revoked ? palette.danger : palette.primary}
          />
          <Text style={[styles.thumbnailText, revoked && styles.thumbnailTextRevoked]}>
            {certificate.pdf_url !== null ? 'Certificate of Compliance' : 'Document being prepared'}
          </Text>
          <View style={styles.thumbnailBadge}>
            <Text style={styles.thumbnailBadgeText}>{revoked ? 'REVOKED' : 'VALID'}</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.cardHeader}>
        <Badge label={issuedYear} surface={palette.surfaceMuted} color={palette.textMuted} />
        {revoked ? (
          <Badge label="Revoked" surface={palette.dangerSurface} color={palette.danger} />
        ) : (
          <Badge label="Official Issue" />
        )}
      </View>

      <Text style={styles.title}>Certificate of Compliance</Text>
      {certificate.transactions !== null && !compact ? (
        <Text style={styles.documentType}>
          {documentTypeLabels[certificate.transactions.document_type]}
        </Text>
      ) : null}

      <View style={styles.meta}>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>RBIN</Text>
          <Text style={styles.metaValue}>{certificate.transactions?.rbin ?? 'Not issued'}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Date Issued</Text>
          <Text style={styles.metaValue}>
            {new Date(certificate.issued_at).toLocaleDateString()}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Button
          label="View Certificate"
          onPress={() => router.push(`/certificate/${certificate.id}`)}
          style={styles.actionsPrimary}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share certificate"
          onPress={handleShare}
          style={styles.shareButton}>
          <MaterialIcons name="share" size={20} color={palette.primary} />
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  loader: {
    marginTop: spacing.xl,
  },
  card: {
    marginBottom: spacing.md,
  },
  thumbnail: {
    height: 150,
    borderRadius: radius.input,
    backgroundColor: palette.successSurface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  thumbnailRevoked: {
    backgroundColor: palette.dangerSurface,
  },
  thumbnailText: {
    fontSize: fontSize.caption,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.primaryText,
  },
  thumbnailTextRevoked: {
    color: palette.danger,
  },
  thumbnailBadge: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    backgroundColor: palette.text,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  thumbnailBadgeText: {
    fontSize: 10,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.textInverse,
    letterSpacing: 0.5,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.title,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.text,
  },
  documentType: {
    fontSize: fontSize.label,
    color: palette.textMuted,
    marginTop: spacing.xs,
  },
  meta: {
    flexDirection: 'row',
    backgroundColor: palette.surfaceMuted,
    borderRadius: 8,
    padding: spacing.md,
    marginVertical: spacing.md,
    gap: spacing.lg,
  },
  metaItem: {
    flex: 1,
  },
  metaLabel: {
    fontSize: fontSize.caption,
    color: palette.textMuted,
  },
  metaValue: {
    fontSize: fontSize.label,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
    color: palette.primary,
    marginTop: spacing.xs,
  },
  viewToggle: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: palette.surfaceMuted,
    borderRadius: 8,
    padding: spacing.xs,
    marginBottom: spacing.lg,
    gap: spacing.xs,
  },
  viewOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 6,
  },
  viewOptionSelected: {
    backgroundColor: palette.surface,
  },
  viewOptionLabel: {
    fontSize: fontSize.label,
    color: palette.textMuted,
  },
  viewOptionLabelSelected: {
    color: palette.text,
    fontFamily: fontFamily.bodySemibold,
    fontWeight: fontWeight.semibold,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionsPrimary: {
    flex: 1,
  },
  shareButton: {
    width: 48,
    height: 48,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
  },
  archive: {
    alignItems: 'center',
    padding: spacing.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: palette.borderStrong,
    borderRadius: 12,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  archiveText: {
    fontSize: fontSize.label,
    color: palette.textMuted,
    textAlign: 'center',
  },
  archiveLink: {
    fontSize: fontSize.label,
    fontFamily: fontFamily.bodyBold,
    fontWeight: fontWeight.bold,
    color: palette.primary,
  },
  emptyText: {
    fontSize: fontSize.body,
    color: palette.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    paddingVertical: spacing.lg,
  },
  errorText: {
    fontSize: fontSize.body,
    color: palette.danger,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
});
