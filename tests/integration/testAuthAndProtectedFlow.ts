import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const BASE_URL = 'http://localhost:3000';

async function runAuthFlowTest() {
  console.log('====================================================');
  console.log('🧪 RUNNING RELIEFCHAIN PHASE 2 AUTH & PROTECTED FLOW TEST');
  console.log('====================================================\n');

  // Load deployer keypair from keystore
  const keystorePath = path.join(process.env.HOME || '', '.sui', 'sui_config', 'sui.keystore');
  if (!fs.existsSync(keystorePath)) {
    throw new Error(`Sui keystore not found at ${keystorePath}`);
  }
  const keystoreRaw = JSON.parse(fs.readFileSync(keystorePath, 'utf8'));
  const deployerBase64 = keystoreRaw[0];
  const deployerBuf = Buffer.from(deployerBase64, 'base64');
  const deployerKeypair = Ed25519Keypair.fromSecretKey(deployerBuf.subarray(1));
  const deployerAddress = deployerKeypair.toSuiAddress();
  console.log(`🔑 Deployer/Verifier Address: ${deployerAddress}`);

  // Generate an unprivileged keypair (holds no caps on Sui)
  const unprivilegedKeypair = new Ed25519Keypair();
  const unprivilegedAddress = unprivilegedKeypair.toSuiAddress();
  console.log(`👤 Unprivileged User Address: ${unprivilegedAddress}\n`);

  // ---------------------------------------------------------------
  // Step 1: Request Nonce for unprivileged wallet
  // ---------------------------------------------------------------
  console.log('--- Step 1: Request Nonce for Unprivileged Wallet ---');
  const nonceRes = await axios.get(`${BASE_URL}/api/auth/nonce`, {
    params: { address: unprivilegedAddress }
  });
  console.log('Response status:', nonceRes.status);
  console.log('Nonce payload:', nonceRes.data);
  if (!nonceRes.data.success || !nonceRes.data.nonce) {
    throw new Error('Failed to get valid nonce from server');
  }
  const { nonce: userNonce, message: userMessage } = nonceRes.data;

  // ---------------------------------------------------------------
  // Step 2: Sign message and verify to obtain JWT
  // ---------------------------------------------------------------
  console.log('\n--- Step 2: Sign Nonce with Ed25519 & Verify ---');
  const userMsgBytes = new TextEncoder().encode(userMessage);
  const { signature: userSig } = await unprivilegedKeypair.signPersonalMessage(userMsgBytes);
  console.log('Signature created:', userSig.slice(0, 30) + '...');

  const verifyRes = await axios.post(`${BASE_URL}/api/auth/verify`, {
    address: unprivilegedAddress,
    signature: userSig,
    nonce: userNonce
  });
  console.log('Verify response status:', verifyRes.status);
  console.log('Verify payload:', verifyRes.data);
  if (!verifyRes.data.success || !verifyRes.data.token) {
    throw new Error('Failed to obtain JWT');
  }
  const unprivilegedToken = verifyRes.data.token;
  console.log('✔ Received short-lived JWT for unprivileged user');

  // ---------------------------------------------------------------
  // Step 3: Test protected endpoint without token (Expect 401)
  // ---------------------------------------------------------------
  console.log('\n--- Step 3: Protected Route Without Token (Expect 401) ---');
  try {
    await axios.post(`${BASE_URL}/api/reports/report-1780062753444/approve`, {});
    console.error('❌ Expected 401 Unauthorized, but request succeeded!');
    process.exit(1);
  } catch (err: any) {
    if (err.response && err.response.status === 401) {
      console.log(`✔ Correctly rejected with 401 Unauthorized: ${err.response.data.error}`);
    } else {
      throw err;
    }
  }

  // ---------------------------------------------------------------
  // Step 4: Test protected endpoint with unprivileged token (Expect 403)
  // ---------------------------------------------------------------
  console.log('\n--- Step 4: Protected Route With Unprivileged Token (Expect 403) ---');
  try {
    await axios.post(
      `${BASE_URL}/api/reports/report-1780062753444/approve`,
      {},
      { headers: { Authorization: `Bearer ${unprivilegedToken}` } }
    );
    console.error('❌ Expected 403 Forbidden, but request succeeded!');
    process.exit(1);
  } catch (err: any) {
    if (err.response && err.response.status === 403) {
      console.log(`✔ Correctly rejected with 403 Forbidden: ${err.response.data.error}`);
    } else {
      throw err;
    }
  }

  // ---------------------------------------------------------------
  // Step 5: Authenticate Deployer/Verifier Wallet
  // ---------------------------------------------------------------
  console.log('\n--- Step 5: Authenticate Deployer/Verifier Wallet ---');
  const deployerNonceRes = await axios.get(`${BASE_URL}/api/auth/nonce`, {
    params: { address: deployerAddress }
  });
  const { nonce: depNonce, message: depMessage } = deployerNonceRes.data;

  const depMsgBytes = new TextEncoder().encode(depMessage);
  const { signature: depSig } = await deployerKeypair.signPersonalMessage(depMsgBytes);

  const depVerifyRes = await axios.post(`${BASE_URL}/api/auth/verify`, {
    address: deployerAddress,
    signature: depSig,
    nonce: depNonce
  });
  const deployerToken = depVerifyRes.data.token;
  console.log('✔ Received short-lived JWT for deployer/verifier');

  // ---------------------------------------------------------------
  // Step 6: Test on-chain status check with invalid campaign object (Expect 404 or 400)
  // ---------------------------------------------------------------
  console.log('\n--- Step 6: Test On-Chain Check with Fake Campaign Object ---');
  try {
    await axios.post(
      `${BASE_URL}/api/reports/report-1780062753444/approve`,
      { campaignObjectId: '0x0000000000000000000000000000000000000000000000000000000000000001' },
      { headers: { Authorization: `Bearer ${deployerToken}` } }
    );
    console.error('❌ Expected 404 Not Found for non-existent campaign object');
    process.exit(1);
  } catch (err: any) {
    if (err.response && (err.response.status === 404 || err.response.status === 400)) {
      console.log(`✔ Correctly rejected: ${err.response.data.error}`);
    } else {
      throw err;
    }
  }

  // ---------------------------------------------------------------
  // Step 7: Create a fresh pending report and approve it using verified on-chain campaign
  // ---------------------------------------------------------------
  console.log('\n--- Step 7: Approve Report with Verified Campaign on Sui ---');
  const verifiedCampaignObjectId = '0xbc6d224b09671eb9806eacf818ea558e525443491b0729684d930ab595a78494';
  
  // Submit a new report first
  const newReportRes = await axios.post(`${BASE_URL}/api/reports`, {
    title: 'Automated Test Flood Verification',
    location: 'Assam, India',
    severity: 'critical',
    desc: 'Live verified report for end-to-end testing',
    evidenceBlobId: 'walrus_blob_test_123',
    evidenceUrl: '/api/evidence/raw/walrus_blob_test_123',
    mimeType: 'application/pdf',
    walletAddress: deployerAddress,
    onChainObjectId: verifiedCampaignObjectId
  });
  const testReportId = newReportRes.data.report.id;
  console.log(`Created test report: ${testReportId}`);

  // Now call approve with deployer token
  const approveRes = await axios.post(
    `${BASE_URL}/api/reports/${testReportId}/approve`,
    { campaignObjectId: verifiedCampaignObjectId },
    { headers: { Authorization: `Bearer ${deployerToken}` } }
  );
  console.log('Approve response status:', approveRes.status);
  console.log('Approve result:', approveRes.data.report?.status);
  if (approveRes.data.report?.status !== 'approved') {
    throw new Error(`Report was not marked approved: ${JSON.stringify(approveRes.data)}`);
  }
  console.log('✔ Report successfully approved via on-chain status verification and Postgres transaction!');

  // ---------------------------------------------------------------
  // Step 8: Check Audit Logs in PostgreSQL
  // ---------------------------------------------------------------
  console.log('\n--- Step 8: Verify Audit Logs in PostgreSQL ---');
  const auditRes = await axios.get(`${BASE_URL}/api/audit-logs`);
  console.log(`Total audit logs retrieved: ${auditRes.data.count}`);
  const latestLog = auditRes.data.auditLogs[0];
  console.log('Latest audit log record:', latestLog);

  if (!latestLog || latestLog.action.toUpperCase() !== 'APPROVE_REPORT' || latestLog.targetId !== testReportId) {
    throw new Error('Audit log verification failed!');
  }
  console.log(`✔ Verified audit log row recorded: actor=${latestLog.actorWallet}, action=${latestLog.action}, target=${latestLog.targetId}`);

  console.log('\n====================================================');
  console.log('🎉 ALL PHASE 2 TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================\n');
}

runAuthFlowTest().catch(err => {
  console.error('❌ Test failed with error:', err.response?.data || err.message);
  process.exit(1);
});
