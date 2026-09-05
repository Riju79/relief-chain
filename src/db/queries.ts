import { getDb } from './client.js';
import * as schema from './schema.js';
import { eq, desc } from 'drizzle-orm';

export interface AuditLogEntry {
  actorWalletAddress: string;
  action: string;
  targetId: string;
  priorStatus?: string;
  newStatus?: string;
  metadata?: any;
}

/**
 * Returns all data from relational PostgreSQL tables in the legacy metadata_db shape
 * so existing GET routes can consume it without regressions.
 */
export async function getAllDbData() {
  const db = await getDb();
  const [allReports, allCampaigns, allProof] = await Promise.all([
    db.select().from(schema.reports),
    db.select().from(schema.campaigns),
    db.select().from(schema.reliefProof),
  ]);

  return {
    reports: allReports.map((r: any) => ({
      ...r,
      desc: r.desc,
      timestamp: Number(r.timestamp || Date.now()),
      approvedAt: r.approvedAt ? Number(r.approvedAt) : undefined,
      rejectedAt: r.rejectedAt ? Number(r.rejectedAt) : undefined,
    })),
    campaigns: allCampaigns.map((c: any) => ({
      ...c,
      raised: Number(c.raised || 0),
      goal: Number(c.goal || 0),
      status: Number(c.status || 0),
      isDemo: Boolean(c.isDemo),
    })),
    reliefProof: allProof.map((p: any) => ({
      ...p,
      campaignId: p.campaignId,
      timestamp: Number(p.timestamp || Date.now()),
    })),
  };
}

/**
 * Inserts a disaster report into PostgreSQL.
 */
export async function insertReport(reportData: any) {
  const db = await getDb();
  await db.insert(schema.reports).values({
    id: reportData.id,
    title: reportData.title,
    location: reportData.location,
    severity: reportData.severity,
    desc: reportData.desc,
    evidenceBlobId: reportData.evidenceBlobId || null,
    evidenceUrl: reportData.evidenceUrl || null,
    mimeType: reportData.mimeType || null,
    walletAddress: reportData.walletAddress || null,
    timestamp: reportData.timestamp || Date.now(),
    status: reportData.status || 'submitted',
    aiAnalysis: reportData.aiAnalysis || null,
    evidences: reportData.evidences || null,
  });
  return reportData;
}

/**
 * Atomically approves a report, creates/updates the campaign read-through cache,
 * and writes to audit_logs within a single database transaction.
 */
export async function approveReportTransaction(
  reportId: string,
  actorAddress: string,
  onChainObjectId: string,
  onChainStatus: number
) {
  const db = await getDb();

  return await db.transaction(async (tx: any) => {
    // 1. Fetch current report
    const [report] = await tx
      .select()
      .from(schema.reports)
      .where(eq(schema.reports.id, reportId));

    if (!report) {
      throw new Error(`Report "${reportId}" not found.`);
    }

    const priorStatus = report.status;
    const now = Date.now();

    // 2. Update report status
    await tx
      .update(schema.reports)
      .set({
        status: 'approved',
        approvedAt: now,
      })
      .where(eq(schema.reports.id, reportId));

    // 3. Upsert campaign read-through cache
    const existingCampaigns = await tx
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, reportId));

    const campaignData = {
      id: reportId,
      title: report.title,
      tag: report.severity === 'critical' ? 'Rescue Mission' : report.severity === 'medium' ? 'Flood Relief' : 'Aid Drive',
      desc: report.desc.substring(0, 120) + '...',
      raised: '0',
      goal: String(report.severity === 'critical' ? 25000 : 10000),
      walletAddress: report.walletAddress,
      onChainObjectId,
      status: onChainStatus,
      budgetBlobId: `walrus_budget_${reportId}`,
      budgetUrl: `https://aggregator.walrus.site/v1/blobs/walrus_budget_${reportId}`,
      ngoCredentialsBlobId: `walrus_ngo_${reportId}`,
      ngoCredentialsUrl: `https://aggregator.walrus.site/v1/blobs/walrus_ngo_${reportId}`,
      isDemo: false,
      syncedAt: new Date(),
    };

    if (existingCampaigns.length === 0) {
      await tx.insert(schema.campaigns).values(campaignData);
    } else {
      await tx
        .update(schema.campaigns)
        .set({
          onChainObjectId,
          status: onChainStatus,
          syncedAt: new Date(),
        })
        .where(eq(schema.campaigns.id, reportId));
    }

    // 4. Record audit log entry
    await tx.insert(schema.auditLogs).values({
      actorWalletAddress: actorAddress,
      action: 'APPROVE_REPORT',
      targetId: reportId,
      priorStatus,
      newStatus: 'approved',
      timestamp: new Date(),
      metadata: {
        campaignObjectId: onChainObjectId,
        onChainStatus,
        approvedAt: now,
      },
    });

    return {
      report: { ...report, status: 'approved', approvedAt: now },
      campaign: campaignData,
    };
  });
}

/**
 * Atomically rejects a report and writes to audit_logs within a single database transaction.
 */
export async function rejectReportTransaction(
  reportId: string,
  actorAddress: string,
  rejectionReason: string
) {
  const db = await getDb();

  return await db.transaction(async (tx: any) => {
    const [report] = await tx
      .select()
      .from(schema.reports)
      .where(eq(schema.reports.id, reportId));

    if (!report) {
      throw new Error(`Report "${reportId}" not found.`);
    }

    const priorStatus = report.status;
    const now = Date.now();

    await tx
      .update(schema.reports)
      .set({
        status: 'rejected',
        rejectedAt: now,
        rejectionReason,
      })
      .where(eq(schema.reports.id, reportId));

    await tx.insert(schema.auditLogs).values({
      actorWalletAddress: actorAddress,
      action: 'REJECT_REPORT',
      targetId: reportId,
      priorStatus,
      newStatus: 'rejected',
      timestamp: new Date(),
      metadata: {
        reason: rejectionReason,
        rejectedAt: now,
      },
    });

    return {
      report: {
        ...report,
        status: 'rejected',
        rejectedAt: now,
        rejectionReason,
      },
    };
  });
}

/**
 * Inserts a relief proof record into PostgreSQL and logs the audit event.
 */
export async function insertReliefProof(proofData: any, actorAddress?: string) {
  const db = await getDb();

  return await db.transaction(async (tx: any) => {
    await tx.insert(schema.reliefProof).values({
      id: proofData.id,
      campaignId: proofData.campaignId,
      title: proofData.title,
      desc: proofData.desc,
      proofBlobId: proofData.proofBlobId,
      proofUrl: proofData.proofUrl || null,
      rawUrl: proofData.rawUrl || null,
      mimeType: proofData.mimeType || null,
      timestamp: proofData.timestamp || Date.now(),
      coordinates: proofData.coordinates || null,
    });

    if (actorAddress) {
      await tx.insert(schema.auditLogs).values({
        actorWalletAddress: actorAddress,
        action: 'SUBMIT_RELIEF_PROOF',
        targetId: proofData.id,
        priorStatus: null,
        newStatus: 'created',
        timestamp: new Date(),
        metadata: {
          campaignId: proofData.campaignId,
          proofBlobId: proofData.proofBlobId,
        },
      });
    }

    return proofData;
  });
}

/**
 * Returns audit logs from PostgreSQL ordered by most recent.
 */
export async function getAuditLogs(limitCount = 50) {
  const db = await getDb();
  return await db
    .select()
    .from(schema.auditLogs)
    .orderBy(desc(schema.auditLogs.timestamp))
    .limit(limitCount);
}
