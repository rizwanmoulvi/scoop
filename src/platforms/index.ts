import type { Platform } from '../types/market'
import type { PredictionPlatform } from './PredictionPlatform'
import { ProbableAdapter } from './ProbableAdapter'
import { PredictFunAdapter } from './PredictFunAdapter'
import { OpinionAdapter } from './OpinionAdapter'

const registry: Record<Platform, PredictionPlatform> = {
  probable: new ProbableAdapter(),
  predict_fun: new PredictFunAdapter(),
  opinion: new OpinionAdapter(),
}

/**
 * Returns the platform adapter for a given platform key.
 * Throws if platform is not supported.
 */
export function getAdapter(platform: Platform): PredictionPlatform {
  const adapter = registry[platform]
  if (!adapter) throw new Error(`No adapter registered for platform: ${platform}`)
  return adapter
}

export { ProbableAdapter, PredictFunAdapter, OpinionAdapter }
export type { PredictionPlatform }
