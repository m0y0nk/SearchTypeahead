import crypto from 'crypto';

interface VirtualNode {
  hash: number;
  physicalNode: string;
}

export class ConsistentHashRing {
  private nodes: Map<string, number> = new Map();
  private virtualNodes: VirtualNode[] = [];
  private replicas: number;

  constructor(nodes: string[], replicas: number = 50) {
    this.replicas = replicas;
    for (const node of nodes) {
      this.addNode(node);
    }
  }

  // FNV-1a hash function for strings
  private hashString(str: string): number {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return hash >>> 0; // Convert to unsigned 32-bit integer
  }

  public addNode(node: string) {
    if (this.nodes.has(node)) return;
    this.nodes.set(node, 1);
    for (let i = 0; i < this.replicas; i++) {
      const virtualNodeName = `${node}#${i}`;
      const hash = this.hashString(virtualNodeName);
      this.virtualNodes.push({ hash, physicalNode: node });
    }
    this.virtualNodes.sort((a, b) => a.hash - b.hash);
  }

  public removeNode(node: string) {
    if (!this.nodes.has(node)) return;
    this.nodes.delete(node);
    this.virtualNodes = this.virtualNodes.filter((vn) => vn.physicalNode !== node);
  }

  public getNode(key: string): { physicalNode: string; keyHash: number; nodeHash: number } | null {
    if (this.virtualNodes.length === 0) return null;
    
    const hash = this.hashString(key);
    
    // Binary search for the first virtual node with hash >= key hash
    let left = 0;
    let right = this.virtualNodes.length - 1;
    let targetIndex = 0;

    if (hash > this.virtualNodes[right].hash) {
      targetIndex = 0; // Wrap around to the first node
    } else {
      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (this.virtualNodes[mid].hash >= hash) {
          targetIndex = mid;
          right = mid - 1;
        } else {
          left = mid + 1;
        }
      }
    }

    const vn = this.virtualNodes[targetIndex];
    return {
      physicalNode: vn.physicalNode,
      keyHash: hash,
      nodeHash: vn.hash
    };
  }
}
