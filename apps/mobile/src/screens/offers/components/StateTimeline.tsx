/**
 * StateTimeline — Vertical timeline showing offer state transitions.
 *
 * Displays chronological state progression with:
 * - Left column: vertical line with dots at each transition
 * - Right column: state label (i18n) + formatted timestamp + triggered_by
 * - Current (latest) state highlighted with accent color dot and bold text
 * - Past states shown with muted dots and text
 *
 * If no transitions exist, shows a single entry for the current state.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation, type TFunction } from 'react-i18next';

import { COLORS, SPACING, FONT_SIZE, STATE_COLORS } from '../offers.constants';
import type { OfferState, OfferStateTransition } from '../offers.types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StateTimelineProps {
  /** State transition history from the API */
  transitions: OfferStateTransition[];
  /** Current state of the offer */
  currentState: OfferState;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DOT_SIZE = 12;
const DOT_SIZE_ACTIVE = 16;
const LINE_WIDTH = 2;
const BORDER_RADIUS = 12;
const RELATIVE_THRESHOLD_MS = 86_400_000; // 24 hours
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const MS_PER_SECOND = 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Formats a timestamp as relative (e.g., "5m ago") if within 24h,
 * otherwise as absolute date/time string.
 */
function formatTimestamp(isoDate: string, t: TFunction): string {
  const date = new Date(isoDate);
  const now = Date.now();
  const diffMs = now - date.getTime();

  if (diffMs < 0 || diffMs > RELATIVE_THRESHOLD_MS) {
    return formatAbsolute(date);
  }

  return formatRelative(diffMs, t);
}

function formatRelative(diffMs: number, t: TFunction): string {
  const seconds = Math.floor(diffMs / MS_PER_SECOND);
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);

  if (hours > 0) {
    return t('offers.stateTimeline.hoursAgo', { count: hours });
  }
  if (minutes > 0) {
    return t('offers.stateTimeline.minutesAgo', { count: minutes });
  }
  return t('offers.stateTimeline.justNow');
}

function formatAbsolute(date: Date): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function StateTimeline({
  transitions,
  currentState,
}: StateTimelineProps): React.JSX.Element {
  const { t } = useTranslation();

  /** Build sorted entries (oldest first) with fallback for empty transitions */
  const entries = useMemo(() => {
    if (transitions.length === 0) {
      return [
        {
          id: 'initial',
          state: currentState,
          triggeredBy: null,
          createdAt: new Date().toISOString(),
          isCurrent: true,
        },
      ];
    }

    const sorted = [...transitions].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    return sorted.map((transition, index) => ({
      id: transition.id,
      state: transition.toState,
      triggeredBy: transition.triggeredBy,
      createdAt: transition.createdAt,
      isCurrent: index === sorted.length - 1,
    }));
  }, [transitions, currentState]);

  return (
    <View
      style={styles.container}
      accessibilityRole="list"
      accessibilityLabel={t('offers.stateTimeline.a11yLabel')}
      testID="state-timeline"
    >
      <Text style={styles.title}>
        {t('offers.stateTimeline.title')}
      </Text>

      {entries.map((entry, index) => {
        const isLast = index === entries.length - 1;
        const dotColor = entry.isCurrent
          ? COLORS.accent
          : STATE_COLORS[entry.state] ?? COLORS.textSecondary;

        return (
          <View
            key={entry.id}
            style={styles.entry}
            accessibilityRole="listitem"
            accessibilityLabel={t('offers.stateTimeline.entryA11y', {
              state: t(`offers.state.${entry.state}`),
              time: formatTimestamp(entry.createdAt, t),
            })}
          >
            {/* Left column: line + dot */}
            <View style={styles.leftColumn}>
              <View
                style={[
                  styles.dot,
                  entry.isCurrent ? styles.dotActive : styles.dotPast,
                  { backgroundColor: dotColor },
                ]}
              />
              {!isLast && <View style={styles.line} />}
            </View>

            {/* Right column: state label + timestamp + triggered_by */}
            <View style={styles.rightColumn}>
              <Text
                style={[
                  styles.stateLabel,
                  entry.isCurrent && styles.stateLabelActive,
                ]}
              >
                {t(`offers.state.${entry.state}`)}
              </Text>

              <Text style={styles.timestamp}>
                {formatTimestamp(entry.createdAt, t)}
              </Text>

              {entry.triggeredBy && (
                <Text style={styles.triggeredBy}>
                  {entry.triggeredBy}
                </Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS,
    padding: SPACING.md,
  },
  title: {
    fontSize: FONT_SIZE.subtitle,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: SPACING.md,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  entry: {
    flexDirection: 'row',
    minHeight: 48,
  },
  leftColumn: {
    width: 28,
    alignItems: 'center',
  },
  dot: {
    borderRadius: DOT_SIZE,
    marginTop: 4,
  },
  dotActive: {
    width: DOT_SIZE_ACTIVE,
    height: DOT_SIZE_ACTIVE,
    borderWidth: 2,
    borderColor: COLORS.accent,
  },
  dotPast: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    opacity: 0.6,
  },
  line: {
    width: LINE_WIDTH,
    flex: 1,
    backgroundColor: COLORS.border,
    marginVertical: SPACING.xs,
  },
  rightColumn: {
    flex: 1,
    paddingLeft: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  stateLabel: {
    fontSize: FONT_SIZE.body,
    fontWeight: '400',
    color: COLORS.textSecondary,
  },
  stateLabelActive: {
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  timestamp: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  triggeredBy: {
    fontSize: FONT_SIZE.caption,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    marginTop: 2,
    opacity: 0.7,
  },
});

export default StateTimeline;
