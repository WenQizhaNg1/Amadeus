import { asc, eq, or } from 'drizzle-orm';

import type { Database } from '../storage/database.ts';
import { claims, nodes } from '../storage/schema.ts';
import type { Claim, Memory, Node } from './memory.ts';

export class DatabaseMemory implements Memory {
  constructor(readonly database: Database) {}

  async addNode(node: Node): Promise<void> {
    await this.database.insert(nodes).values(node);
  }

  async getNode(id: string): Promise<Node | undefined> {
    const [node] = await this.database
      .select()
      .from(nodes)
      .where(eq(nodes.id, id))
      .limit(1);
    if (!node) {
      return undefined;
    }
    return { id: node.id, content: node.content ?? undefined };
  }

  async addClaim(claim: Claim): Promise<void> {
    await this.database.insert(claims).values(claim);
  }

  async getClaim(id: string): Promise<Claim | undefined> {
    const [claim] = await this.database
      .select()
      .from(claims)
      .where(eq(claims.id, id))
      .limit(1);
    return claim;
  }

  async findClaims(nodeId: string): Promise<Claim[]> {
    return await this.database
      .select()
      .from(claims)
      .where(or(eq(claims.from, nodeId), eq(claims.to, nodeId)))
      .orderBy(asc(claims.createdAt), asc(claims.id));
  }
}
