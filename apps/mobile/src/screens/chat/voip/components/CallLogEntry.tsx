/**
 * CallLogEntry — an inline conversation row summarizing one past call (Spec 15).
 *
 * Renders a call's kind, direction, outcome, and duration consistent with the server's call record.
 * A missed incoming call is visibly indicated (accent). Pure/presentational: it derives its label
 * from the call view + the local user's id; it never fetches. All copy is i18n; BidClean dark tokens.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { VOIP_I18N_KEYS } from '../voip.constants';
import type { CallView } from '../voip.types';
import { VOIP_COLORS, VOIP_FONT_SIZE, VOIP_SPACING } from './voip.tokens';

export interface CallLogEntryProps {
  call: CallView;
  currentUserId: string | null;
}

/** Map a call view + viewer to the i18n key describing its outcome/direction. */
export function callOutcomeKey(call: CallView, currentUserId: string | null): string {
  const isIncoming = currentUserId !== null && call.calleeId === currentUserId;
  switch (call.status) {
    case 'MISSED':
      return VOIP_I18N_KEYS.LOG_MISSED;
    case 'DECLINED':
      return VOIP_I18N_KEYS.LOG_DECLINED;
    case 'CANCELED':
      return VOIP_I18N_KEYS.LOG_CANCELED;
    case 'FAILED':
      return VOIP_I18N_KEYS.LOG_FAILED;
    case 'ENDED':
      return VOIP_I18N_KEYS.LOG_ENDED;
    case 'RINGING':
    case 'ONGOING':
    default:
      return isIncoming ? VOIP_I18N_KEYS.LOG_INCOMING : VOIP_I18N_KEYS.LOG_OUTGOING;
  }
}

/** Whether this row should be highlighted as a missed incoming call. */
export function isMissedIncoming(call: CallView, currentUserId: string | null): boolean {
  const isIncoming = currentUserId !== null && call.calleeId === currentUserId;
  return call.status === 'MISSED' && isIncoming;
}

export function CallLogEntry({ call, currentUserId }: CallLogEntryProps): React.JSX.Element {
  const { t } = useTranslation();
  const outcomeKey = callOutcomeKey(call, currentUserId);
  const missed = isMissedIncoming(call, currentUserId);
  const hasDuration = typeof call.durationSeconds === 'number' && call.durationSeconds > 0;

  return (
    <View style={styles.row} testID={`voip-call-log-${call.id}`}>
      <Text style={styles.icon}>{call.mediaKind === 'VIDEO' ? '🎥' : '☎'}</Text>
      <View style={styles.body}>
        <Text style={[styles.outcome, missed && styles.missed]} testID="voip-call-log-outcome">
          {t(outcomeKey)}
        </Text>
        {hasDuration && (
          <Text style={styles.duration}>
            {t(VOIP_I18N_KEYS.LOG_DURATION, { seconds: call.durationSeconds })}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: VOIP_SPACING.sm,
    paddingVertical: VOIP_SPACING.sm,
    paddingHorizontal: VOIP_SPACING.md,
  },
  icon: {
    fontSize: VOIP_FONT_SIZE.icon,
    color: VOIP_COLORS.textMuted,
  },
  body: {
    flex: 1,
  },
  outcome: {
    fontSize: VOIP_FONT_SIZE.body,
    color: VOIP_COLORS.textPrimary,
  },
  missed: {
    color: VOIP_COLORS.accent,
    fontWeight: '700',
  },
  duration: {
    fontSize: VOIP_FONT_SIZE.caption,
    color: VOIP_COLORS.textMuted,
  },
});

export default CallLogEntry;
