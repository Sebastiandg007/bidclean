/**
 * HostCounterofferInboxScreen — the Host's inbox of incoming Cleaner
 * counteroffers, grouped by offer, with Accept / Reject / Counter actions.
 * Updates in real time as new counteroffers arrive (via the store).
 */

import React, { useCallback, useEffect } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useNegotiationStore } from './useNegotiation';
import type { HostInboxItem } from './negotiation.types';
import { HostCounterofferCard } from './components/HostCounterofferCard';
import { makeStyles, useTheme } from '../../theme';

const SPACING = { md: 16, lg: 24, xxl: 48 } as const;
const FONT_SIZE = { title: 22, empty: 15, error: 13 } as const;

export function HostCounterofferInboxScreen(): React.JSX.Element {
  const { t } = useTranslation('negotiation');
  const styles = useStyles();
  const { theme } = useTheme();

  const inbox = useNegotiationStore((s) => s.inbox);
  const isLoadingInbox = useNegotiationStore((s) => s.isLoadingInbox);
  const isSubmitting = useNegotiationStore((s) => s.isSubmitting);
  const error = useNegotiationStore((s) => s.error);
  const fetchInbox = useNegotiationStore((s) => s.fetchInbox);
  const acceptCounteroffer = useNegotiationStore((s) => s.acceptCounteroffer);
  const rejectCounteroffer = useNegotiationStore((s) => s.rejectCounteroffer);
  const counterBack = useNegotiationStore((s) => s.counterBack);

  useEffect(() => {
    void fetchInbox();
  }, [fetchInbox]);

  const handleAccept = useCallback(
    (proposalId: string) => {
      void acceptCounteroffer(proposalId);
    },
    [acceptCounteroffer],
  );

  const handleReject = useCallback(
    (proposalId: string) => {
      void rejectCounteroffer(proposalId);
    },
    [rejectCounteroffer],
  );

  const handleCounter = useCallback(
    (proposalId: string, priceCents: number) => {
      void counterBack(proposalId, priceCents);
    },
    [counterBack],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<HostInboxItem>): React.JSX.Element => (
      <HostCounterofferCard
        item={item}
        basePriceCents={item.basePriceCents}
        hostFeeRateBps={item.hostFeeRateBps}
        cleanerRateBps={item.cleanerRateBps}
        disabled={isSubmitting}
        onAccept={handleAccept}
        onReject={handleReject}
        onCounter={handleCounter}
      />
    ),
    [isSubmitting, handleAccept, handleReject, handleCounter],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('host.inboxTitle')}</Text>
      </View>

      {error && <Text style={styles.error}>{t(error)}</Text>}

      <FlatList<HostInboxItem>
        data={inbox}
        renderItem={renderItem}
        keyExtractor={(item) => item.proposal.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isLoadingInbox}
            onRefresh={fetchInbox}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
        ListEmptyComponent={
          !isLoadingInbox ? (
            <View style={styles.empty} testID="host-inbox-empty">
              <Text style={styles.emptyText}>{t('host.empty')}</Text>
            </View>
          ) : null
        }
        showsVerticalScrollIndicator={false}
        testID="host-counteroffer-inbox"
      />
    </SafeAreaView>
  );
}

const useStyles = makeStyles((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  header: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  listContent: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.lg,
  },
  empty: {
    paddingTop: SPACING.xxl,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: FONT_SIZE.empty,
    color: theme.textSecondary,
  },
  error: {
    fontSize: FONT_SIZE.error,
    color: theme.danger,
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
  },
}));
