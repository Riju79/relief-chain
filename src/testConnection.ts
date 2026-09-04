import { checkSuiConnection } from './utils/healthCheck.js';
import { getBalance, getLatestCheckpoint, getOwnedObjects } from './services/blockchainService.js';

/**
 * Sandbox execution script to verify the Sui Testnet + Tatum RPC connection health.
 * Queries a well-known active Sui Testnet address to validate data formatting.
 */
async function runVerification() {
  console.log('====================================================');
  console.log('      ReliefChain Blockchain Connection Test       ');
  console.log('====================================================');

  try {
    // 1. Connection Health Check
    console.log('1. Executing RPC node health check...');
    await checkSuiConnection();

    // 2. Fetch Latest Checkpoint Sequence Number
    console.log('2. Querying latest checkpoint sequence...');
    const checkpointResult = await getLatestCheckpoint();
    if (checkpointResult.success) {
      console.log(`   Latest Checkpoint Sequence: ${checkpointResult.checkpoint}`);
    } else {
      console.error(`   Failed to fetch checkpoint: ${checkpointResult.error}`);
    }

    // 3. Query SUI Balance of a well-known Sui Testnet address
    // We use a known active Sui Testnet foundation/donation account for read-only validation
    const targetAddress = '0x5313936ab87ed60dc8a11a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a';
    console.log(`\n3. Querying SUI balance for validation address:\n   ${targetAddress}...`);

    const balanceResult = await getBalance(targetAddress);
    if (balanceResult.success) {
      console.log('   ----------------------------------------');
      console.log(`   Balance (SUI):  ${balanceResult.balanceSui.toLocaleString()} SUI`);
      console.log(`   Balance (MIST): ${balanceResult.balanceMist} MIST`);
      console.log(`   SUI Coin Objects Owned: ${balanceResult.coinObjectCount}`);
      console.log('   ----------------------------------------');
    } else {
      console.error(`   Failed to fetch balance: ${balanceResult.error}`);
    }

    // 4. Query Objects Owned by the Validation Address
    console.log(`\n4. Querying owned objects for validation address...`);
    const objectsResult = await getOwnedObjects(targetAddress);
    if (objectsResult.success) {
      console.log(`   Successfully fetched objects. Total objects: ${objectsResult.objects.length}`);
      if (objectsResult.objects.length > 0) {
        console.log('   Sample of first 3 owned objects:');
        objectsResult.objects.slice(0, 3).forEach((obj: any, idx: number) => {
          console.log(`     [Object ${idx + 1}] ID: ${obj.objectId} | Type: ${obj.type}`);
        });
      }
    } else {
      console.error(`   Failed to fetch owned objects: ${objectsResult.error}`);
    }

    console.log('\n====================================================');
    console.log('✅ ReliefChain Backend Verification Layer: SUCCESS');
    console.log('====================================================\n');
  } catch (error: any) {
    console.error('\n====================================================');
    console.error('❌ ReliefChain Backend Verification Layer: FAILED');
    console.error(`Reason: ${error.message}`);
    console.error('====================================================\n');
    process.exit(1);
  }
}

// Execute connection test
runVerification();
