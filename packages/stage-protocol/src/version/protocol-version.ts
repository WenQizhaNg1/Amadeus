import { z } from 'zod';

export const PROTOCOL_VERSION = 1 as const;

export const protocolVersionSchema = z.literal(PROTOCOL_VERSION);

export type ProtocolVersion = z.infer<typeof protocolVersionSchema>;
