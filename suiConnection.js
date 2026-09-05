/**
 * ReliefChain Browser Connection Layer
 * Communicates with Sui Move contract via Programmable Transaction Blocks
 * and standard Sui Wallets (wallet-standard) in the browser.
 *
 * ═══════════════════════════════════════════════════════════════════
 * ON-CHAIN WIRING
 * ═══════════════════════════════════════════════════════════════════
 *
 * Every "financial" action now goes through a real tx.moveCall to the
 * deployed relief_chain Move package:
 *
 *   donateSuiOnChain     → ::relief_chain::donate
 *   createCampaignOnChain → ::relief_chain::create_campaign
 *   verifyCampaignOnChain → ::relief_chain::verify_campaign
 *   addMilestoneOnChain   → ::relief_chain::add_milestone
 *   attachEvidenceOnChain → ::relief_chain::attach_evidence
 *   approveMilestoneOnChain → ::relief_chain::approve_milestone
 *   releaseFundsOnChain   → ::relief_chain::release_funds
 *   completeCampaignOnChain → ::relief_chain::complete_campaign
 *   cancelCampaignOnChain → ::relief_chain::cancel_campaign
 *
 * No raw splitCoins → transferObjects bypassing the contract.
 *
 * ═══════════════════════════════════════════════════════════════════
 * WALLET SIGNING PRIORITY
 * ═══════════════════════════════════════════════════════════════════
 *
 *   1. sui:signAndExecuteTransaction  (modern, avoids TRPC bug)
 *   2. sui:signAndExecuteTransactionBlock (deprecated exec fallback)
 *   3. sui:signTransaction            (sign-only + manual broadcast)
 *   4. sui:signTransactionBlock       (deprecated, last resort)
 *   5. Legacy injected provider       (window.suiWallet etc.)
 */

const SUI_RPC_ENDPOINTS = [
  'https://sui-testnet-endpoint.blockvision.org',
  'https://testnet.sui.rpcpool.com',
  'https://fullnode.testnet.sui.io:443'
];
let activeRpcIndex = 0;

import { getWallets } from 'https://esm.sh/@mysten/wallet-standard@0.20.3';
import { Transaction } from 'https://esm.sh/@mysten/sui@2.17.0/transactions';

// ── Package ID configuration ──────────────────────────────────────
// Read from window.RELIEFCHAIN_CONFIG (injected by server.js or index.html)
// or fall back to a hardcoded value set during deployment.
function getPackageId() {
  const id = window.RELIEFCHAIN_CONFIG?.packageId
    || document.querySelector('meta[name="reliefchain-package-id"]')?.content;
  if (!id || id === '0x0000000000000000000000000000000000000000000000000000000000000000') {
    throw new Error(
      '[ReliefChain] PACKAGE_ID is not configured. ' +
      'Set window.RELIEFCHAIN_CONFIG.packageId or add <meta name="reliefchain-package-id"> to the page.'
    );
  }
  return id;
}

// ── Wallet-standard registry ──────────────────────────────────────
if (!window.registeredSuiWallets) {
  window.registeredSuiWallets = [];
}

try {
  const walletsApi = getWallets();
  window.registeredSuiWallets = walletsApi.get() || [];

  walletsApi.on('register', (...newWallets) => {
    newWallets.forEach(w => {
      if (w && w.name && !window.registeredSuiWallets.find(r => r.name === w.name)) {
        window.registeredSuiWallets.push(w);
        window.dispatchEvent(new CustomEvent('reliefchain:wallet-registered', { detail: w }));
      }
    });
  });
} catch (e) {
  console.error('[ReliefChain] Wallet Standard init failed:', e);
}

// ── Resilient Failover JSON-RPC helper ──────────────────────────────
async function sendRpcRequest(method, params = []) {
  const headers = { 'Content-Type': 'application/json' };
  let lastErr = null;

  for (let i = 0; i < SUI_RPC_ENDPOINTS.length; i++) {
    const idx = (activeRpcIndex + i) % SUI_RPC_ENDPOINTS.length;
    const rpcUrl = SUI_RPC_ENDPOINTS[idx];

    try {
      const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params });
      const resp = await fetch(rpcUrl, { method: 'POST', headers, body });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

      const data = await resp.json();
      if (data.error) {
        throw new Error(data.error.message || JSON.stringify(data.error));
      }

      activeRpcIndex = idx; // Pin working endpoint
      return data.result;
    } catch (e) {
      lastErr = e;
      console.warn(`[ReliefChain RPC Failover] Endpoint ${rpcUrl} failed for ${method}: ${e.message}. Trying backup...`);
    }
  }

  throw lastErr || new Error('All Sui RPC endpoints failed.');
}

// ── Public RPC helpers ────────────────────────────────────────────
export async function getSuiBalance(address) {
  if (!address || typeof address !== 'string' || !address.startsWith('0x')) {
    return 0;
  }

  // 1. Direct browser query with RPC failover
  try {
    const r = await sendRpcRequest('suix_getBalance', [address, '0x2::sui::SUI']);
    if (r && r.totalBalance !== undefined) {
      const bal = Number(r.totalBalance) / 1_000_000_000;
      console.log(`[ReliefChain] Fetched SUI balance for ${address}: ${bal.toFixed(4)} SUI`);
      return bal;
    }
  } catch (e) {
    console.warn('[ReliefChain] Direct getSuiBalance RPC failed:', e.message);
  }

  // 2. High-reliability server proxy fallback
  try {
    const resp = await fetch(`/api/sui/balance/${address}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data.success && typeof data.balanceSui === 'number') {
        console.log(`[ReliefChain] Fetched SUI balance via backend proxy: ${data.balanceSui.toFixed(4)} SUI`);
        return data.balanceSui;
      }
    }
  } catch (proxyErr) {
    console.warn('[ReliefChain] Backend balance proxy fallback error:', proxyErr.message);
  }

  return 0;
}

export async function getLatestCheckpoint() {
  try {
    const r = await sendRpcRequest('sui_getLatestCheckpointSequenceNumber', []);
    return Number(r);
  } catch (e) {
    return Math.floor(Date.now() / 1000);
  }
}

// ── Fetch Campaign On-Chain State ────────────────────────────────
/**
 * Read a Campaign shared object directly from Sui RPC.
 * Returns { fundsRaised, treasury, status, goal, title, creator, ... } in SUI (not MIST).
 */
export async function fetchCampaignOnChain(campaignObjectId) {
  if (!campaignObjectId || !campaignObjectId.startsWith('0x')) {
    throw new Error(`Invalid campaign object ID: "${campaignObjectId}"`);
  }

  const obj = await sendRpcRequest('sui_getObject', [
    campaignObjectId,
    { showContent: true, showType: true }
  ]);

  if (!obj?.data?.content?.fields) {
    throw new Error(`Campaign object ${campaignObjectId} not found on chain or has no fields.`);
  }

  const fields = obj.data.content.fields;

  return {
    campaignId: campaignObjectId,
    title: fields.title || '',
    description: fields.description || '',
    location: fields.location || '',
    severity: Number(fields.severity || 0),
    goal: Number(fields.goal || 0) / 1_000_000_000,
    fundsRaised: Number(fields.funds_raised || 0) / 1_000_000_000,
    totalReleased: Number(fields.total_released || 0) / 1_000_000_000,
    treasury: Number(fields.treasury?.fields?.value ?? fields.treasury ?? 0) / 1_000_000_000,
    creator: fields.creator || '',
    status: Number(fields.status || 0),
    milestonesCount: Array.isArray(fields.milestones) ? fields.milestones.length : 0,
    evidenceCount: Array.isArray(fields.evidence_records) ? fields.evidence_records.length : 0,
    milestones: fields.milestones || [],
    evidenceRecords: fields.evidence_records || [],
    raw: fields,
  };
}

// ── Wallet discovery ──────────────────────────────────────────────
export function getWalletsList() {
  const wallets = [];

  if (window.registeredSuiWallets?.length > 0) {
    window.registeredSuiWallets.forEach(w => {
      wallets.push({
        id: 'standard-' + w.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        name: w.name,
        icon: w.icon || null,
        isStandard: true,
        suiWalletObject: w,
      });
    });
  }

  const legacy = [
    { key: 'suiWallet',   name: 'Sui Wallet',   icon: null },
    { key: 'slush',       name: 'Slush Wallet',  icon: null },
    { key: 'slushWallet', name: 'Slush Wallet',  icon: null },
  ];

  legacy.forEach(p => {
    if (window[p.key] && !wallets.find(w => w.name.toLowerCase() === p.name.toLowerCase())) {
      wallets.push({ id: 'legacy-' + p.key, name: p.name, icon: p.icon,
                     isStandard: false, suiWalletObject: window[p.key] });
    }
  });

  ['okxwallet', 'phantom', 'subwallet'].forEach(p => {
    if (window[p]?.sui) {
      const name = p.charAt(0).toUpperCase() + p.slice(1) + ' Wallet';
      if (!wallets.find(w => w.name.toLowerCase().includes(p.toLowerCase()))) {
        wallets.push({ id: 'legacy-' + p, name, icon: null,
                       isStandard: false, suiWalletObject: window[p].sui });
      }
    }
  });

  return wallets;
}

// ── Wallet connection ─────────────────────────────────────────────
export async function connectWallet(wallet) {
  if (!wallet?.suiWalletObject) {
    throw new Error('Wallet object is missing browser provider reference.');
  }

  let address = '';
  const walletObj = wallet.suiWalletObject;
  const isStdCapable = !!(walletObj.features?.['standard:connect']);

  if (isStdCapable) {
    const connectFeat = walletObj.features['standard:connect'];
    let out;
    try {
      out = await connectFeat.connect();
    } catch (e) {
      console.warn('[ReliefChain] connect() silent failed, retrying:', e.message);
      out = await connectFeat.connect({ silent: false });
    }

    const account = out?.accounts?.[0] ?? walletObj.accounts?.[0];
    if (!account) {
      throw new Error('No active Sui account. Open wallet → ensure an account exists on Testnet.');
    }

    address = account.address;
    wallet.isStandard = true;
  } else {
    const p = walletObj;
    if (typeof p.requestPermissions === 'function') await p.requestPermissions();
    else if (typeof p.requestAccount === 'function') {
      const r = await p.requestAccount();
      if (r?.address) address = r.address;
    } else if (typeof p.connect === 'function') await p.connect();

    if (!address) {
      if (typeof p.getAccounts === 'function') {
        const accs = await p.getAccounts();
        address = accs?.[0] || '';
      } else {
        address = p.account?.address || p.selectedAddress || '';
      }
    }
    wallet.isStandard = false;
  }

  if (!address) {
    throw new Error('Could not retrieve address. Create/select a Sui account in the wallet extension.');
  }

  return { wallet, account: { address } };
}

// Helper to check if a string is a standard 32-byte Sui address (0x + 64 hex characters)
export function isValidSuiAddress(address) {
  if (typeof address !== 'string') return false;
  if (!address.startsWith('0x')) return false;
  if (address.length !== 66) return false;
  const hexPart = address.slice(2);
  return /^[0-9a-fA-F]{64}$/.test(hexPart);
}

// ── Wallet Personal Message Signing (SIWE-Style) ──────────────────
/**
 * Signs an arbitrary message using the connected wallet adapter.
 * Supports standard 'sui:signPersonalMessage' and 'sui:signMessage'.
 *
 * @param {object} wallet - Connected wallet object
 * @param {string} senderAddress - Signer's Sui address
 * @param {string} messageText - Challenge message to sign
 * @returns {Promise<string>} Base64 signature
 */
export async function signPersonalMessage(wallet, senderAddress, messageText) {
  if (!wallet?.suiWalletObject) {
    throw new Error('Wallet is not connected. Please reconnect your wallet.');
  }

  const walletObj = wallet.suiWalletObject;
  const features = walletObj.features || {};
  const activeAccount =
    walletObj.accounts?.find(a => a.address === senderAddress) ??
    walletObj.accounts?.[0] ?? null;

  const msgBytes = new TextEncoder().encode(messageText);

  // 1. Standard wallet feature 'sui:signPersonalMessage'
  if (features['sui:signPersonalMessage']) {
    console.log('[ReliefChain Auth] Signing challenge via sui:signPersonalMessage...');
    const res = await features['sui:signPersonalMessage'].signPersonalMessage({
      account: activeAccount,
      message: msgBytes
    });
    return res.signature;
  }

  // 2. Standard wallet feature 'sui:signMessage'
  if (features['sui:signMessage']) {
    console.log('[ReliefChain Auth] Signing challenge via sui:signMessage...');
    const res = await features['sui:signMessage'].signMessage({
      account: activeAccount,
      message: msgBytes
    });
    return res.signature;
  }

  // 3. Legacy provider fallback
  if (typeof walletObj.signPersonalMessage === 'function') {
    console.log('[ReliefChain Auth] Signing challenge via legacy signPersonalMessage...');
    const res = await walletObj.signPersonalMessage({ message: msgBytes });
    return res.signature || res;
  }

  if (typeof walletObj.signMessage === 'function') {
    console.log('[ReliefChain Auth] Signing challenge via legacy signMessage...');
    const res = await walletObj.signMessage({ message: msgBytes });
    return res.signature || res;
  }

  throw new Error(`Connected wallet (${wallet.name}) does not support cryptographic message signing.`);
}

// ── On-Chain Capabilities Checker ─────────────────────────────────
/**
 * Queries Sui RPC for owned objects of type AdminCap or VerifierCap.
 * Returns { hasAdminCap, hasVerifierCap, role, verifierCapId, adminCapId }
 */
export async function checkUserCapabilities(address) {
  if (!address || !isValidSuiAddress(address)) {
    return { hasAdminCap: false, hasVerifierCap: false, role: 'none', verifierCapId: null, adminCapId: null };
  }

  const pkgId = getPackageId();
  const verifierCapType = `${pkgId}::relief_chain::VerifierCap`;
  const adminCapType = `${pkgId}::relief_chain::AdminCap`;

  try {
    const res = await sendRpcRequest('suix_getOwnedObjects', [
      address,
      { filter: { MatchAny: [{ StructType: verifierCapType }, { StructType: adminCapType }] }, options: { showType: true } }
    ]);

    const objects = res?.data || [];
    let verifierCapId = null;
    let adminCapId = null;

    for (const item of objects) {
      const type = item?.data?.type || '';
      if (type.includes(adminCapType) && !adminCapId) {
        adminCapId = item.data.objectId;
      }
      if (type.includes(verifierCapType) && !verifierCapId) {
        verifierCapId = item.data.objectId;
      }
    }

    const hasAdminCap = !!adminCapId;
    const hasVerifierCap = !!verifierCapId;
    const role = hasAdminCap ? 'admin' : (hasVerifierCap ? 'verifier' : 'none');

    return { hasAdminCap, hasVerifierCap, role, verifierCapId, adminCapId };
  } catch (err) {
    console.warn('[ReliefChain] Failed to query on-chain capabilities directly:', err.message);
    return { hasAdminCap: false, hasVerifierCap: false, role: 'none', verifierCapId: null, adminCapId: null };
  }
}

// ════════════════════════════════════════════════════════════════════
// UNIFIED SIGNING + EXECUTION ENGINE
// ════════════════════════════════════════════════════════════════════
/**
 * Signs and executes a pre-built Transaction using the connected wallet.
 * Tries signing paths in priority order: A → A2 → B → C → D
 *
 * @param {object} wallet - The connected wallet object
 * @param {string} senderAddress - The sender's Sui address
 * @param {Transaction} tx - A fully-built Transaction (with moveCall/etc already set)
 * @param {string} actionLabel - Human-readable label for logging
 * @returns {{ digest: string, rawResult: any }}
 */
async function signAndExecuteTx(wallet, senderAddress, tx, actionLabel = 'transaction') {
  if (!wallet?.suiWalletObject) {
    throw new Error('Wallet is not connected. Please reconnect your wallet.');
  }
  if (!isValidSuiAddress(senderAddress)) {
    throw new Error(`Invalid sender address: "${senderAddress}".`);
  }

  // Set sender & gas budget
  tx.setSender(senderAddress);
  tx.setGasBudget(50_000_000); // 0.05 SUI — ample for moveCall operations

  const walletObj = wallet.suiWalletObject;
  const features  = walletObj.features || {};
  const featKeys  = Object.keys(features);

  const activeAccount =
    walletObj.accounts?.find(a => a.address === senderAddress) ??
    walletObj.accounts?.[0] ?? null;

  // Pre-sign serialization for logging
  let txJSON = '(unavailable)';
  try { txJSON = JSON.parse(tx.serialize()); } catch (_) {}

  console.group(`[ReliefChain] ══ PRE-SIGN AUDIT: ${actionLabel} ══`);
  console.log('WALLET          :', wallet.name ?? '(unknown)');
  console.log('SENDER          :', senderAddress);
  console.log('ACCOUNT MATCH   :', activeAccount?.address === senderAddress);
  console.log('FEATURES        :', featKeys.join(', '));
  console.log('TX JSON         :', txJSON);
  console.groupEnd();

  if (!activeAccount) {
    throw new Error(`No wallet account found for ${senderAddress}.`);
  }
  if (activeAccount.address !== senderAddress) {
    throw new Error(`Account mismatch: wallet is "${activeAccount.address}" but expected "${senderAddress}".`);
  }

  let executeResult;

  // ── PATH A: sui:signAndExecuteTransaction ──
  if (features['sui:signAndExecuteTransaction']) {
    console.log(`[ReliefChain] ▶ PATH A: sui:signAndExecuteTransaction (${actionLabel})`);
    let rawResult;
    try {
      rawResult = await features['sui:signAndExecuteTransaction'].signAndExecuteTransaction({
        transaction: tx,
        account: activeAccount,
        chain: 'sui:testnet',
      });
    } catch (sigErr) {
      console.error(`[ReliefChain] signAndExecuteTransaction error (${actionLabel}):`, sigErr);
      throw sigErr;
    }
    const digest = rawResult?.digest ?? rawResult?.effects?.transactionEffects?.transactionDigest ?? '';
    console.log(`[ReliefChain] ✅ ${actionLabel} digest:`, digest);
    return { digest, rawResult };
  }

  // ── PATH A2: sui:signAndExecuteTransactionBlock ──
  else if (features['sui:signAndExecuteTransactionBlock']) {
    console.log(`[ReliefChain] ▶ PATH A2: sui:signAndExecuteTransactionBlock (${actionLabel})`);
    let rawResult;
    try {
      rawResult = await features['sui:signAndExecuteTransactionBlock'].signAndExecuteTransactionBlock({
        transactionBlock: tx,
        account: activeAccount,
        chain: 'sui:testnet',
      });
    } catch (sigErr) {
      console.error(`[ReliefChain] signAndExecuteTransactionBlock error (${actionLabel}):`, sigErr);
      throw sigErr;
    }
    const digest = rawResult?.digest ?? rawResult?.effects?.transactionEffects?.transactionDigest ?? '';
    console.log(`[ReliefChain] ✅ ${actionLabel} digest:`, digest);
    return { digest, rawResult };
  }

  // ── PATH B: sui:signTransaction + manual broadcast ──
  else if (features['sui:signTransaction']) {
    console.log(`[ReliefChain] ▶ PATH B: sui:signTransaction + broadcast (${actionLabel})`);
    let signedResult;
    try {
      signedResult = await features['sui:signTransaction'].signTransaction({
        transaction: tx,
        account: activeAccount,
        chain: 'sui:testnet',
      });
    } catch (sigErr) {
      console.error(`[ReliefChain] signTransaction error (${actionLabel}):`, sigErr);
      throw sigErr;
    }
    const txBytes  = signedResult?.bytes ?? signedResult?.transactionBytes ?? signedResult?.transactionBlockBytes;
    const signature = signedResult?.signature;
    if (!txBytes)   throw new Error('Signing response missing txBytes.');
    if (!signature) throw new Error('Signing response missing signature.');
    executeResult = await _broadcast(txBytes, signature);
  }

  // ── PATH C: sui:signTransactionBlock (DEPRECATED) ──
  else if (features['sui:signTransactionBlock']) {
    console.warn(`[ReliefChain] ⚠ PATH C: DEPRECATED signTransactionBlock (${actionLabel})`);
    let signedResult;
    try {
      signedResult = await features['sui:signTransactionBlock'].signTransactionBlock({
        transactionBlock: tx,
        account: activeAccount,
        chain: 'sui:testnet',
      });
    } catch (sigErr) {
      const msg = sigErr?.message ?? String(sigErr);
      if (msg.toLowerCase().includes('incorrect password')) {
        throw new Error(
          'Wallet rejected with "Incorrect password" via deprecated signTransactionBlock. ' +
          'Lock → unlock the wallet, or update to the latest version.'
        );
      }
      throw sigErr;
    }
    const txBytes   = signedResult?.bytes ?? signedResult?.transactionBytes ?? signedResult?.transactionBlockBytes;
    const signature = signedResult?.signature;
    if (!txBytes || !signature) throw new Error('Signing response missing bytes or signature.');
    executeResult = await _broadcast(txBytes, signature);
  }

  // ── PATH D: Legacy injected provider ──
  else if (!walletObj.features) {
    console.warn(`[ReliefChain] ▶ PATH D: Legacy provider (${actionLabel})`);
    if (typeof walletObj.signTransaction !== 'function' &&
        typeof walletObj.signTransactionBlock !== 'function') {
      throw new Error('Legacy wallet missing signing methods.');
    }
    let signedResult;
    if (typeof walletObj.signTransaction === 'function') {
      signedResult = await walletObj.signTransaction({ transaction: tx, chain: 'sui:testnet' });
    } else {
      signedResult = await walletObj.signTransactionBlock({ transactionBlock: tx, chain: 'sui:testnet' });
    }
    const txBytes   = signedResult?.bytes ?? signedResult?.transactionBytes ?? signedResult?.transactionBlockBytes;
    const signature = signedResult?.signature;
    if (!txBytes || !signature) throw new Error('Legacy signing response missing bytes or signature.');
    executeResult = await _broadcast(txBytes, signature);
  }

  else {
    throw new Error(
      'Wallet supports none of the known Sui signing features.\n' +
      `Supported: ${featKeys.join(', ')}`
    );
  }

  return executeResult;
}


// ════════════════════════════════════════════════════════════════════
// MOVE CONTRACT CALL BUILDERS
// ════════════════════════════════════════════════════════════════════

// ── Donate (the core fix) ─────────────────────────────────────────
/**
 * Builds a PTB that calls relief_chain::donate, splitting exact amount
 * from tx.gas and passing it into the Campaign's treasury.
 *
 * @param {object} wallet - Connected wallet
 * @param {string} senderAddress - Donor's address
 * @param {string} campaignObjectId - The shared Campaign object ID on Sui
 * @param {number} amountSui - Amount in SUI (e.g. 1.5 for 1.5 SUI)
 */
export async function donateSuiOnChain(wallet, senderAddress, campaignObjectId, amountSui) {
  // Pre-flight validation
  if (typeof amountSui !== 'number' || isNaN(amountSui) || amountSui <= 0) {
    throw new Error(`Invalid donation amount: "${amountSui}". Must be a positive number.`);
  }
  if (!campaignObjectId || !campaignObjectId.startsWith('0x')) {
    throw new Error(`Invalid campaign object ID: "${campaignObjectId}". Must be a valid Sui object ID.`);
  }

  // Balance check
  try {
    const bal = await getSuiBalance(senderAddress);
    const needed = amountSui + 0.05;
    if (bal < needed) {
      throw new Error(
        `Insufficient SUI: wallet has ${bal.toFixed(4)} SUI but needs ≥ ${needed.toFixed(4)} SUI ` +
        `(amount + gas). Get testnet SUI at https://faucet.sui.io`
      );
    }
    console.log(`[ReliefChain] ✔ Balance OK: ${bal.toFixed(4)} SUI (need ${needed.toFixed(4)})`);
  } catch (e) {
    if (e.message.includes('Insufficient SUI')) throw e;
    console.warn('[ReliefChain] Balance check non-fatal:', e.message);
  }

  const PACKAGE_ID = getPackageId();
  const amountInMist = BigInt(Math.floor(amountSui * 1_000_000_000));

  const tx = new Transaction();

  // Split exact donation amount from gas coin → Coin<SUI>
  const [donationCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountInMist)]);

  // Call the Move contract: donate(campaign, payment, amount)
  tx.moveCall({
    target: `${PACKAGE_ID}::relief_chain::donate`,
    arguments: [
      tx.object(campaignObjectId),     // &mut Campaign (shared object)
      donationCoin,                     // &mut Coin<SUI>
      tx.pure.u64(amountInMist),        // amount: u64
    ],
  });

  // Transfer remaining coin back to sender (prevents UnusedValueWithoutDrop in PTB)
  tx.transferObjects([donationCoin], tx.pure.address(senderAddress));

  console.log(`[ReliefChain] 📦 Built donate PTB: ${amountSui} SUI → Campaign ${campaignObjectId}`);

  const result = await signAndExecuteTx(wallet, senderAddress, tx, `donate ${amountSui} SUI`);
  const digest = result?.digest || result?.effects?.transactionEffects?.transactionDigest || '';

  console.log(`[ReliefChain] ✅ Donation confirmed! Digest: ${digest}`);
  console.log(`[ReliefChain] Explorer: https://suiscan.xyz/testnet/tx/${digest}`);

  return { digest, rawResult: result?.rawResult || result };
}


// ── Create Campaign ───────────────────────────────────────────────
/**
 * Calls relief_chain::create_campaign on-chain.
 * Returns { digest, campaignObjectId? }
 */
export async function createCampaignOnChain(wallet, senderAddress, { title, description, location, severity, goalSui }) {
  if (!title || !description || !location) {
    throw new Error('Campaign title, description, and location are required.');
  }
  if (!goalSui || goalSui <= 0) {
    throw new Error('Campaign goal must be a positive number in SUI.');
  }

  const PACKAGE_ID = getPackageId();
  const goalInMist = BigInt(Math.floor(goalSui * 1_000_000_000));

  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::relief_chain::create_campaign`,
    arguments: [
      tx.pure.string(title),
      tx.pure.string(description),
      tx.pure.string(location),
      tx.pure.u8(severity || 3),
      tx.pure.u64(goalInMist),
    ],
  });

  console.log(`[ReliefChain] 📦 Built create_campaign PTB: "${title}" goal=${goalSui} SUI`);
  const result = await signAndExecuteTx(wallet, senderAddress, tx, `create_campaign "${title}"`);

  // Try to extract the created Campaign object ID from the result
  let campaignObjectId = null;
  try {
    const created = result?.rawResult?.effects?.created || [];
    // The Campaign is the shared object
    const sharedObj = created.find(o => o.owner === 'Shared' || o.owner?.Shared);
    if (sharedObj) campaignObjectId = sharedObj.reference?.objectId || sharedObj.objectId;
  } catch (_) {}

  return { digest: result.digest, campaignObjectId };
}


// ── Verify Campaign ───────────────────────────────────────────────
export async function verifyCampaignOnChain(wallet, senderAddress, verifierCapId, campaignObjectId) {
  const PACKAGE_ID = getPackageId();
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::relief_chain::verify_campaign`,
    arguments: [
      tx.object(verifierCapId),
      tx.object(campaignObjectId),
    ],
  });
  return signAndExecuteTx(wallet, senderAddress, tx, 'verify_campaign');
}


// ── Add Milestone ─────────────────────────────────────────────────
export async function addMilestoneOnChain(wallet, senderAddress, campaignAdminCapId, campaignObjectId, { description, allocationSui, beneficiary }) {
  const PACKAGE_ID = getPackageId();
  const allocationMist = BigInt(Math.floor(allocationSui * 1_000_000_000));
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::relief_chain::add_milestone`,
    arguments: [
      tx.object(campaignAdminCapId),
      tx.object(campaignObjectId),
      tx.pure.string(description),
      tx.pure.u64(allocationMist),
      tx.pure.address(beneficiary),
    ],
  });
  return signAndExecuteTx(wallet, senderAddress, tx, 'add_milestone');
}


// ── Attach Evidence ───────────────────────────────────────────────
export async function attachEvidenceOnChain(wallet, senderAddress, campaignAdminCapId, campaignObjectId, {
  milestoneIndex, evidenceId, walrusBlobId, contentHash, mimeType, title, metadata
}) {
  const PACKAGE_ID = getPackageId();
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::relief_chain::attach_evidence`,
    arguments: [
      tx.object(campaignAdminCapId),
      tx.object(campaignObjectId),
      tx.pure.u64(milestoneIndex),
      tx.pure.string(evidenceId),
      tx.pure.string(walrusBlobId),
      tx.pure.string(contentHash),
      tx.pure.string(mimeType),
      tx.pure.string(title),
      tx.pure.string(metadata || ''),
      tx.object('0x6'), // Clock object (system)
    ],
  });
  return signAndExecuteTx(wallet, senderAddress, tx, 'attach_evidence');
}


// ── Approve Milestone ─────────────────────────────────────────────
export async function approveMilestoneOnChain(wallet, senderAddress, verifierCapId, campaignObjectId, milestoneIndex) {
  const PACKAGE_ID = getPackageId();
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::relief_chain::approve_milestone`,
    arguments: [
      tx.object(verifierCapId),
      tx.object(campaignObjectId),
      tx.pure.u64(milestoneIndex),
    ],
  });
  return signAndExecuteTx(wallet, senderAddress, tx, `approve_milestone #${milestoneIndex}`);
}


// ── Release Funds ─────────────────────────────────────────────────
export async function releaseFundsOnChain(wallet, senderAddress, verifierCapId, campaignObjectId, milestoneIndex, amountSui) {
  const PACKAGE_ID = getPackageId();
  const amountMist = BigInt(Math.floor(amountSui * 1_000_000_000));
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::relief_chain::release_funds`,
    arguments: [
      tx.object(verifierCapId),
      tx.object(campaignObjectId),
      tx.pure.u64(milestoneIndex),
      tx.pure.u64(amountMist),
    ],
  });
  return signAndExecuteTx(wallet, senderAddress, tx, `release_funds ${amountSui} SUI`);
}


// ── Complete Campaign ─────────────────────────────────────────────
export async function completeCampaignOnChain(wallet, senderAddress, verifierCapId, campaignObjectId) {
  const PACKAGE_ID = getPackageId();
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::relief_chain::complete_campaign`,
    arguments: [
      tx.object(verifierCapId),
      tx.object(campaignObjectId),
    ],
  });
  return signAndExecuteTx(wallet, senderAddress, tx, 'complete_campaign');
}


// ── Cancel Campaign ───────────────────────────────────────────────
export async function cancelCampaignOnChain(wallet, senderAddress, verifierCapId, campaignObjectId, reason) {
  const PACKAGE_ID = getPackageId();
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::relief_chain::cancel_campaign`,
    arguments: [
      tx.object(verifierCapId),
      tx.object(campaignObjectId),
      tx.pure.string(reason || 'Cancelled'),
    ],
  });
  return signAndExecuteTx(wallet, senderAddress, tx, 'cancel_campaign');
}


// ── Broadcast helper ──────────────────────────────────────────────
async function _broadcast(txBytes, signature) {
  console.log('[ReliefChain] Broadcasting via RPC...');

  const payload = [
    txBytes,
    [signature],
    { showInput: true, showEffects: true, showEvents: true },
    'WaitForLocalExecution',
  ];

  let result;
  try {
    result = await sendRpcRequest('sui_executeTransactionBlock', payload);
  } catch (e) {
    console.error('[ReliefChain] Broadcast failed:', e.message);
    throw new Error(`Broadcast failed: ${e.message}`);
  }

  const status = result?.effects?.status?.status;
  if (status === 'failure') {
    const errMsg = result?.effects?.status?.error ?? 'Unknown on-chain failure.';
    console.error('[ReliefChain] On-chain execution failed:', errMsg);
    throw new Error(`On-chain failure: ${errMsg}`);
  }

  const digest = result?.digest ?? '';
  console.log('[ReliefChain] ✅ Broadcast successful! Digest:', digest);
  console.log('[ReliefChain] Explorer: https://suiscan.xyz/testnet/tx/' + digest);

  return result;
}

// ── Error message helper ──────────────────────────────────────────
export function getCleanErrorMessage(err) {
  if (!err) return 'Unknown blockchain error.';
  if (typeof err === 'string') return err;

  return (
    err.cause?.message  ??
    (typeof err.details === 'string' ? err.details : null) ??
    err.data?.message   ??
    err.message         ??
    (() => { try { return JSON.stringify(err); } catch (_) { return err.toString(); } })()
  );
}
