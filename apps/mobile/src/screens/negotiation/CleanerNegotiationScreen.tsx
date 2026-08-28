/**
 * CleanerNegotiationScreen — the Cleaner's accept / counteroffer screen for a
 * single offer. Shows the Accept-at-Host-price action, a counteroffer input with
 * live payout, and tracks the current proposal status + Host response.
 *
 * Direct Accept is allowed even while a PENDING counteroffer exists; doing so
 * supersedes the open counteroffer (communicated via the AcceptBar hint).
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useNegotiationStore } from './useNegotiation';
import { AcceptBar } from './components/AcceptBar';
import { CounterofferInput } from './components/CounterofferInput';
import { ProposalStatusBadge } from './components/ProposalStatusBadge';

const COLORS = {
  background: '#0B0C10',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.6)',
  error: '#FF6B6B',
} as const;

const SPACING = { sm: 8, md: 16, lg: 24 } as const;
const FONT_SIZE = { title: 22, section: 15, error: 13 } as const;

/** Route params for the Cleaner negotiation screen */
export interface CleanerNegotiationRouteParams {
  offerId: string;
  basePriceCents: number;
  currency: string;
  hostFeeRateBps: number;
  cleanerRateBps: number;
}

export interface CleanerNegotiationScreenProps {
  route: { params: CleanerNegotiationRouteParams };
  navigation: { goBack: () => void };
}

export function CleanerNegotiationScreen({
  route,
  navigation,
}: CleanerNegotiationScreenProps): React.JSX.Element {
  const { t } = useTranslation('negotiation');
  const { offerId, basePriceCents, currency, hostFeeRateBps, cleanerRateBps } = route.params;

  const myThreads = useNegotiationStore((s) => s.myThreads);
  const isSubmitting = useNegotiationStore((s) => s.isSubmitting);
  const error = useNegotiationStore((s) => s.error);
  const acceptOffer = useNegotiationStore((s) => s.acceptOffer);
  const submitCounteroffer = useNegotiationStore((s) => s.submitCounteroffer);
  const acceptHostCounter = useNegotiationStore((s) => s.acceptHostCounter);
  const declineHostCounter = useNegotiationStore((s) => s.declineHostCounter);
  const fetchThread = useNegotiationStore((s) => s.fetchThread);

  useEffect(() => {
    void fetchThread(offerId);
  }, [offerId, fetchThread]);

  const thread = myThreads.get(offerId);

  const pendingProposal = useMemo(
    () => thread?.proposals.find((p) => p.status === 'PENDING') ?? null,
    [thread],
  );

  const hasOpenCleanerProposal = pendingProposal?.actor === 'CLEANER';
  const pendingHostCounter = pendingProposal?.actor === 'HOST' ? pendingProposal : null;

  const handleAccept = useCallback(async () => {
    const result = await acceptOffer(offerId);
    if (result.success) {
      navigation.goBack();
    }
  }, [acceptOffer, offerId, navigation]);

  const handleCounteroffer = useCallback(
    async (priceCents: number) => {
      await submitCounteroffer(offerId, priceCents);
    },
    [submitCounteroffer, offerId],
  );

  const handleAcceptHostCounter = useCallback(async () => {
    if (!pendingHostCounter) {
      return;
    }
    const result = await acceptHostCounter(pendingHostCounter.id);
    if (result.success) {
      navigation.goBack();
    }
  }, [acceptHostCounter, pendingHostCounter, navigation]);

  const handleDeclineHostCounter = useCallback(async () => {
    if (!pendingHostCounter) {
      return;
    }
    await declineHostCounter(pendingHostCounter.id);
    void fetchThread(offerId);
  }, [declineHostCounter, pendingHostCounter, fetchThread, offerId]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} testID="cleaner-negotiation-screen">
        <Text style={styles.title}>{t('cleaner.title')}</Text>

        {error && <Text style={styles.error}>{t(error)}</Text>}

        {/* Current proposal status */}
        {pendingProposal && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('cleaner.proposalStatus')}</Text>
            <ProposalStatusBadge status={pendingProposal.status} />
          </View>
        )}

        {/* Host counter-back: accept or decline */}
        {pendingHostCounter && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('cleaner.hostResponded')}</Text>
            <AcceptBar
              priceCents={pendingHostCounter.proposedPriceCents}
              currency={currency}
              disabled={isSubmitting}
              onAccept={handleAcceptHostCounter}
            />
            <TouchableOpacity
              style={styles.declineButton}
              onPress={handleDeclineHostCounter}
              disabled={isSubmitting}
              activeOpacity={0.7}
              accessibilityRole="button"
              testID="decline-host-counter"
            >
              <Text style={styles.declineText}>{t('cleaner.declineCounter')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Accept at Host price (allowed even with an open counteroffer) */}
        {!pendingHostCounter && (
          <View style={styles.section}>
            <AcceptBar
              priceCents={basePriceCents}
              currency={currency}
              disabled={isSubmitting}
              showSupersedeHint={hasOpenCleanerProposal}
              onAccept={handleAccept}
            />
          </View>
        )}

        {/* Counteroffer input (only when no proposal is pending) */}
        {!pendingProposal && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('cleaner.counteroffer')}</Text>
            <CounterofferInput
              basePriceCents={basePriceCents}
              currency={currency}
              hostFeeRateBps={hostFeeRateBps}
              cleanerRateBps={cleanerRateBps}
              perspective="cleaner"
              submitLabel={t('cleaner.submit')}
              disabled={isSubmitting}
              onSubmit={handleCounteroffer}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.md,
    gap: SPACING.lg,
  },
  title: {
    fontSize: FONT_SIZE.title,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  section: {
    gap: SPACING.sm,
  },
  sectionLabel: {
    fontSize: FONT_SIZE.section,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  error: {
    fontSize: FONT_SIZE.error,
    color: COLORS.error,
  },
  declineButton: {
    alignItems: 'center',
    paddingVertical: SPACING.sm,
  },
  declineText: {
    fontSize: FONT_SIZE.section,
    fontWeight: '600',
    color: COLORS.error,
  },
});
