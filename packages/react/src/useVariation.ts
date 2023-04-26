import {useContext} from 'react'
import { Attributes, FeatureKey, VariationValue } from "@featurevisor/types";

import {FeaturevisorContext} from './FeaturevisorContext';

export function useVariation(
  featureKey: FeatureKey,
  attributes: Attributes = {},
): VariationValue | undefined {
  const {sdk, suspend} = useContext(FeaturevisorContext);
  if (suspend && !sdk.isReady()) {
    throw new Promise(resolve => sdk.on('ready', resolve))
  }

  return sdk.getVariation(featureKey, attributes);
}
