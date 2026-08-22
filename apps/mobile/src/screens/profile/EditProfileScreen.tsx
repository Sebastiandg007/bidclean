/**
 * EditProfileScreen — Edit personal data + role-specific fields.
 * Saves via split PATCH endpoints: /profile/me, /profile/me/host, /profile/me/cleaner.
 * Includes phone E.164 validation, specialties picker, work zone selector,
 * availability scheduler, and bio input.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import {
  useAuthStore,
  selectActiveRole,
} from '../../stores/auth.store';
import { useProfileStore } from './useProfile';
import {
  VALIDATION,
  WORK_ZONE,
  PREDEFINED_SPECIALTIES,
  WEEKDAYS,
  AVAILABILITY_DEFAULTS,
} from './profile.constants';
import type { ActiveRole } from './profile.types';

// ─── Design Tokens ───────────────────────────────────────────────────────────

const COLORS = {
  background: '#0B0C10',
  card: '#1F2833',
  textPrimary: '#FFFFFF',
  textSecondary: '#C5C6C7',
  accent: '#00F5D4',
  error: '#FF6B6B',
  inputBackground: '#2A3140',
  border: '#3A4250',
} as const;

const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

const FONT_SIZE = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
} as const;

// ─── Constants ───────────────────────────────────────────────────────────────

const PHONE_E164_REGEX = /^\+[1-9]\d{1,14}$/;

// ─── Types ───────────────────────────────────────────────────────────────────

interface DaySchedule {
  enabled: boolean;
  start: string | null;
  end: string | null;
}

type WeeklyAvailability = Record<string, DaySchedule>;

interface FormErrors {
  displayName?: string;
  phoneNumber?: string;
  bio?: string;
}

// ─── Validation Helpers ──────────────────────────────────────────────────────

function validatePhoneE164(phone: string): boolean {
  if (!phone) return true;
  return PHONE_E164_REGEX.test(phone);
}

function validateDisplayName(name: string): string | undefined {
  if (!name.trim()) return 'profile.edit.error.name_required';
  if (name.length > VALIDATION.NAME_MAX_LENGTH) {
    return 'profile.edit.error.name_too_long';
  }
  return undefined;
}

function validateBio(bio: string): string | undefined {
  if (bio.length > VALIDATION.BIO_MAX_LENGTH) {
    return 'profile.edit.error.bio_too_long';
  }
  return undefined;
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }): React.JSX.Element {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

function FieldLabel({ label }: { label: string }): React.JSX.Element {
  return <Text style={styles.fieldLabel}>{label}</Text>;
}

function ErrorText({ message }: { message: string }): React.JSX.Element {
  return <Text style={styles.errorText}>{message}</Text>;
}

function SpecialtyChip({
  label,
  selected,
  onToggle,
  testId,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
  testId: string;
}): React.JSX.Element {
  return (
    <Pressable
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onToggle}
      testID={testId}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function EditProfileScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const activeRole = useAuthStore(selectActiveRole) as ActiveRole | null;

  const profile = useProfileStore((s) => s.profile);
  const updateCommon = useProfileStore((s) => s.updateCommon);
  const updateHost = useProfileStore((s) => s.updateHost);
  const updateCleaner = useProfileStore((s) => s.updateCleaner);

  // ─── Form State (Common) ─────────────────────────────────────────────────

  const [displayName, setDisplayName] = useState(
    profile?.common.displayName ?? '',
  );
  const [phoneNumber, setPhoneNumber] = useState(
    profile?.common.phoneNumber ?? '',
  );

  // ─── Form State (Host) ───────────────────────────────────────────────────

  const [businessName, setBusinessName] = useState(
    profile?.host?.businessName ?? '',
  );

  // ─── Form State (Cleaner) ────────────────────────────────────────────────

  const [specialties, setSpecialties] = useState<string[]>(
    profile?.cleaner?.specialties ?? [],
  );
  const [workZoneLabel, setWorkZoneLabel] = useState(
    profile?.cleaner?.workZoneLabel ?? '',
  );
  const [workZoneRadiusKm, setWorkZoneRadiusKm] = useState(
    profile?.cleaner?.workZoneRadiusKm ?? WORK_ZONE.DEFAULT_RADIUS_KM,
  );
  const [bio, setBio] = useState(profile?.cleaner?.bio ?? '');
  const [availability, setAvailability] = useState<WeeklyAvailability>(
    () => buildInitialAvailability(profile?.cleaner?.availability),
  );

  // ─── UI State ────────────────────────────────────────────────────────────

  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  // ─── Validation ──────────────────────────────────────────────────────────

  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    const nameError = validateDisplayName(displayName);
    if (nameError) newErrors.displayName = nameError;

    if (phoneNumber && !validatePhoneE164(phoneNumber)) {
      newErrors.phoneNumber = 'profile.edit.error.invalid_phone';
    }

    if (activeRole === 'cleaner') {
      const bioError = validateBio(bio);
      if (bioError) newErrors.bio = bioError;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [displayName, phoneNumber, bio, activeRole]);

  // ─── Save Handler ────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!validateForm()) return;

    setIsSaving(true);

    try {
      await updateCommon({
        displayName: displayName.trim(),
        phoneNumber: phoneNumber.trim() || null,
      });

      if (activeRole === 'host') {
        await updateHost({
          businessName: businessName.trim() || null,
        });
      }

      if (activeRole === 'cleaner') {
        await updateCleaner({
          specialties,
          workZoneLabel: workZoneLabel.trim() || null,
          workZoneRadiusKm,
          availability: availability as Record<string, unknown>,
          bio: bio.trim() || null,
        });
      }

      Alert.alert(
        t('profile.edit.success_title'),
        t('profile.edit.success_message'),
      );
      router.back();
    } catch {
      Alert.alert(
        t('profile.edit.error_title'),
        t('profile.edit.error_message'),
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    validateForm,
    updateCommon,
    updateHost,
    updateCleaner,
    displayName,
    phoneNumber,
    businessName,
    specialties,
    workZoneLabel,
    workZoneRadiusKm,
    availability,
    bio,
    activeRole,
    router,
    t,
  ]);

  // ─── Specialty Toggle ────────────────────────────────────────────────────

  const toggleSpecialty = useCallback((specialty: string) => {
    setSpecialties((prev) =>
      prev.includes(specialty)
        ? prev.filter((s) => s !== specialty)
        : [...prev, specialty],
    );
  }, []);

  // ─── Availability Toggle ─────────────────────────────────────────────────

  const toggleDay = useCallback((day: string) => {
    setAvailability((prev) => {
      const current = prev[day] ?? { enabled: false, start: null, end: null };
      const newEnabled = !current.enabled;
      return {
        ...prev,
        [day]: {
          enabled: newEnabled,
          start: newEnabled ? AVAILABILITY_DEFAULTS.START_TIME : null,
          end: newEnabled ? AVAILABILITY_DEFAULTS.END_TIME : null,
        },
      };
    });
  }, []);

  const updateDayTime = useCallback(
    (day: string, field: 'start' | 'end', value: string) => {
      setAvailability((prev) => {
        const current = prev[day] ?? { enabled: false, start: null, end: null };
        return {
          ...prev,
          [day]: { ...current, [field]: value },
        };
      });
    },
    [],
  );

  // ─── Radius Handler ──────────────────────────────────────────────────────

  const handleRadiusChange = useCallback((text: string) => {
    const parsed = parseInt(text, 10);
    if (
      !isNaN(parsed) &&
      parsed >= WORK_ZONE.MIN_RADIUS_KM &&
      parsed <= WORK_ZONE.MAX_RADIUS_KM
    ) {
      setWorkZoneRadiusKm(parsed);
    }
  }, []);

  // ─── Character Counters ──────────────────────────────────────────────────

  const bioCharCount = useMemo(
    () => `${bio.length}/${VALIDATION.BIO_MAX_LENGTH}`,
    [bio],
  );

  // ─── Render ──────────────────────────────────────────────────────────────

  if (!profile) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.emptyText}>
          {t('profile.edit.no_profile')}
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} testID="edit-profile-screen">
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {t('profile.edit.title')}
          </Text>
        </View>

        {/* Common Fields Section */}
        <SectionHeader title={t('profile.edit.section_personal')} />
        <View style={styles.card}>
          <FieldLabel label={t('profile.edit.display_name')} />
          <TextInput
            style={[styles.input, errors.displayName && styles.inputError]}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder={t('profile.edit.display_name_placeholder')}
            placeholderTextColor={COLORS.textSecondary}
            maxLength={VALIDATION.NAME_MAX_LENGTH}
            testID="input-display-name"
          />
          {errors.displayName && (
            <ErrorText message={t(errors.displayName)} />
          )}

          <FieldLabel label={t('profile.edit.phone_number')} />
          <TextInput
            style={[styles.input, errors.phoneNumber && styles.inputError]}
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            placeholder={t('profile.edit.phone_placeholder')}
            placeholderTextColor={COLORS.textSecondary}
            keyboardType="phone-pad"
            testID="input-phone-number"
          />
          {errors.phoneNumber && (
            <ErrorText message={t(errors.phoneNumber)} />
          )}
        </View>

        {/* Host-Specific Fields */}
        {activeRole === 'host' && (
          <>
            <SectionHeader title={t('profile.edit.section_host')} />
            <View style={styles.card}>
              <FieldLabel label={t('profile.edit.business_name')} />
              <TextInput
                style={styles.input}
                value={businessName}
                onChangeText={setBusinessName}
                placeholder={t('profile.edit.business_name_placeholder')}
                placeholderTextColor={COLORS.textSecondary}
                testID="input-business-name"
              />
            </View>
          </>
        )}

        {/* Cleaner-Specific Fields */}
        {activeRole === 'cleaner' && (
          <>
            {/* Specialties */}
            <SectionHeader title={t('profile.edit.section_specialties')} />
            <View style={styles.card}>
              <View style={styles.chipContainer}>
                {PREDEFINED_SPECIALTIES.map((specialty) => (
                  <SpecialtyChip
                    key={specialty}
                    label={t(`profile.specialties.${specialty}`)}
                    selected={specialties.includes(specialty)}
                    onToggle={() => toggleSpecialty(specialty)}
                    testId={`specialty-chip-${specialty}`}
                  />
                ))}
              </View>
            </View>

            {/* Work Zone */}
            <SectionHeader title={t('profile.edit.section_work_zone')} />
            <View style={styles.card}>
              <FieldLabel label={t('profile.edit.work_zone_label')} />
              <TextInput
                style={styles.input}
                value={workZoneLabel}
                onChangeText={setWorkZoneLabel}
                placeholder={t('profile.edit.work_zone_placeholder')}
                placeholderTextColor={COLORS.textSecondary}
                testID="input-work-zone-label"
              />

              <FieldLabel label={t('profile.edit.radius_km')} />
              <View style={styles.radiusRow}>
                <TextInput
                  style={[styles.input, styles.radiusInput]}
                  value={String(workZoneRadiusKm)}
                  onChangeText={handleRadiusChange}
                  keyboardType="numeric"
                  testID="input-radius-km"
                />
                <Text style={styles.radiusUnit}>
                  {t('profile.edit.km_unit')}
                </Text>
              </View>
            </View>

            {/* Availability */}
            <SectionHeader title={t('profile.edit.section_availability')} />
            <View style={styles.card}>
              {WEEKDAYS.map((day) => {
                const schedule = availability[day] ?? {
                  enabled: false,
                  start: null,
                  end: null,
                };
                return (
                  <AvailabilityDayRow
                    key={day}
                    day={day}
                    schedule={schedule}
                    onToggle={() => toggleDay(day)}
                    onChangeStart={(v) => updateDayTime(day, 'start', v)}
                    onChangeEnd={(v) => updateDayTime(day, 'end', v)}
                    t={t}
                  />
                );
              })}
            </View>

            {/* Bio */}
            <SectionHeader title={t('profile.edit.section_bio')} />
            <View style={styles.card}>
              <TextInput
                style={[
                  styles.input,
                  styles.bioInput,
                  errors.bio && styles.inputError,
                ]}
                value={bio}
                onChangeText={setBio}
                placeholder={t('profile.edit.bio_placeholder')}
                placeholderTextColor={COLORS.textSecondary}
                multiline
                maxLength={VALIDATION.BIO_MAX_LENGTH}
                testID="input-bio"
              />
              <Text style={styles.charCount}>{bioCharCount}</Text>
              {errors.bio && <ErrorText message={t(errors.bio)} />}
            </View>
          </>
        )}

        {/* Save Button */}
        <Pressable
          style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={isSaving}
          testID="button-save"
        >
          {isSaving ? (
            <ActivityIndicator color={COLORS.background} size="small" />
          ) : (
            <Text style={styles.saveButtonText}>
              {t('profile.edit.save')}
            </Text>
          )}
        </Pressable>

        {/* Cancel Button */}
        <Pressable
          style={styles.cancelButton}
          onPress={() => router.back()}
          disabled={isSaving}
          testID="button-cancel"
        >
          <Text style={styles.cancelButtonText}>
            {t('profile.edit.cancel')}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Availability Day Row ────────────────────────────────────────────────────

function AvailabilityDayRow({
  day,
  schedule,
  onToggle,
  onChangeStart,
  onChangeEnd,
  t,
}: {
  day: string;
  schedule: DaySchedule;
  onToggle: () => void;
  onChangeStart: (v: string) => void;
  onChangeEnd: (v: string) => void;
  t: (key: string) => string;
}): React.JSX.Element {
  return (
    <View style={styles.dayRow} testID={`availability-${day}`}>
      <View style={styles.dayHeader}>
        <Text style={styles.dayLabel}>
          {t(`profile.edit.days.${day}`)}
        </Text>
        <Switch
          value={schedule.enabled}
          onValueChange={onToggle}
          trackColor={{ false: COLORS.border, true: COLORS.accent }}
          thumbColor={COLORS.textPrimary}
          testID={`switch-${day}`}
        />
      </View>
      {schedule.enabled && (
        <View style={styles.timeRow}>
          <TextInput
            style={[styles.input, styles.timeInput]}
            value={schedule.start ?? ''}
            onChangeText={onChangeStart}
            placeholder={AVAILABILITY_DEFAULTS.START_TIME}
            placeholderTextColor={COLORS.textSecondary}
            testID={`input-${day}-start`}
          />
          <Text style={styles.timeSeparator}>—</Text>
          <TextInput
            style={[styles.input, styles.timeInput]}
            value={schedule.end ?? ''}
            onChangeText={onChangeEnd}
            placeholder={AVAILABILITY_DEFAULTS.END_TIME}
            placeholderTextColor={COLORS.textSecondary}
            testID={`input-${day}-end`}
          />
        </View>
      )}
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildInitialAvailability(
  existing: Record<string, unknown> | null | undefined,
): WeeklyAvailability {
  const defaultSchedule: DaySchedule = {
    enabled: false,
    start: null,
    end: null,
  };

  const result: WeeklyAvailability = {};

  for (const day of WEEKDAYS) {
    if (existing && typeof existing[day] === 'object' && existing[day] !== null) {
      const dayData = existing[day] as Record<string, unknown>;
      result[day] = {
        enabled: Boolean(dayData.enabled),
        start: typeof dayData.start === 'string' ? dayData.start : null,
        end: typeof dayData.end === 'string' ? dayData.end : null,
      };
    } else {
      result[day] = { ...defaultSchedule };
    }
  }

  return result;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: SPACING.md,
    paddingBottom: SPACING.xl * 2,
  },
  centered: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  emptyText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
  },
  header: {
    marginBottom: SPACING.lg,
  },
  headerTitle: {
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  sectionHeader: {
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    color: COLORS.accent,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: SPACING.md,
  },
  fieldLabel: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
    marginTop: SPACING.sm,
  },
  input: {
    backgroundColor: COLORS.inputBackground,
    borderRadius: 8,
    padding: SPACING.sm + 4,
    color: COLORS.textPrimary,
    fontSize: FONT_SIZE.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  inputError: {
    borderColor: COLORS.error,
  },
  bioInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textSecondary,
    textAlign: 'right',
    marginTop: SPACING.xs,
  },
  errorText: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.error,
    marginTop: SPACING.xs,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  chip: {
    paddingHorizontal: SPACING.sm + 4,
    paddingVertical: SPACING.sm,
    borderRadius: 20,
    backgroundColor: COLORS.inputBackground,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipSelected: {
    backgroundColor: '#00F5D422',
    borderColor: COLORS.accent,
  },
  chipText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
  },
  chipTextSelected: {
    color: COLORS.accent,
    fontWeight: '600',
  },
  radiusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  radiusInput: {
    flex: 1,
  },
  radiusUnit: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textSecondary,
  },
  dayRow: {
    marginBottom: SPACING.sm,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dayLabel: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textPrimary,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACING.sm,
    gap: SPACING.sm,
  },
  timeInput: {
    flex: 1,
    textAlign: 'center',
  },
  timeSeparator: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textSecondary,
  },
  saveButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 12,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    color: COLORS.background,
  },
  cancelButton: {
    borderRadius: 12,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  cancelButtonText: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textSecondary,
  },
});

export default EditProfileScreen;
