/**
 * AppearanceSettingsScreen — the Dark / Light / System appearance settings surface.
 *
 * Lives in profile/settings. Renders the `ThemeModeSelector`, reflects the current `mode`, and is
 * styled entirely from tokens (BidClean look in both themes). Changing the mode updates the whole
 * app + native chrome immediately with no restart. Labels come from the `appearance` i18n namespace
 * with en/es parity.
 */

import React from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { makeStyles } from '../../theme';
import { ThemeModeSelector } from './components/ThemeModeSelector';

export function AppearanceSettingsScreen(): React.JSX.Element {
  const { t } = useTranslation('appearance');
  const styles = useStyles();

  return (
    <SafeAreaView style={styles.safeArea} testID="appearance-screen">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{t('title')}</Text>
        <Text style={styles.subtitle}>{t('subtitle')}</Text>

        <Text style={styles.sectionHeader}>{t('section.theme')}</Text>
        <ThemeModeSelector />
        <Text style={styles.hint}>{t('hint')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((theme) => ({
  safeArea: {
    flex: 1,
    backgroundColor: theme.background,
  },
  content: {
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: theme.textSecondary,
    marginTop: 4,
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.accent,
    marginTop: 24,
    marginBottom: 8,
  },
  hint: {
    fontSize: 12,
    color: theme.textMuted,
    marginTop: 12,
  },
}));

export default AppearanceSettingsScreen;
