import axios from 'axios';
import FormData from 'form-data';

const BASE_URL = 'http://localhost:3000';

async function testEvidenceIntegrity() {
  console.log('====================================================');
  console.log('🧪 TESTING SHA-256 EVIDENCE INTEGRITY & TAMPER DETECTION');
  console.log('====================================================\n');

  // 1. Upload genuine evidence file
  console.log('--- Step 1: Uploading Evidence File ---');
  const form = new FormData();
  const fileContent = 'OFFICIAL DISASTER ASSESSMENT REPORT: Flood levels breached 4.2m in Assam District 3.';
  form.append('file', Buffer.from(fileContent), {
    filename: 'Assam_Assessment_2026.txt',
    contentType: 'text/plain'
  });

  const uploadRes = await axios.post(`${BASE_URL}/api/upload`, form, {
    headers: form.getHeaders()
  });

  console.log('Upload response status:', uploadRes.status);
  const { blobId, contentHash, evidenceUrl, aiAnalysis } = uploadRes.data;
  console.log('Uploaded Blob ID:', blobId);
  console.log('SHA-256 Digest:', contentHash);
  console.log('Triage Description:', aiAnalysis.triageDescription);
  console.log('Triage Score:', aiAnalysis.triageScore);

  if (!contentHash || contentHash.length !== 64) {
    throw new Error('Invalid SHA-256 content hash returned!');
  }

  // 2. Test Backend Integrity Check: GENUINE FILE MATCH
  console.log('\n--- Step 2: Double-Check Genuine File Hash ---');
  const genuineCheck = await axios.post(`${BASE_URL}/api/evidence/verify-integrity`, {
    blobId,
    expectedHash: contentHash
  });

  console.log('Genuine file check response:', genuineCheck.data);
  if (!genuineCheck.data.verified || !genuineCheck.data.match || genuineCheck.data.status !== 'VERIFIED_MATCH') {
    throw new Error('Genuine integrity check failed unexpectedly!');
  }
  console.log('✔ Genuine file passed SHA-256 integrity verification!');

  // 3. Test Backend Integrity Check: TAMPERED HASH / MODIFIED PAYLOAD
  console.log('\n--- Step 3: Double-Check Tampered Hash / Altered File ---');
  const tamperedHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'; // Diff hash
  const tamperedCheck = await axios.post(`${BASE_URL}/api/evidence/verify-integrity`, {
    blobId,
    expectedHash: tamperedHash
  });

  console.log('Tampered file check response:', tamperedCheck.data);
  if (tamperedCheck.data.verified || tamperedCheck.data.match || tamperedCheck.data.status !== 'CRYPTOGRAPHIC_INTEGRITY_VIOLATION') {
    throw new Error('Tampered integrity check did not flag violation!');
  }
  console.log('✔ Tampered payload correctly detected with CRYPTOGRAPHIC_INTEGRITY_VIOLATION!');

  console.log('\n====================================================');
  console.log('🎉 EVIDENCE INTEGRITY API TESTS COMPLETED SUCCESSFULLY!');
  console.log('====================================================\n');

  return { blobId, contentHash, tamperedHash };
}

testEvidenceIntegrity().catch(err => {
  console.error('❌ Test failed:', err.response?.data || err.message);
  process.exit(1);
});
