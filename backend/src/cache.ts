import { createClient, RedisClientType } from 'redis';
import { ConsistentHashRing } from './hashring';
import { Suggestion, CacheDebugResponse } from './types';
import dotenv from 'dotenv';

dotenv.config();

export class CacheManager {
  private ring: ConsistentHashRing;
  private clients: Map<string, RedisClientType> = new Map();
  public ready: boolean = false;

  constructor() {
    const nodesEnv = process.env.REDIS_NODES || 'redis-1:6379,redis-2:6379,redis-3:6379';
    const nodeConfigs = nodesEnv.split(',').map(n => n.trim());
    
    // Initialize hash ring with nodes (e.g. 'redis-1:6379')
    this.ring = new ConsistentHashRing(nodeConfigs, 50);

    // Initialize Redis clients
    for (const node of nodeConfigs) {
      const [host, port] = node.split(':');
      const client = createClient({
        url: `redis://${host}:${port || 6379}`
      });

      client.on('error', (err) => {
        console.error(`Redis client error on node ${node}:`, err);
      });

      this.clients.set(node, client as RedisClientType);
    }
  }

  public async connect() {
    const connectPromises = Array.from(this.clients.entries()).map(async ([node, client]) => {
      try {
        await client.connect();
        console.log(`Connected to Redis node: ${node}`);
      } catch (err) {
        console.error(`Failed to connect to Redis node ${node}:`, err);
      }
    });
    
    await Promise.allSettled(connectPromises);
    this.ready = true;
  }

  private getClientForPrefix(prefix: string) {
    const ringInfo = this.ring.getNode(prefix);
    if (!ringInfo) return null;
    return {
      client: this.clients.get(ringInfo.physicalNode),
      ringInfo
    };
  }

  public async getSuggestions(prefix: string, algorithm: 'basic' | 'decay'): Promise<{ suggestions: Suggestion[] | null, isHit: boolean, ringInfo: any }> {
    const route = this.getClientForPrefix(prefix);
    if (!route || !route.client) return { suggestions: null, isHit: false, ringInfo: null };

    const key = `suggest:${algorithm}:${prefix}`;
    try {
      const data = await route.client.get(key);
      if (data) {
        return { suggestions: JSON.parse(data), isHit: true, ringInfo: route.ringInfo };
      }
    } catch (err) {
      console.error('Error fetching from Redis:', err);
    }
    return { suggestions: null, isHit: false, ringInfo: route.ringInfo };
  }

  public async setSuggestions(prefix: string, algorithm: 'basic' | 'decay', suggestions: Suggestion[], ttlSeconds: number = 60) {
    const route = this.getClientForPrefix(prefix);
    if (!route || !route.client) return;

    const key = `suggest:${algorithm}:${prefix}`;
    try {
      await route.client.setEx(key, ttlSeconds, JSON.stringify(suggestions));
    } catch (err) {
      console.error('Error setting Redis cache:', err);
    }
  }

  public async invalidatePrefix(prefix: string) {
    const route = this.getClientForPrefix(prefix);
    if (!route || !route.client) return;

    try {
      await route.client.del(`suggest:basic:${prefix}`);
      await route.client.del(`suggest:decay:${prefix}`);
    } catch (err) {
      console.error('Error invalidating Redis cache:', err);
    }
  }

  public async getDebugInfo(prefix: string, algorithm: 'basic' | 'decay' = 'basic'): Promise<CacheDebugResponse> {
    const route = this.getClientForPrefix(prefix);
    if (!route || !route.client) {
      return {
        prefix,
        nodeName: 'unknown',
        isHit: false,
        nodeIndex: 0,
        totalNodes: this.clients.size,
        cachedValue: null
      };
    }

    const key = `suggest:${algorithm}:${prefix}`;
    let isHit = false;
    let ttl: number | undefined = undefined;
    let cachedValue = null;

    try {
      const data = await route.client.get(key);
      if (data) {
        isHit = true;
        cachedValue = JSON.parse(data);
        ttl = await route.client.ttl(key);
      }
    } catch (err) {
      console.error('Error fetching debug info from Redis:', err);
    }

    // Determine node index simply by its position in the Map keys
    const nodes = Array.from(this.clients.keys());
    const nodeIndex = nodes.indexOf(route.ringInfo.physicalNode) + 1;

    return {
      prefix,
      nodeName: route.ringInfo.physicalNode,
      isHit,
      ttl: ttl !== undefined && ttl >= 0 ? ttl : undefined,
      nodeIndex,
      totalNodes: nodes.length,
      cachedValue
    };
  }
}

export const cacheManager = new CacheManager();
