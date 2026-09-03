
export type EntityType = string;
export type Relation = string;

export interface Entity {
  id: string;
  type: EntityType;
  key: string;
  label: string;
  aliases: string[];
}

export type EntitySelector =
  | { id: string }
  | { type: EntityType; key: string }
  | { type: EntityType; label: string };

export interface Claim {
  id: string;
  from: string;
  relation: Relation;
  to: string;
  recordedAt: number;
  validFrom?: string;
  validTo?: string;
}

export interface ClaimSource {
  claimId: string;
  conversationId: string;
  recordedAt: number;
}

export interface Supersession {
  claimId: string;
  validTo: string;
}

export interface RememberInput {
  subject: EntitySelector;
  relation: Relation;
  object: EntitySelector;
  validFrom?: string;
  validTo?: string;
  supersedes?: Supersession[];
}

export interface RecallInput {
  claimIds?: string[];
  subject?: EntitySelector;
  subjectType?: EntityType;
  relation?: Relation;
  object?: EntitySelector;
  objectType?: EntityType;
  at?: string;
  includeHistorical?: boolean;
  includeSources?: boolean;
  limit?: number;
}

export interface ForgetInput {
  claimIds: string[];
}

export interface MemoryContext {
  conversationId: string;
  now(): number;
}

export type MemoryErrorCode =
  | 'unsupported_ontology'
  | 'ambiguous_entity'
  | 'entity_not_found'
  | 'invalid_temporal_range'
  | 'unknown_claim'
  | 'invalid_supersession';

export interface MemoryError {
  ok: false;
  error: MemoryErrorCode;
  message: string;
  candidates?: Entity[];
  claimIds?: string[];
}

export interface RecalledClaim extends Claim {
  subject: Entity;
  object: Entity;
  sources?: ClaimSource[];
}

export interface RememberResult {
  ok: true;
  claim: RecalledClaim;
  created: boolean;
}

export interface RecallResult {
  ok: true;
  claims: RecalledClaim[];
  truncated: boolean;
}

export interface ForgetResult {
  ok: true;
  deleted: string[];
  notFound: string[];
  rejected: string[];
}

export interface Memory {
  remember(
    input: RememberInput,
    context: MemoryContext,
  ): Promise<RememberResult | MemoryError>;
  recall(input: RecallInput): Promise<RecallResult | MemoryError>;
  forget(input: ForgetInput): Promise<ForgetResult>;
}
