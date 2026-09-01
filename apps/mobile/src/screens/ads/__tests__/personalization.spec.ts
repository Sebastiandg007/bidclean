/**
 * Unit tests for `derivePersonalizationMode` — the full platform × ATT × UMP matrix.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4 / Property 6. Consent shapes personalization only;
 * ATT is iOS-only and an `unavailable` ATT on Android is never a denial; UNRESOLVED until known.
 */

import { derivePersonalizationMode } from '../personalization';
import {
  PersonalizationMode,
  type ConsentStatus,
  type TrackingAuthorizationStatus,
} from '../ads.types';

const ATT_STATUSES: readonly TrackingAuthorizationStatus[] = [
  'authorized',
  'denied',
  'restricted',
  'not_determined',
  'unavailable',
];

const UMP_STATUSES: readonly ConsentStatus[] = [
  'obtained',
  'not_required',
  'required',
  'unknown',
];

describe('derivePersonalizationMode — iOS', () => {
  it('returns PERSONALIZED only when ATT authorized AND UMP permits', () => {
    for (const ump of ['obtained', 'not_required'] as const) {
      expect(
        derivePersonalizationMode('ios', {
          trackingAuthorizationStatus: 'authorized',
          consentStatus: ump,
        }),
      ).toBe(PersonalizationMode.PERSONALIZED);
    }
  });

  it('returns NON_PERSONALIZED when ATT denies, regardless of UMP', () => {
    for (const att of ['denied', 'restricted'] as const) {
      for (const ump of UMP_STATUSES) {
        expect(
          derivePersonalizationMode('ios', {
            trackingAuthorizationStatus: att,
            consentStatus: ump,
          }),
        ).toBe(PersonalizationMode.NON_PERSONALIZED);
      }
    }
  });

  it('returns NON_PERSONALIZED when UMP is required-not-obtained even if ATT authorized', () => {
    expect(
      derivePersonalizationMode('ios', {
        trackingAuthorizationStatus: 'authorized',
        consentStatus: 'required',
      }),
    ).toBe(PersonalizationMode.NON_PERSONALIZED);
  });

  it('returns UNRESOLVED while ATT is not_determined and UMP is not withholding', () => {
    expect(
      derivePersonalizationMode('ios', {
        trackingAuthorizationStatus: 'not_determined',
        consentStatus: 'unknown',
      }),
    ).toBe(PersonalizationMode.UNRESOLVED);
  });
});

describe('derivePersonalizationMode — Android (ATT ignored)', () => {
  it('never treats an unavailable ATT as a denial; decides from UMP only', () => {
    expect(
      derivePersonalizationMode('android', {
        trackingAuthorizationStatus: 'unavailable',
        consentStatus: 'obtained',
      }),
    ).toBe(PersonalizationMode.PERSONALIZED);
  });

  it('is invariant to ATT: mode depends only on UMP on Android', () => {
    const expectedByUmp: Record<ConsentStatus, PersonalizationMode> = {
      obtained: PersonalizationMode.PERSONALIZED,
      not_required: PersonalizationMode.PERSONALIZED,
      required: PersonalizationMode.NON_PERSONALIZED,
      unknown: PersonalizationMode.UNRESOLVED,
    };
    for (const att of ATT_STATUSES) {
      for (const ump of UMP_STATUSES) {
        expect(
          derivePersonalizationMode('android', {
            trackingAuthorizationStatus: att,
            consentStatus: ump,
          }),
        ).toBe(expectedByUmp[ump]);
      }
    }
  });
});

describe('derivePersonalizationMode — totality', () => {
  it('returns a valid mode for every platform × ATT × UMP combination', () => {
    const valid = new Set<PersonalizationMode>(Object.values(PersonalizationMode));
    for (const platform of ['ios', 'android'] as const) {
      for (const att of ATT_STATUSES) {
        for (const ump of UMP_STATUSES) {
          const mode = derivePersonalizationMode(platform, {
            trackingAuthorizationStatus: att,
            consentStatus: ump,
          });
          expect(valid.has(mode)).toBe(true);
        }
      }
    }
  });
});
