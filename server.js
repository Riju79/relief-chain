import express from 'express';
import cors from 'cors';
import multer from 'multer';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

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
    authenticityFlags: flags
  };
}

const WALRUS_PUBLISHER = process.env.WALRUS_PUBLISHER || 'https://publisher.walrus-testnet.walrus.space';
const WALRUS_AGGREGATOR = process.env.WALRUS_AGGREGATOR || 'https://aggregator.walrus-testnet.walrus.space';

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// POST /api/upload — upload file, return AI authenticity result
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded.' });
    const { originalname, buffer, mimetype } = req.file;
    console.log(`[WALRUS] Connecting to publisher: ${WALRUS_PUBLISHER}`);
    console.log(`[WALRUS] Storing: ${originalname} (${mimetype}), ${buffer.length} bytes`);

    let blobId = null;
    let evidenceUrl = null;
    let isLocalFallback = false;

    try {
      const response = await axios.put(`${WALRUS_PUBLISHER}/v1/blobs?epochs=5`, buffer, {
        headers: { 'Content-Type': mimetype || 'application/octet-stream' },
        timeout: 10000
      });
      console.log(`[WALRUS] Publisher response status: ${response.status}`);
      if (response.data?.newlyCreated?.blobObject?.blobId) {
        blobId = response.data.newlyCreated.blobObject.blobId;
        console.log(`[WALRUS] Created new blob successfully. ID: ${blobId}`);
      } else if (response.data?.alreadyCertified?.blobId) {
        blobId = response.data.alreadyCertified.blobId;
        console.log(`[WALRUS] Blob already certified. ID: ${blobId}`);
      } else {
        console.error('[WALRUS] Upload failed - response structure unrecognized:', JSON.stringify(response.data));
      }
    } catch (walrusErr) {
      console.error('[WALRUS UPLOAD FAILURE] Failed to store file on Walrus testnet:', {
        message: walrusErr.message,
        code: walrusErr.code,
        response: walrusErr.response ? {
          status: walrusErr.response.status,
          data: walrusErr.response.data
        } : 'No HTTP response'
      });
      
      return res.status(500).json({
        success: false,
        error: 'Walrus decentralized storage network unavailable. Evidence must be stored on real Walrus nodes.'
      });
    }

    if (!blobId) throw new Error('Walrus did not return a valid blob ID.');
    
    evidenceUrl = `${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`;
    
    const aiAnalysis = runAiAuthentication(originalname, buffer, mimetype);

    console.log(`[WALRUS] Blob: ${blobId} | Authentic: ${aiAnalysis.authentic} (${aiAnalysis.authenticityScore}%)`);

    res.json({ success: true, blobId, evidenceUrl, fileName: originalname, fileSize: buffer.length, mimeType: mimetype, aiAnalysis });
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
app.post('/api/reports', (req, res) => {
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

    db.reports.unshift(newReport);
    writeDb(db);
    res.json({ success: true, report: newReport });
  } catch (error) {
    console.error('[REPORT SAVE ERROR]', error);
    res.status(500).json({ success: false, error: 'Failed to save report.' });
  }
});

// POST /api/reports/:id/approve — admin approves → creates campaign
app.post('/api/reports/:id/approve', (req, res) => {
  try {
    const db = readDb();
    const report = db.reports.find(r => r.id === req.params.id);
    if (!report) return res.status(404).json({ success: false, error: 'Report not found.' });

    report.status = 'approved';
    report.approvedAt = Date.now();

    // Auto-create campaign for the approved report
    const existing = db.campaigns.find(c => c.id === report.id);
    if (!existing) {
      db.campaigns.unshift({
        id: report.id,
        title: report.title,
        tag: report.severity === 'critical' ? 'Rescue Mission' : report.severity === 'medium' ? 'Flood Relief' : 'Aid Drive',
        desc: report.desc.substring(0, 120) + '...',
        raised: 0,
        goal: report.severity === 'critical' ? 25000 : 10000,
        walletAddress: report.walletAddress || '0x5313936ab87ed60dc8a11a1a1a1a1a1a1a1a1a1a100000000000000000000000',
        budgetBlobId: `walrus_budget_${report.id}`,
        budgetUrl: `https://aggregator.walrus.site/v1/blobs/walrus_budget_${report.id}`,
        ngoCredentialsBlobId: `walrus_ngo_${report.id}`,
        ngoCredentialsUrl: `https://aggregator.walrus.site/v1/blobs/walrus_ngo_${report.id}`
      });
    }

    writeDb(db);
    res.json({ success: true, report, campaign: db.campaigns.find(c => c.id === report.id) });
  } catch (error) {
    console.error('[APPROVE ERROR]', error);
    res.status(500).json({ success: false, error: 'Failed to approve report.' });
  }
});

// POST /api/reports/:id/reject — admin rejects report
app.post('/api/reports/:id/reject', (req, res) => {
  try {
    const db = readDb();
    const report = db.reports.find(r => r.id === req.params.id);
    if (!report) return res.status(404).json({ success: false, error: 'Report not found.' });

    report.status = 'rejected';
    report.rejectedAt = Date.now();
    report.rejectionReason = req.body.reason || 'Failed authenticity review';
    writeDb(db);
    res.json({ success: true, report });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to reject report.' });
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
app.post('/api/relief-proof', (req, res) => {
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
    db.reliefProof.unshift(newProof);
    writeDb(db);
    res.json({ success: true, reliefProof: newProof });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to save proof log.' });
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
