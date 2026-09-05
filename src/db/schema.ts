import { pgTable, text, timestamp, boolean, serial, jsonb, numeric, integer, bigint } from 'drizzle-orm/pg-core';

// ── Nonces Table (for SIWE-style Authentication) ───────────────────
export const nonces = pgTable('nonces', {
  id: serial('id').primaryKey(),
  nonce: text('nonce').notNull().unique(),
  walletAddress: text('wallet_address'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  used: boolean('used').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ── Reports Table ──────────────────────────────────────────────────
export const reports = pgTable('reports', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  location: text('location').notNull(),
  severity: text('severity').notNull(),
  desc: text('desc').notNull(),
  evidenceBlobId: text('evidence_blob_id'),
  evidenceUrl: text('evidence_url'),
  mimeType: text('mime_type'),
  walletAddress: text('wallet_address'),
  timestamp: bigint('timestamp', { mode: 'number' }),
  status: text('status').notNull().default('submitted'), // submitted | approved | rejected
  aiAnalysis: jsonb('ai_analysis'),
  evidences: jsonb('evidences'),
  approvedAt: bigint('approved_at', { mode: 'number' }),
  rejectedAt: bigint('rejected_at', { mode: 'number' }),
  rejectionReason: text('rejection_reason'),
});

// ── Campaigns Table (Read-Through Cache of On-Chain State) ─────────
// NOTE: Non-authoritative cache. Authoritative state lives on Sui blockchain.
export const campaigns = pgTable('campaigns', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  tag: text('tag').default('Aid Drive'),
  desc: text('desc'),
  raised: numeric('raised').default('0'),
  goal: numeric('goal').notNull(),
  walletAddress: text('wallet_address'),
  onChainObjectId: text('on_chain_object_id'),
  budgetBlobId: text('budget_blob_id'),
  budgetUrl: text('budget_url'),
  ngoCredentialsBlobId: text('ngo_credentials_blob_id'),
  ngoCredentialsUrl: text('ngo_credentials_url'),
  isDemo: boolean('is_demo').default(false),
  status: integer('status').default(0), // 0: SUBMITTED, 1: VERIFIED, 2: FUNDED, 3: COMPLETED, 4: CANCELLED
  syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow(),
});

// ── Relief Proof Table ─────────────────────────────────────────────
export const reliefProof = pgTable('relief_proof', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id').notNull(),
  title: text('title').notNull(),
  desc: text('desc').notNull(),
  proofBlobId: text('proof_blob_id').notNull(),
  proofUrl: text('proof_url'),
  rawUrl: text('raw_url'),
  mimeType: text('mime_type'),
  timestamp: bigint('timestamp', { mode: 'number' }),
  coordinates: text('coordinates'),
});

// ── Audit Logs Table ───────────────────────────────────────────────
export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  actorWalletAddress: text('actor_wallet_address').notNull(),
  action: text('action').notNull(), // APPROVE_REPORT | REJECT_REPORT | RELEASE_FUNDS | CREATE_CAMPAIGN
  targetId: text('target_id').notNull(),
  priorStatus: text('prior_status'),
  newStatus: text('new_status'),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
  metadata: jsonb('metadata'),
});
