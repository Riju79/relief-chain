import { drizzle } from 'drizzle-orm/node-postgres';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import pg from 'pg';
import * as schema from './schema.js';
import fs from 'fs';
import path from 'path';

const { Pool } = pg;

let dbInstance: any = null;
let isInitialized = false;

export async function getDb() {
  if (dbInstance) return dbInstance;

  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl && !databaseUrl.includes('placeholder')) {
    try {
      console.log('[ReliefChain DB] Connecting to PostgreSQL via DATABASE_URL...');
      const pool = new Pool({ connectionString: databaseUrl, max: 10 });
      // Test connection
      await pool.query('SELECT 1');
      dbInstance = drizzle(pool, { schema });
      console.log('[ReliefChain DB] Connected to external PostgreSQL database.');
    } catch (err: any) {
      console.warn('[ReliefChain DB] PostgreSQL connection failed, falling back to embedded PGlite:', err.message);
    }
  }

  if (!dbInstance) {
    console.log('[ReliefChain DB] Initializing embedded PostgreSQL (PGlite) engine...');
    const dataDir = path.resolve(process.cwd(), '.pgdata');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const client = new PGlite(dataDir);
    dbInstance = drizzlePglite(client, { schema });
    console.log(`[ReliefChain DB] Embedded PostgreSQL initialized at ${dataDir}`);
  }

  if (!isInitialized) {
    await initializeTables(dbInstance);
    isInitialized = true;
  }

  return dbInstance;
}

/**
 * Ensures all relational tables exist and seeds initial data from metadata_db.json if empty.
 */
async function initializeTables(db: any) {
  // Execute raw DDL statements to ensure tables exist
  const createStatements = [
    `CREATE TABLE IF NOT EXISTS nonces (
      id SERIAL PRIMARY KEY,
      nonce TEXT NOT NULL UNIQUE,
      wallet_address TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
    `CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      location TEXT NOT NULL,
      severity TEXT NOT NULL,
      "desc" TEXT NOT NULL,
      evidence_blob_id TEXT,
      evidence_url TEXT,
      mime_type TEXT,
      wallet_address TEXT,
      timestamp BIGINT,
      status TEXT NOT NULL DEFAULT 'submitted',
      ai_analysis JSONB,
      evidences JSONB,
      approved_at BIGINT,
      rejected_at BIGINT,
      rejection_reason TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      tag TEXT DEFAULT 'Aid Drive',
      "desc" TEXT,
      raised NUMERIC DEFAULT '0',
      goal NUMERIC NOT NULL,
      wallet_address TEXT,
      on_chain_object_id TEXT,
      budget_blob_id TEXT,
      budget_url TEXT,
      ngo_credentials_blob_id TEXT,
      ngo_credentials_url TEXT,
      is_demo BOOLEAN DEFAULT FALSE,
      status INTEGER DEFAULT 0,
      synced_at TIMESTAMPTZ DEFAULT NOW()
    );`,
    `CREATE TABLE IF NOT EXISTS relief_proof (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      title TEXT NOT NULL,
      "desc" TEXT NOT NULL,
      proof_blob_id TEXT NOT NULL,
      proof_url TEXT,
      raw_url TEXT,
      mime_type TEXT,
      timestamp BIGINT,
      coordinates TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      actor_wallet_address TEXT NOT NULL,
      action TEXT NOT NULL,
      target_id TEXT NOT NULL,
      prior_status TEXT,
      new_status TEXT,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      metadata JSONB
    );`
  ];

  try {
    for (const sql of createStatements) {
      if (db.client?.query) {
        await db.client.query(sql);
      } else if (db.session?.client?.query) {
        await db.session.client.query(sql);
      }
    }
    console.log('[ReliefChain DB] ✔ All database tables verified.');
  } catch (err: any) {
    console.warn('[ReliefChain DB] Table init warning:', err.message);
  }

  // Seed data from metadata_db.json if tables are empty
  try {
    const metadataPath = path.resolve(process.cwd(), 'metadata_db.json');
    if (fs.existsSync(metadataPath)) {
      const raw = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      
      // Check if campaigns table is empty
      const existingCampaigns = await db.select().from(schema.campaigns).limit(1);
      if (existingCampaigns.length === 0 && Array.isArray(raw.campaigns)) {
        console.log(`[ReliefChain DB] Seeding ${raw.campaigns.length} campaigns from metadata_db.json...`);
        for (const c of raw.campaigns) {
          await db.insert(schema.campaigns).values({
            id: c.id,
            title: c.title,
            tag: c.tag || 'Aid Drive',
            desc: c.desc || '',
            raised: String(c.raised || 0),
            goal: String(c.goal || 0),
            walletAddress: c.walletAddress || '',
            onChainObjectId: c.onChainObjectId || null,
            budgetBlobId: c.budgetBlobId || '',
            budgetUrl: c.budgetUrl || '',
            ngoCredentialsBlobId: c.ngoCredentialsBlobId || '',
            ngoCredentialsUrl: c.ngoCredentialsUrl || '',
            isDemo: Boolean(c.isDemo),
            status: c.status || 0,
          }).onConflictDoNothing();
        }
      }

      // Check if reports table is empty
      const existingReports = await db.select().from(schema.reports).limit(1);
      if (existingReports.length === 0 && Array.isArray(raw.reports)) {
        console.log(`[ReliefChain DB] Seeding ${raw.reports.length} reports from metadata_db.json...`);
        for (const r of raw.reports) {
          await db.insert(schema.reports).values({
            id: r.id,
            title: r.title,
            location: r.location,
            severity: r.severity,
            desc: r.desc,
            evidenceBlobId: r.evidenceBlobId || '',
            evidenceUrl: r.evidenceUrl || '',
            mimeType: r.mimeType || '',
            walletAddress: r.walletAddress || '',
            timestamp: r.timestamp || Date.now(),
            status: r.status || 'submitted',
            aiAnalysis: r.aiAnalysis || null,
            evidences: r.evidences || null,
            approvedAt: r.approvedAt || null,
            rejectedAt: r.rejectedAt || null,
            rejectionReason: r.rejectionReason || null,
          }).onConflictDoNothing();
        }
      }

      // Check if relief_proof table is empty
      const existingProof = await db.select().from(schema.reliefProof).limit(1);
      if (existingProof.length === 0 && Array.isArray(raw.reliefProof)) {
        console.log(`[ReliefChain DB] Seeding ${raw.reliefProof.length} proof records from metadata_db.json...`);
        for (const p of raw.reliefProof) {
          await db.insert(schema.reliefProof).values({
            id: p.id,
            campaignId: p.campaignId,
            title: p.title,
            desc: p.desc,
            proofBlobId: p.proofBlobId,
            proofUrl: p.proofUrl || '',
            rawUrl: p.rawUrl || '',
            mimeType: p.mimeType || '',
            timestamp: p.timestamp || Date.now(),
            coordinates: p.coordinates || '',
          }).onConflictDoNothing();
        }
      }
      console.log('[ReliefChain DB] ✔ Database seeding complete.');
    }
  } catch (seedErr: any) {
    console.warn('[ReliefChain DB] Seeding notice:', seedErr.message);
  }
}
