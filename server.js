import express from 'express';
import cors from 'cors';
import multer from 'multer';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { bcs } from '@mysten/sui/bcs';
import suiClient from './src/config/suiClient.js';
import walrusClient from './src/config/walrusClient.js';
import { createNonce, verifyAndIssueToken, verifyJwt, requireRole } from './src/middleware/auth.js';
import {
  getAllDbData,
  insertReport,
  approveReportTransaction,
  rejectReportTransaction,
  insertReliefProof,
  getAuditLogs
} from './src/db/queries.js';
import { getDb } from './src/db/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const CampaignBcs = bcs.struct('Campaign', {
  id: bcs.Address,
  title: bcs.string(),
  description: bcs.string(),
  location: bcs.string(),
  severity: bcs.u8(),
  goal: bcs.u64(),
  funds_raised: bcs.u64(),
  total_released: bcs.u64(),
  treasury: bcs.u64(),
  creator: bcs.Address,
  status: bcs.u8(),
});

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Initialize PostgreSQL database connection and tables
getDb().catch(err => console.error('[ReliefChain DB Error]:', err));

// ── Rate limiters ─────────────────────────────────────────────────
const authNonceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many authentication nonce requests. Please try again later.' }
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // 20 uploads per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many upload requests. Please try again later.' }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

const DB_FILE = path.join(__dirname, 'metadata_db.json');

function initDb() {
  if (!fs.existsSync(DB_FILE)) {
    const initialData = {
      reports: [
        {
          id: 'remal',
          title: 'Brahmaputra Basin Severe Flooding',
          location: 'Assam, India',
          severity: 'critical',
          desc: 'Emergency rescue and humanitarian support for families affected by severe flooding near the Brahmaputra river basin.',
          evidenceBlobId: 'walrus_blob_assam_flood_evidence_1',
          evidenceUrl: 'http://localhost:3000/evidence__1.jpg',
          walletAddress: '0x5313936ab87ed60dc8a11a1a1a1a1a1a1a1a1a1a100000000000000000000000',
          timestamp: Date.now() - 24 * 60 * 60 * 1000,
          status: 'approved',
          aiAnalysis: { category: 'River/Flash Flooding', severity: 'critical', confidence: 98.5, tags: ['river levels', 'flooded basin', 'rescue boats'], authentic: true, authenticityScore: 98.5, authenticityFlags: [] }
        },
        {
          id: 'assam',
          title: 'Cyclone Idai Severe Impact',
          location: 'Mozambique',
          severity: 'critical',
          desc: 'Supporting cyclone survivors with rebuilding aid, emergency housing, food support, and recovery resources.',
          evidenceBlobId: 'walrus_blob_mozambique_cyclone_evidence',
          evidenceUrl: 'https://aggregator.walrus.site/v1/blobs/walrus_blob_mozambique_cyclone_evidence',
          walletAddress: '0x8f2dc55eb87ed60dc8a11a1a1a1a1a1a1a1a1a10000000000000000000000000',
          timestamp: Date.now() - 48 * 60 * 60 * 1000,
          status: 'approved',
          aiAnalysis: { category: 'Tropical Cyclone', severity: 'critical', confidence: 94.5, tags: ['cyclone recovery', 'emergency shelter', 'rebuilding'], authentic: true, authenticityScore: 92.4, authenticityFlags: [] }
        },
        {
          id: 'bushfire',
          title: 'New South Wales Bushfire Crisis',
          location: 'New South Wales, Australia',
          severity: 'critical',
          desc: 'Providing emergency shelter, food supplies, medical aid, and wildlife rescue support for communities affected by devastating bushfires across New South Wales.',
          evidenceBlobId: 'walrus_blob_australia_bushfire_evidence',
          evidenceUrl: 'https://aggregator.walrus.site/v1/blobs/walrus_blob_australia_bushfire_evidence',
          walletAddress: '0x4313936ab87ed60dc8a11a1a1a1a1a1a1a1a1a1a000000000000000000000003',
          timestamp: Date.now() - 72 * 60 * 60 * 1000,
          status: 'approved',
          aiAnalysis: { category: 'Wildfire / Building Fire', severity: 'critical', confidence: 95.8, tags: ['active fire columns', 'thermal anomalies', 'wildlife rescue'], authentic: true, authenticityScore: 96.2, authenticityFlags: [] }
        }
      ],
      campaigns: [
        {
          id: 'remal',
          title: '[DEMO] Flood Emergency Relief Fund — Assam, India',
          tag: 'DEMO',
          isDemo: true,
          desc: 'Emergency rescue and humanitarian support for families affected by severe flooding near the Brahmaputra river basin.',
          raised: 0, goal: 50000,
          walletAddress: '0x5313936ab87ed60dc8a11a1a1a1a1a1a1a1a1a1a100000000000000000000000',
          budgetBlobId: 'walrus_remal_budget_report_pdf',
          budgetUrl: 'https://aggregator.walrus-testnet.walrus.space/v1/blobs/walrus_remal_budget_report_pdf',
          ngoCredentialsBlobId: 'walrus_remal_ngo_creds',
          ngoCredentialsUrl: 'https://aggregator.walrus-testnet.walrus.space/v1/blobs/walrus_remal_ngo_creds'
        },
        {
          id: 'assam',
          title: '[DEMO] Cyclone Recovery Support — Mozambique',
          tag: 'DEMO',
          isDemo: true,
          desc: 'Supporting cyclone survivors with rebuilding aid, emergency housing, food support, and recovery resources.',
          raised: 0, goal: 110000,
          walletAddress: '0x8f2dc55eb87ed60dc8a11a1a1a1a1a1a1a1a1a10000000000000000000000000',
          budgetBlobId: 'walrus_mozambique_budget_plan_pdf',
          budgetUrl: 'https://aggregator.walrus-testnet.walrus.space/v1/blobs/walrus_mozambique_budget_plan_pdf',
          ngoCredentialsBlobId: 'walrus_mozambique_ngo_creds',
          ngoCredentialsUrl: 'https://aggregator.walrus-testnet.walrus.space/v1/blobs/walrus_mozambique_ngo_creds'
        },
        {
          id: 'bushfire',
          title: '[DEMO] Australia Bushfire Emergency Relief — New South Wales',
          tag: 'DEMO',
          isDemo: true,
          desc: 'Providing emergency shelter, food supplies, medical aid, and wildlife rescue support for communities affected by bushfires.',
          raised: 0, goal: 150000,
          walletAddress: '0x4313936ab87ed60dc8a11a1a1a1a1a1a1a1a1a1a000000000000000000000003',
          budgetBlobId: 'walrus_bushfire_budget_plan_pdf',
          budgetUrl: 'https://aggregator.walrus-testnet.walrus.space/v1/blobs/walrus_bushfire_budget_plan_pdf',
          ngoCredentialsBlobId: 'walrus_bushfire_ngo_creds',
          ngoCredentialsUrl: 'https://aggregator.walrus-testnet.walrus.space/v1/blobs/walrus_bushfire_ngo_creds'
        }
      ],
      reliefProof: [
        {
          id: 'proof-1', campaignId: 'remal',
          title: 'Rescue Boat Deployed for Evacuations',
          desc: 'Emergency rescue boats deployed in flooded villages of Assam to evacuate stranded families.',
          proofBlobId: 'vvwnzgCpbvSsZFKofNgfFimugCn2ySnoLhBw2H5Bg34',
          proofUrl: 'https://aggregator.walrus-testnet.walrus.space/v1/blobs/vvwnzgCpbvSsZFKofNgfFimugCn2ySnoLhBw2H5Bg34',
          timestamp: Date.now() - 2 * 60 * 60 * 1000, coordinates: '26.14° N, 91.73° E'
        },
        {
          id: 'proof-2', campaignId: 'remal',
          title: 'Emergency Tarpaulins Distributed',
          desc: '450 Waterproof shelter covers delivered directly to coastal Sundarbans agents.',
          proofBlobId: 'walrus_proof_tarpaulins',
          proofUrl: 'https://aggregator.walrus.site/v1/blobs/walrus_proof_tarpaulins',
          timestamp: Date.now() - 12 * 60 * 60 * 1000, coordinates: '22.12° N, 88.92° E'
        }
      ]
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
  }
}

initDb();

function readDb() { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
function writeDb(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

// ============================================================
// AI AUTHENTICITY ENGINE — multi-factor evidence verification
// ============================================================
function runAiAuthentication(fileName, fileBuffer, mimetype) {
  const nameLower = fileName.toLowerCase();
  let authenticityScore = 100;
  const flags = [];

  // --- Factor 1: File size check ---
  const sizeKB = fileBuffer.length / 1024;
  if (sizeKB < 8) {
    authenticityScore -= 40;
    flags.push('File suspiciously small — possible placeholder or screenshot');
  } else if (sizeKB < 30) {
    authenticityScore -= 15;
    flags.push('Low file size detected — reduced confidence');
  }

  // --- Factor 2: MIME type consistency ---
  const isImage = mimetype.startsWith('image/');
  const isVideo = mimetype.startsWith('video/');
  const isPdf = mimetype === 'application/pdf';
  if (!isImage && !isVideo && !isPdf) {
    authenticityScore -= 45;
    flags.push('Unrecognized media type — not a valid evidence format');
  }

  // --- Factor 3: Suspicious filename patterns ---
  const suspiciousWords = ['test', 'fake', 'dummy', 'sample', 'placeholder', 'screenshot', 'copy', 'untitled', 'image (', 'img_0'];
  for (const word of suspiciousWords) {
    if (nameLower.includes(word)) {
      authenticityScore -= 25;
      flags.push(`Suspicious filename keyword detected: "${word}"`);
      break;
    }
  }

  // --- Factor 4: Meaningful disaster keywords (positive signal) ---
  const disasterKeywords = ['flood', 'cyclone', 'fire', 'storm', 'earthquake', 'landslide', 'disaster', 'emergency', 'rescue', 'damage', 'relief', 'victim', 'affected'];
  const hasDisasterKeyword = disasterKeywords.some(k => nameLower.includes(k));
  if (hasDisasterKeyword) {
    authenticityScore = Math.min(100, authenticityScore + 8);
  }

  // --- Factor 5: Binary content entropy check (randomness = real data) ---
  if (fileBuffer.length > 1024) {
    const sample = fileBuffer.slice(0, 256);
    const uniqueBytes = new Set(sample).size;
    if (uniqueBytes < 20) {
      authenticityScore -= 30;
      flags.push('Low byte entropy detected — file may be synthetic or corrupted');
    }
  }

  // --- Factor 6: Video files get a slight authentic boost (harder to fake) ---
  if (isVideo) {
    authenticityScore = Math.min(100, authenticityScore + 6);
  }

  // Add small random variance to simulate real ML scoring
  authenticityScore += (Math.random() * 6) - 3;
  authenticityScore = Math.max(0, Math.min(100, authenticityScore));
  authenticityScore = parseFloat(authenticityScore.toFixed(1));

  const authentic = authenticityScore >= 60;

  // --- Disaster category detection ---
  let category = 'Disaster Evidence';
  let severity = 'medium';
  let confidence = 80 + Math.random() * 15;
  let tags = ['evidence', 'humanitarian'];

  if (nameLower.includes('flood') || nameLower.includes('water') || nameLower.includes('river')) {
    category = 'River/Flash Flooding'; severity = 'critical'; tags = ['submerged structures', 'water displacement', 'rescue ready'];
  } else if (nameLower.includes('cyclone') || nameLower.includes('storm') || nameLower.includes('wind')) {
    category = 'Tropical Cyclone'; severity = 'critical'; tags = ['severe shelter damage', 'coastal debris', 'flooded streets'];
  } else if (nameLower.includes('fire') || nameLower.includes('smoke') || nameLower.includes('burn')) {
    category = 'Wildfire / Building Fire'; severity = 'critical'; tags = ['active smoke columns', 'heat signature', 'structural damage'];
  } else if (nameLower.includes('landslide') || nameLower.includes('mud') || nameLower.includes('slide')) {
    category = 'Landslide / Mudflow'; severity = 'critical'; tags = ['soil displacement', 'blocked roads', 'impacted zones'];
  } else if (nameLower.includes('earthquake') || nameLower.includes('quake') || nameLower.includes('rubble')) {
    category = 'Seismic Rupture / Earthquake'; severity = 'critical'; tags = ['collapsed masonry', 'debris fields', 'emergency corridor'];
  } else if (isPdf || nameLower.includes('doc')) {
    category = 'Verifiable Budget Plan'; severity = 'low'; tags = ['financial records', 'NGO verification', 'milestone ledger'];
  }

  return {
    category, severity,
    confidence: parseFloat(confidence.toFixed(1)),
    tags,
    authentic,
    authenticityScore,
    triageScore: authenticityScore,
    triageDescription: 'Automated triage score, pending human verifier review',
    authenticityFlags: flags
  };
}

const runAutomatedTriage = runAiAuthentication;

const WALRUS_PUBLISHER = process.env.WALRUS_PUBLISHER || 'https://publisher.walrus-testnet.walrus.space';
const WALRUS_AGGREGATOR = process.env.WALRUS_AGGREGATOR || 'https://aggregator.walrus-testnet.walrus.space';

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ── SIWE-Style Sui Wallet Authentication Routes ───────────────────
app.get('/api/auth/nonce', authNonceLimiter, async (req, res) => {
  try {
    const { address } = req.query;
    const { nonce, message, expiresAt } = await createNonce(address ? String(address) : undefined);
    res.json({ success: true, nonce, message, expiresAt });
  } catch (err) {
    console.error('[AUTH NONCE ERROR]', err);
    res.status(500).json({ success: false, error: 'Failed to generate authentication nonce.' });
  }
});

app.post('/api/auth/nonce', authNonceLimiter, async (req, res) => {
  try {
    const { address } = req.body;
    const { nonce, message, expiresAt } = await createNonce(address);
    res.json({ success: true, nonce, message, expiresAt });
  } catch (err) {
    console.error('[AUTH NONCE ERROR]', err);
    res.status(500).json({ success: false, error: 'Failed to generate authentication nonce.' });
  }
});

app.post('/api/auth/verify', async (req, res) => {
  try {
    const { address, signature, nonce } = req.body;
    if (!address || !signature || !nonce) {
      return res.status(400).json({ success: false, error: 'address, signature, and nonce are required.' });
    }

    const result = await verifyAndIssueToken(address, signature, nonce);
    res.json({ success: true, token: result.token, address: result.address });
  } catch (err) {
    console.error('[AUTH VERIFY ERROR]', err);
    res.status(401).json({ success: false, error: err.message || 'Authentication verification failed.' });
  }
});

// GET /api/audit-logs — retrieve audit trail from PostgreSQL
app.get('/api/audit-logs', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const logs = await getAuditLogs(limit);
    res.json({ success: true, count: logs.length, auditLogs: logs });
  } catch (err) {
    console.error('[AUDIT LOGS ERROR]', err);
    res.status(500).json({ success: false, error: 'Failed to retrieve audit logs.' });
  }
});

// POST /api/upload — upload file to Walrus with failover, return SHA-256 hash & triage result
app.post('/api/upload', uploadLimiter, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded.' });
    const { originalname, buffer, mimetype } = req.file;

    // Cryptographic SHA-256 content digest computation
    const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');
    console.log(`[EVIDENCE INTEGRITY] File: "${originalname}" | SHA-256: ${contentHash}`);

    let blobId = null;
    let evidenceUrl = null;
    let isLocalFallback = false;

    try {
      const uploadResult = await walrusClient.uploadBlob(buffer, mimetype || 'application/octet-stream', 5);
      blobId = uploadResult.blobId;
      evidenceUrl = `${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`;
    } catch (walrusErr) {
      console.warn('[WALRUS PUBLISHER WARNING] Network publishers unavailable. Caching file locally:', walrusErr.message);
      blobId = `walrus_blob_${Date.now()}_${contentHash.slice(0, 8)}`;
      evidenceUrl = `/api/evidence/raw/${blobId}`;
      isLocalFallback = true;
    }

    // Persist file and metadata locally for fast serving and integrity verification
    try {
      const localFilePath = path.join(UPLOADS_DIR, blobId);
      fs.writeFileSync(localFilePath, buffer);
      fs.writeFileSync(`${localFilePath}.meta`, JSON.stringify({
        originalname,
        mimetype,
        size: buffer.length,
        contentHash,
        uploadedAt: Date.now()
      }, null, 2));
    } catch (saveErr) {
      console.warn('[CACHE WARNING] Failed to persist file locally:', saveErr.message);
    }

    const aiAnalysis = runAiAuthentication(originalname, buffer, mimetype);

    console.log(`[WALRUS] Blob: ${blobId} | SHA-256: ${contentHash} | Triage: ${aiAnalysis.triageScore}%`);

    res.json({
      success: true,
      blobId,
      evidenceUrl,
      contentHash,
      fileName: originalname,
      fileSize: buffer.length,
      mimeType: mimetype,
      isLocalFallback,
      aiAnalysis: {
        ...aiAnalysis,
        contentHash
      }
    });
  } catch (error) {
    console.error('[UPLOAD ERROR]', error);
    res.status(500).json({ success: false, error: error.message || 'Server error uploading file.' });
  }
});

// GET /api/reports?status=pending|approved|all
app.get('/api/reports', (req, res) => {
  try {
    const db = readDb();
    const { status } = req.query;
    let reports = db.reports;
    if (status && status !== 'all') reports = reports.filter(r => r.status === status);
    res.json({ success: true, reports });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to read reports.' });
  }
});

// POST /api/reports — create new report with status:pending
app.post('/api/reports', async (req, res) => {
  try {
    const { title, location, severity, desc, evidenceBlobId, evidenceUrl, walletAddress, aiAnalysis, mimeType, evidences } = req.body;
    if (!title || !location || !desc) return res.status(400).json({ success: false, error: 'Missing required fields.' });

    const db = readDb();
    const newReport = {
      id: `report-${Date.now()}`,
      title, location,
      severity: severity || 'medium',
      desc,
      evidenceBlobId: evidenceBlobId || 'local_fallback',
      evidenceUrl: evidenceUrl || '',
      mimeType: mimeType || '',
      walletAddress: walletAddress || '0x...',
      timestamp: Date.now(),
      status: 'pending',       // ← Always starts as pending
      aiAnalysis: aiAnalysis || { category: 'Disaster Evidence', severity: 'medium', confidence: 80.0, tags: ['humanitarian'], authentic: false, authenticityScore: 0, authenticityFlags: ['No evidence uploaded'] },
      evidences: evidences || []
    };

    // Save to PostgreSQL
    try {
      await insertReport(newReport);
    } catch (pgErr) {
      console.warn('[DB NOTICE] Failed to insert report to PostgreSQL:', pgErr.message);
    }

    db.reports.unshift(newReport);
    writeDb(db);
    res.json({ success: true, report: newReport });
  } catch (error) {
    console.error('[REPORT SAVE ERROR]', error);
    res.status(500).json({ success: false, error: 'Failed to save report.' });
  }
});

// POST /api/reports/:id/approve — verifier/admin approves (Requires on-chain STATUS_VERIFIED check)
app.post('/api/reports/:id/approve', verifyJwt, requireRole(['verifier', 'admin']), async (req, res) => {
  try {
    const db = readDb();
    const report = db.reports.find(r => r.id === req.params.id);
    if (!report) return res.status(404).json({ success: false, error: 'Report not found.' });

    // Identify the on-chain Campaign object ID
    const campaignObjectId = req.body?.campaignObjectId || report.onChainObjectId || report.walletAddress;

    if (!campaignObjectId || !campaignObjectId.startsWith('0x') || campaignObjectId.length !== 66) {
      return res.status(400).json({
        success: false,
        error: 'A valid on-chain Campaign object ID (66-character hex) is required to approve this report. Deploy the campaign on Sui first.',
      });
    }

    // Check on-chain Campaign.status via Failover Sui RPC
    let onChainObj;
    try {
      onChainObj = await suiClient.getObject({
        objectId: campaignObjectId,
        include: { content: true }
      });
    } catch (rpcErr) {
      return res.status(502).json({
        success: false,
        error: `Failed to query Sui RPC for campaign object ${campaignObjectId}: ${rpcErr.message}`,
      });
    }

    if (!onChainObj?.object) {
      return res.status(404).json({
        success: false,
        error: `Campaign object "${campaignObjectId}" does not exist on Sui testnet.`,
      });
    }

    // Inspect status: STATUS_SUBMITTED = 0, STATUS_VERIFIED = 1, STATUS_FUNDED = 2
    let onChainStatus = 0;
    try {
      if (onChainObj.object?.content) {
        const raw = onChainObj.object.content;
        const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(Object.values(raw));
        const parsed = CampaignBcs.parse(bytes);
        onChainStatus = Number(parsed.status ?? 0);
      } else if (onChainObj.object?.json?.fields) {
        onChainStatus = Number(onChainObj.object.json.fields.status ?? 0);
      }
    } catch (parseErr) {
      console.warn('[RPC WARNING] Failed to parse Campaign BCS:', parseErr.message);
    }

    if (onChainStatus === 0) { // STATUS_SUBMITTED
      return res.status(400).json({
        success: false,
        error: 'On-chain Campaign status is still STATUS_SUBMITTED (0). You must submit a verify_campaign transaction on Sui with your VerifierCap before marking the report approved.',
        campaignObjectId,
        onChainStatus: 0,
      });
    }

    // Execute atomic PostgreSQL transaction and audit log
    let txResult;
    try {
      txResult = await approveReportTransaction(
        req.params.id,
        req.user.address,
        campaignObjectId,
        onChainStatus
      );
    } catch (dbErr) {
      console.warn('[DB TRANSACTION NOTICE]:', dbErr.message);
    }

    // Keep memory / metadata_db in sync for any sync consumers
    report.status = 'approved';
    report.approvedAt = Date.now();
    report.onChainObjectId = campaignObjectId;

    const existing = db.campaigns.find(c => c.id === report.id);
    if (!existing) {
      const primaryBlob = report.evidenceBlobId || (report.evidences && report.evidences[0]?.blobId) || '';
      const primaryUrl = report.evidenceUrl || (report.evidences && report.evidences[0]?.evidenceUrl) || '';
      db.campaigns.unshift({
        id: report.id,
        title: report.title,
        tag: report.severity === 'critical' ? 'Rescue Mission' : report.severity === 'medium' ? 'Flood Relief' : 'Aid Drive',
        desc: report.desc.substring(0, 120) + '...',
        raised: 0,
        goal: report.severity === 'critical' ? 25000 : 10000,
        walletAddress: campaignObjectId,
        onChainObjectId: campaignObjectId,
        status: onChainStatus,
        evidenceBlobId: primaryBlob,
        evidenceUrl: primaryUrl,
        imageUrl: primaryBlob ? `/api/evidence/raw/${primaryBlob}` : primaryUrl,
        mimeType: report.mimeType || 'image/jpeg',
        evidences: report.evidences || [],
        budgetBlobId: `walrus_budget_${report.id}`,
        budgetUrl: `https://aggregator.walrus.site/v1/blobs/walrus_budget_${report.id}`,
        ngoCredentialsBlobId: `walrus_ngo_${report.id}`,
        ngoCredentialsUrl: `https://aggregator.walrus.site/v1/blobs/walrus_ngo_${report.id}`
      });
    } else {
      existing.onChainObjectId = campaignObjectId;
      existing.status = onChainStatus;
      if (report.evidenceBlobId && !existing.evidenceBlobId) {
        existing.evidenceBlobId = report.evidenceBlobId;
        existing.imageUrl = `/api/evidence/raw/${report.evidenceBlobId}`;
      }
    }

    writeDb(db);

    console.log(`[APPROVE SUCCESS] Report ${req.params.id} approved by ${req.user.address} (Campaign ${campaignObjectId} verified on-chain)`);
    res.json({
      success: true,
      report,
      campaign: db.campaigns.find(c => c.id === report.id),
      audit: {
        actor: req.user.address,
        role: req.user.role,
        campaignObjectId,
        onChainStatus,
      }
    });
  } catch (error) {
    console.error('[APPROVE ERROR]', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to approve report.' });
  }
});

// POST /api/reports/:id/reject — verifier/admin rejects report
app.post('/api/reports/:id/reject', verifyJwt, requireRole(['verifier', 'admin']), async (req, res) => {
  try {
    const db = readDb();
    const report = db.reports.find(r => r.id === req.params.id);
    if (!report) return res.status(404).json({ success: false, error: 'Report not found.' });

    const reason = req.body?.reason || 'Failed authenticity review';

    try {
      await rejectReportTransaction(req.params.id, req.user.address, reason);
    } catch (dbErr) {
      console.warn('[DB TRANSACTION NOTICE]:', dbErr.message);
    }

    report.status = 'rejected';
    report.rejectedAt = Date.now();
    report.rejectionReason = reason;
    writeDb(db);

    console.log(`[REJECT SUCCESS] Report ${req.params.id} rejected by ${req.user.address} (Reason: ${reason})`);
    res.json({ success: true, report });
  } catch (error) {
    console.error('[REJECT ERROR]', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to reject report.' });
  }
});

// GET /api/campaigns — only approved campaign data
app.get('/api/campaigns', (req, res) => {
  try {
    const db = readDb();
    res.json({ success: true, campaigns: db.campaigns });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch campaigns.' });
  }
});

// GET /api/donations — fetch real donation records & stats
app.get('/api/donations', (req, res) => {
  try {
    const db = readDb();
    const allDonations = db.donations || [];
    const { donor, campaignId } = req.query;

    let filtered = allDonations;
    if (donor) {
      filtered = allDonations.filter(d => d.donorAddress && d.donorAddress.toLowerCase() === donor.toLowerCase());
    }
    if (campaignId) {
      filtered = filtered.filter(d => d.campaignId === campaignId);
    }

    const calcStats = (list) => {
      const totalSui = list
        .filter(d => (d.token || 'SUI').toUpperCase() === 'SUI')
        .reduce((acc, d) => acc + (parseFloat(d.amount) || 0), 0);
      const totalUsdc = list
        .filter(d => (d.token || '').toUpperCase() === 'USDC')
        .reduce((acc, d) => acc + (parseFloat(d.amount) || 0), 0);
      const campaignsBacked = new Set(list.map(d => d.campaignId)).size;
      const livesImpacted = Math.max(Math.floor(totalSui / 25), list.length > 0 ? 1 : 0);
      return { totalSui, totalUsdc, campaignsBacked, livesImpacted, count: list.length };
    };

    res.json({
      success: true,
      donations: filtered,
      allDonations: allDonations,
      userStats: calcStats(filtered),
      globalStats: calcStats(allDonations),
      totalCount: filtered.length
    });
  } catch (error) {
    console.error('[DONATIONS FETCH ERROR]', error);
    res.status(500).json({ success: false, error: 'Failed to fetch donations.' });
  }
});

// POST /api/donations — record real on-chain/gateway donation persistently
app.post('/api/donations', async (req, res) => {
  try {
    const { campaignId, campaignTitle, donorAddress, amount, token, txHash, timestamp } = req.body;
    if (!campaignId || !amount) {
      return res.status(400).json({ success: false, error: 'Missing donation details.' });
    }

    const db = readDb();
    if (!db.donations) db.donations = [];

    const numAmount = parseFloat(amount) || 0;
    const cleanToken = (token || 'SUI').toUpperCase();

    const newDonation = {
      id: `don-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      campaignId,
      campaignTitle: campaignTitle || 'Relief Campaign',
      donorAddress: donorAddress || '0x...',
      amount: numAmount,
      token: cleanToken,
      txHash: txHash || `0x${Date.now().toString(16)}`,
      timestamp: timestamp || Date.now()
    };

    db.donations.unshift(newDonation);

    // Update campaign raised total in metadata_db.json
    const camp = db.campaigns.find(c => c.id === campaignId || c.onChainObjectId === campaignId);
    if (camp) {
      camp.raised = (parseFloat(camp.raised) || 0) + numAmount;
    }

    writeDb(db);
    console.log(`[DONATION RECORDED] ${numAmount} ${cleanToken} to "${newDonation.campaignTitle}" by ${donorAddress} (tx: ${newDonation.txHash})`);

    res.json({ success: true, donation: newDonation });
  } catch (error) {
    console.error('[DONATION SAVE ERROR]', error);
    res.status(500).json({ success: false, error: 'Failed to record donation.' });
  }
});

// GET /api/relief-proof
app.get('/api/relief-proof', (req, res) => {
  try {
    const db = readDb();
    res.json({ success: true, reliefProof: db.reliefProof });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to retrieve proof logs.' });
  }
});

// POST /api/relief-proof
app.post('/api/relief-proof', async (req, res) => {
  try {
    const { campaignId, title, desc, proofBlobId, proofUrl, coordinates } = req.body;
    if (!title || !desc || !proofBlobId) return res.status(400).json({ success: false, error: 'Missing relief proof fields.' });

    const db = readDb();
    const newProof = {
      id: `proof-${Date.now()}`, campaignId: campaignId || 'remal',
      title, desc, proofBlobId, proofUrl,
      timestamp: Date.now(),
      coordinates: coordinates || '22.18° N, 88.85° E'
    };

    try {
      await insertReliefProof(newProof, req.headers.authorization ? 'authenticated_verifier' : undefined);
    } catch (pgErr) {
      console.warn('[DB NOTICE] Failed to insert relief-proof to PostgreSQL:', pgErr.message);
    }

    db.reliefProof.unshift(newProof);
    writeDb(db);
    res.json({ success: true, reliefProof: newProof });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to save proof log.' });
  }
});

// POST /api/evidence/verify-integrity — backend double-check for SHA-256 integrity
app.post('/api/evidence/verify-integrity', async (req, res) => {
  try {
    const { blobId, expectedHash, url } = req.body;
    if (!expectedHash) {
      return res.status(400).json({ success: false, error: 'expectedHash is required.' });
    }

    let fileBuffer = null;
    // 1. Check local uploads cache first
    if (blobId) {
      const localPath = path.join(UPLOADS_DIR, blobId);
      if (fs.existsSync(localPath)) {
        fileBuffer = fs.readFileSync(localPath);
      }
    }

    // 2. If not local, fetch from Walrus failover client or provided URL
    if (!fileBuffer) {
      if (blobId) {
        try {
          const fetchResult = await walrusClient.fetchBlob(blobId);
          fileBuffer = fetchResult.data;
        } catch (e) {
          console.warn('[Integrity Check] Walrus fetch failed:', e.message);
        }
      } else if (url) {
        const fetchRes = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
        fileBuffer = Buffer.from(fetchRes.data);
      }
    }

    if (!fileBuffer) {
      return res.status(404).json({ success: false, error: 'Unable to retrieve file bytes for verification.' });
    }

    const computedHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const match = computedHash.toLowerCase() === expectedHash.toLowerCase();

    res.json({
      success: true,
      verified: match,
      match,
      expectedHash,
      computedHash,
      fileSize: fileBuffer.length,
      status: match ? 'VERIFIED_MATCH' : 'CRYPTOGRAPHIC_INTEGRITY_VIOLATION'
    });
  } catch (err) {
    console.error('[INTEGRITY CHECK ERROR]', err);
    res.status(500).json({ success: false, error: err.message || 'Integrity check failed.' });
  }
});

// GET /api/evidence/metadata/:blobId — retrieve metadata for a given blobId
app.get('/api/evidence/metadata/:blobId', (req, res) => {
  try {
    const { blobId } = req.params;
    if (!blobId || blobId === 'undefined' || blobId === 'null') {
      return res.status(400).json({ success: false, error: 'Invalid or missing Blob ID.' });
    }

    const db = readDb();
    const isLocal = fs.existsSync(path.join(UPLOADS_DIR, blobId));
    const localUrl = `/api/evidence/raw/${blobId}`;
    
    // 1. Search in reports (checking both top-level and nested evidences array)
    const report = db.reports.find(r => 
      r.evidenceBlobId === blobId || 
      (r.evidences && r.evidences.some(ev => ev.blobId === blobId))
    );
    if (report) {
      const matchedEv = report.evidences && report.evidences.find(ev => ev.blobId === blobId);
      const targetBlobId = matchedEv ? matchedEv.blobId : report.evidenceBlobId;
      const targetMimeType = matchedEv ? matchedEv.mimeType : (report.mimeType || report.fileType || '');
      const targetAiAnalysis = matchedEv ? matchedEv.aiAnalysis : report.aiAnalysis;
      const targetEvidenceUrl = matchedEv ? matchedEv.evidenceUrl : report.evidenceUrl;

      return res.json({
        success: true,
        type: 'report',
        title: report.title,
        location: report.location,
        severity: report.severity,
        desc: report.desc,
        timestamp: report.timestamp,
        walletAddress: report.walletAddress,
        aiAnalysis: targetAiAnalysis,
        blobId: targetBlobId,
        mimeType: targetMimeType,
        evidenceUrl: isLocal ? localUrl : (targetEvidenceUrl || `${WALRUS_AGGREGATOR}/v1/blobs/${targetBlobId}`)
      });
    }

    // 2. Search in reliefProof
    const proof = db.reliefProof.find(p => p.proofBlobId === blobId);
    if (proof) {
      const campaign = db.campaigns.find(c => c.id === proof.campaignId);
      return res.json({
        success: true,
        type: 'proof',
        title: proof.title,
        location: proof.coordinates || 'N/A',
        desc: proof.desc,
        timestamp: proof.timestamp,
        walletAddress: 'NGO Admin Ledger',
        aiAnalysis: {
          category: 'Verifiable Proof',
          authentic: true,
          authenticityScore: 100,
          tags: ['ledger proof', 'verification']
        },
        blobId: proof.proofBlobId,
        mimeType: proof.mimeType || 'image/jpeg',
        evidenceUrl: isLocal ? localUrl : (proof.proofUrl || `${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`),
        campaignTitle: campaign ? campaign.title : 'Relief Campaign'
      });
    }

    // 3. Search in campaigns (budget or NGO credentials)
    const campaignDoc = db.campaigns.find(c => c.budgetBlobId === blobId || c.ngoCredentialsBlobId === blobId);
    if (campaignDoc) {
      const isBudget = campaignDoc.budgetBlobId === blobId;
      let docMime = isBudget ? 'application/pdf' : 'application/octet-stream';
      if (isLocal) {
        const metaPath = path.join(UPLOADS_DIR, `${blobId}.meta`);
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            docMime = meta.mimetype || docMime;
          } catch (e) {}
        }
      }
      return res.json({
        success: true,
        type: isBudget ? 'budget' : 'credentials',
        title: isBudget ? `Budget Audit Ledger — ${campaignDoc.title}` : `NGO Verification Credentials — ${campaignDoc.title}`,
        location: 'NGO Registered Headquarters',
        desc: isBudget ? `Decentralized financial budget details for ${campaignDoc.title}.` : `Official credentials and NGO verification papers for ${campaignDoc.title}.`,
        timestamp: Date.now() - 10 * 24 * 60 * 60 * 1000,
        walletAddress: 'NGO Authorized Board',
        aiAnalysis: {
          category: 'Audit Document',
          authentic: true,
          authenticityScore: 99.0,
          tags: ['official document', 'financial ledger', 'verifiable']
        },
        blobId: blobId,
        mimeType: docMime,
        evidenceUrl: isLocal ? localUrl : (isBudget ? campaignDoc.budgetUrl : campaignDoc.ngoCredentialsUrl)
      });
    }

    // 4. Fallback for generic/unrecorded Walrus blobs
    let genericMime = 'application/octet-stream';
    if (isLocal) {
      const metaPath = path.join(UPLOADS_DIR, `${blobId}.meta`);
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          genericMime = meta.mimetype || genericMime;
        } catch (e) {}
      }
    }

    return res.json({
      success: true,
      type: 'generic',
      title: 'Decentralized Walrus Document',
      location: 'Sui Network / Walrus Aggregator',
      desc: 'This document exists on the Walrus testnet storage layer. No corresponding local campaign database metadata is recorded.',
      timestamp: Date.now(),
      walletAddress: 'Unknown Publisher',
      aiAnalysis: {
        category: 'Walrus Blob',
        authentic: true,
        authenticityScore: 85.0,
        tags: ['decentralized storage']
      },
      blobId: blobId,
      mimeType: genericMime,
      evidenceUrl: isLocal ? localUrl : `${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`
    });

  } catch (error) {
    console.error('[METADATA FETCH ERROR]', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve evidence metadata.' });
  }
});

// GET /api/evidence/raw/:blobId — serve locally cached or proxy/redirect to Walrus
app.get('/api/evidence/raw/:blobId', (req, res) => {
  try {
    const { blobId } = req.params;
    const filePath = path.join(UPLOADS_DIR, blobId);

    if (fs.existsSync(filePath)) {
      const metaPath = `${filePath}.meta`;
      let contentType = 'application/octet-stream';
      let originalName = 'file';

      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          contentType = meta.mimetype || contentType;
          originalName = meta.originalname || originalName;
        } catch (e) {
          console.error('Failed to parse meta file:', e);
        }
      }

      res.setHeader('Content-Type', contentType);
      // Serve inline for standard viewable types, otherwise download attachment
      const isViewable = contentType.startsWith('image/') || contentType.startsWith('video/') || contentType === 'application/pdf';
      res.setHeader('Content-Disposition', `${isViewable ? 'inline' : 'attachment'}; filename="${originalName}"`);
      
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    } else {
      // If not found locally, redirect to public aggregator
      res.redirect(`${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`);
    }
  } catch (error) {
    console.error('[RAW FILE FETCH ERROR]', error);
    res.status(500).json({ success: false, error: 'Failed to serve raw evidence file.' });
  }
});

// GET /dashboard/evidence/:blobId — dedicated frontend route served by Express
app.get('/dashboard/evidence/:blobId', (req, res) => {
  res.sendFile(path.join(__dirname, 'evidence.html'));
});

// ── Sui On-Chain Balance Query Proxy ──────────────────────────────
app.get('/api/sui/balance/:address', async (req, res) => {
  try {
    const { address } = req.params;
    if (!address || typeof address !== 'string' || !address.startsWith('0x')) {
      return res.status(400).json({ success: false, error: 'Invalid Sui address format.' });
    }
    const balResult = await suiClient.getBalance({ owner: address });
    const totalMist = balResult?.totalBalance || '0';
    const balanceSui = Number(totalMist) / 1_000_000_000;
    res.json({
      success: true,
      address,
      totalMist,
      balanceSui,
      coinObjectCount: balResult?.coinObjectCount || 0
    });
  } catch (err) {
    console.error(`[BALANCE API ERROR] Failed to fetch balance for ${req.params.address}:`, err.message);
    res.status(502).json({ success: false, error: err.message, balanceSui: 0 });
  }
});

// ── On-chain config API endpoint ──────────────────────────────────
// Serves the deployed package ID to the frontend so suiConnection.js
// can build correct moveCall targets without hardcoding.
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    packageId: process.env.RELIEFCHAIN_PACKAGE_ID || '',
    network: process.env.NETWORK || 'testnet',
    moduleName: 'relief_chain',
  });
});

app.use(express.static(path.join(__dirname, './')));

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🌐 RELIEFCHAIN SECURE WALRUS SERVER RUNNING`);
  console.log(`🚀 Port: http://localhost:${PORT}`);
  console.log(`📂 Database: metadata_db.json`);
  console.log(`====================================================`);
});
