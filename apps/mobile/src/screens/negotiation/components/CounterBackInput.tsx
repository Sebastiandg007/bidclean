/**
 * CounterBackInput — Host counter-back price entry. Thin wrapper over
 * CounterofferInput with the Host perspective and label.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import { CounterofferInput } from './CounterofferInput';

export interface CounterBackInputProps {
  basePriceCents: number;
  currency: string;
  hostFeeRateBps: number;
  cleanerRateBps: number;
  disabled?: boolean;
  onSubmit: (priceCents: number) => void;
}

export function CounterBackInput(props: CounterBackInputProps): React.JSX.Element {
  const { t } = useTranslation('negotiation');

  return (
    <CounterofferInput
      basePriceCents={props.basePriceCents}
      currency={props.currency}
      hostFeeRateBps={props.hostFeeRateBps}
      cleanerRateBps={props.cleanerRateBps}
      perspective="host"
      submitLabel={t('host.counterBack')}
      disabled={props.disabled}
      onSubmit={props.onSubmit}
    />
  );
}
