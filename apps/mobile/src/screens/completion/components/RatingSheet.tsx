/**
 * RatingSheet — stars 1..5 + an optional comment (Spec 20).
 *
 * A captured (never gating) rating. The submit CTA uses the BidClean accent. Once the caller's side
 * has been rated it shows a thanks message instead of the form. All copy via i18n.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  COMPLETION_COLORS,
  COMPLETION_I18N_KEYS,
  COMPLETION_RATING_MAX_STARS,
  COMPLETION_RATING_MIN_STARS,
} from '../completion.constants';

export interface RatingSheetProps {
  readonly alreadyRated: boolean;
  readonly disabled: boolean;
  readonly onSubmit: (stars: number, comment?: string) => void;
}

const STAR_VALUES: readonly number[] = Array.from(
  { length: COMPLETION_RATING_MAX_STARS - COMPLETION_RATING_MIN_STARS + 1 },
  (_unused, index) => COMPLETION_RATING_MIN_STARS + index,
);

export function RatingSheet({ alreadyRated, disabled, onSubmit }: RatingSheetProps): React.JSX.Element {
  const { t } = useTranslation();
  const [stars, setStars] = useState<number>(0);
  const [comment, setComment] = useState<string>('');

  if (alreadyRated) {
    return (
      <View style={styles.container} testID="rating-sheet-thanks">
        <Text style={styles.thanks}>{t(COMPLETION_I18N_KEYS.RATE_THANKS)}</Text>
      </View>
    );
  }

  const canSubmit = stars >= COMPLETION_RATING_MIN_STARS && !disabled;

  return (
    <View style={styles.container} testID="rating-sheet">
      <Text style={styles.title}>{t(COMPLETION_I18N_KEYS.RATE_TITLE)}</Text>
      <Text style={styles.prompt}>{t(COMPLETION_I18N_KEYS.RATE_PROMPT)}</Text>
      <View style={styles.stars}>
        {STAR_VALUES.map((value) => (
          <TouchableOpacity
            key={value}
            onPress={() => setStars(value)}
            testID={`rating-star-${value}`}
          >
            <Text style={[styles.star, value <= stars && styles.starActive]}>★</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={styles.comment}
        placeholder={t(COMPLETION_I18N_KEYS.RATE_COMMENT_PLACEHOLDER)}
        placeholderTextColor={COMPLETION_COLORS.TEXT_SECONDARY}
        value={comment}
        onChangeText={setComment}
        multiline
        testID="rating-comment"
      />
      <TouchableOpacity
        style={[styles.submit, !canSubmit && styles.disabled]}
        onPress={() => onSubmit(stars, comment)}
        disabled={!canSubmit}
        testID="rating-submit"
      >
        <Text style={styles.submitText}>{t(COMPLETION_I18N_KEYS.RATE_SUBMIT)}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COMPLETION_COLORS.CARD,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  title: {
    color: COMPLETION_COLORS.TEXT,
    fontSize: 18,
    fontWeight: '700',
  },
  prompt: {
    color: COMPLETION_COLORS.TEXT_SECONDARY,
    fontSize: 14,
  },
  stars: {
    flexDirection: 'row',
    gap: 8,
  },
  star: {
    color: COMPLETION_COLORS.TEXT_SECONDARY,
    fontSize: 32,
  },
  starActive: {
    color: COMPLETION_COLORS.ACCENT,
  },
  comment: {
    backgroundColor: COMPLETION_COLORS.BACKGROUND,
    borderRadius: 8,
    color: COMPLETION_COLORS.TEXT,
    minHeight: 64,
    padding: 12,
    textAlignVertical: 'top',
  },
  submit: {
    backgroundColor: COMPLETION_COLORS.ACCENT,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitText: {
    color: COMPLETION_COLORS.BACKGROUND,
    fontSize: 15,
    fontWeight: '700',
  },
  thanks: {
    color: COMPLETION_COLORS.ACCENT,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
});
