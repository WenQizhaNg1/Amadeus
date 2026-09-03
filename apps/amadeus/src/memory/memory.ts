
// 信念图中的一个节点
export interface Node {
  id: string;
  content?: Content | undefined;
}

export type Content =
  | {
      kind: 'inline';
      value: unknown;
    }
  | {
      kind: 'ref';
      uri: string;
    };

// 信念
export interface Claim {
  id: string;
  from: string;
  to: string;
  relation: string;
  createdAt: number;
}

export interface Memory {
  addNode(node: Node): Promise<void>;
  getNode(id: string): Promise<Node | undefined>;
  addClaim(claim: Claim): Promise<void>;
  getClaim(id: string): Promise<Claim | undefined>;
  findClaims(nodeId: string): Promise<Claim[]>;
}
