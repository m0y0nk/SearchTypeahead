export interface Suggestion {
  query: string;
  all_time_count?: number;
  decayed_score?: number;
}

export type AlgorithmType = 'basic' | 'decay';

export interface CacheDebugResponse {
  prefix: string;
  nodeName: string;
  isHit: boolean;
  ttl?: number;
  nodeIndex: number;
  totalNodes: number;
  cachedValue: Suggestion[] | null;
}
