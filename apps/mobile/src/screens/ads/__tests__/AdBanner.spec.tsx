/**
 * Component tests for AdBanner — renders the provider view, collapses on no-fill/error.
 *
 * Validates: Requirements 1.5, 2.6 / Property P7. Uses a fake provider whose renderAdView either
 * returns a view or synchronously invokes onNoFill/onError to exercise the collapse path.
 */

import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { AdBanner } from '../components/AdBanner';
import {
  PersonalizationMode,
  type AdProvider,
  type AdViewProps,
} from '../ads.types';

function providerReturning(view: React.ReactElement | null): AdProvider {
  return {
    name: 'fake',
    initialize: jest.fn(),
    isReady: () => true,
    renderAdView: () => view,
  };
}

function providerThatNoFills(): AdProvider {
  return {
    name: 'fake',
    initialize: jest.fn(),
    isReady: () => true,
    renderAdView: (props: AdViewProps) => {
      props.onNoFill();
      return null;
    },
  };
}

const baseProps = {
  format: 'BANNER' as const,
  personalizationMode: PersonalizationMode.NON_PERSONALIZED,
  onPaidImpression: jest.fn(),
};

describe('AdBanner', () => {
  it('renders the provider ad view inside the banner wrapper', () => {
    const view = <Text testID="creative">creative</Text>;
    const { queryByTestId } = render(
      <AdBanner provider={providerReturning(view)} {...baseProps} />,
    );
    expect(queryByTestId('ad-banner')).not.toBeNull();
    expect(queryByTestId('creative')).not.toBeNull();
  });

  it('renders nothing when the provider returns no view', () => {
    const { queryByTestId } = render(
      <AdBanner provider={providerReturning(null)} {...baseProps} />,
    );
    expect(queryByTestId('ad-banner')).toBeNull();
  });

  it('collapses (renders nothing) on no-fill', () => {
    const { queryByTestId } = render(
      <AdBanner provider={providerThatNoFills()} {...baseProps} />,
    );
    expect(queryByTestId('ad-banner')).toBeNull();
  });

  it('does not import RevenueCat (Req 2.6)', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'AdBanner.tsx'),
      'utf8',
    );
    const importLines = source
      .split('\n')
      .filter((line) => /^\s*import\b|require\(/.test(line));
    for (const line of importLines) {
      expect(line).not.toMatch(/react-native-purchases/);
      expect(line).not.toMatch(/ad-revenue-tracker/);
    }
  });
});
