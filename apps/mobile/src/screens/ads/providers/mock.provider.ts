/**
 * MockAdProvider — a deterministic test `AdProvider`.
 *
 * Renders a stable placeholder view (no native SDK) and can emit synthetic `PaidImpression`
 * events, so ad slots render deterministically in CI with ZERO real ad requests (Req 2.2 / 2.4 /
 * P3). Selected under test or when `EXPO_PUBLIC_ADS_PROVIDER=mock` — NEVER as a production
 * fallback (the factory enforces that).
 */

import React from 'react';
import { Text, View } from 'react-native';

import type {
  AdProvider,
  AdProviderContext,
  AdViewProps,
  PaidImpression,
} from '../ads.types';

/** testID for the mock ad view, so component tests can assert deterministic rendering. */
export const MOCK_AD_VIEW_TEST_ID = 'mock-ad-view';

/** Build a deterministic synthetic paid impression for a given event id. */
export function buildSyntheticImpression(
  eventId: string,
  props: Pick<AdViewProps, 'format'>,
): PaidImpression {
  return {
    eventId,
    revenueMicros: 1000,
    currency: 'USD',
    network: 'mock',
    adUnitId: 'mock/banner',
    format: props.format,
    occurredAtMs: 0,
  };
}

export class MockAdProvider implements AdProvider {
  readonly name = 'mock';
  private ready = false;

  async initialize(_context: AdProviderContext): Promise<void> {
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  renderAdView(props: AdViewProps): React.ReactElement {
    return React.createElement(
      View,
      { testID: MOCK_AD_VIEW_TEST_ID },
      React.createElement(Text, null, `mock-ad:${props.format}`),
    );
  }
}
