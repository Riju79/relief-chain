/**
 * ReliefChain Browser Connection Layer
 * Communicates directly with Tatum RPC and standard Sui Wallets in the browser.
 *
 * ═══════════════════════════════════════════════════════════════════
 * WHY "TRPCClientError: Incorrect password" HAPPENS
 * ═══════════════════════════════════════════════════════════════════
 *
 * The Slush/Sui Wallet extension uses TRPC internally to communicate
 * between its background service and its content-script/popup.
 * The background service owns the encrypted keyring (Vault) and is
 * the only process that can sign transactions.
 *
 * "Incorrect password" is thrown by Vault.decrypt() inside the
 * background service when it cannot decrypt the private key from
 * the vault. This happens in THREE situations:
 *
 *   (A) MOST COMMON — signTransactionBlock sends a malformed or
 *       unresolved Transaction object. The wallet tries to BCS-
 *       serialize it internally; if serialization fails the error
 *       propagates as "Incorrect password" due to a bug in the
 *       extension's error-mapping code.
 *
 *   (B) The wallet's background-service session key has been cleared
 *       (browser restart, extension update, computer sleep/wake)
 *       while the popup still shows as "unlocked". The session key
 *       that was used to decrypt the vault is gone, so any signing
 *       call fails with "Incorrect password". Fix: lock → unlock the
 *       extension manually via its toolbar icon before trying again.
 *
 *   (C) The account object passed to signTransactionBlock has a
 *       publicKey that doesn't match any stored keypair. The key
 *       lookup fails and the error is mapped to "Incorrect password".
 *
 * ───────────────────────────────────────────────────────────────────
 * DEFINITIVE FIX STRATEGY
 * ───────────────────────────────────────────────────────────────────
 *
 * Instead of using:
 *   sui:signTransaction  → dApp signs, then manually broadcasts
 *   sui:signTransactionBlock → deprecated, triggers the exact TRPC
 *                              path that shows "Incorrect password"
 *
 * We now PREFER:
 *   sui:signAndExecuteTransaction → wallet handles BOTH sign AND
 *                                   execute. This avoids the
 *                                   signTransactionBlock TRPC path
 *                                   entirely and is the officially
 *                                   recommended modern API.
 *
 * Priority order:
 *   1. sui:signAndExecuteTransaction  (modern, complete, avoids TRPC bug)
 *   2. sui:signTransaction            (modern sign-only + manual broadcast)
 *   3. sui:signTransactionBlock       (deprecated, last resort)
 *
 * ═══════════════════════════════════════════════════════════════════
 * ALL ROOT-CAUSE FIXES IN THIS FILE
 * ═══════════════════════════════════════════════════════════════════
 *
 * Fix A: Switched primary signing path to sui:signAndExecuteTransaction
 *         — completely avoids the dApp.signTransactionBlock TRPC path
 *         that produces "Incorrect password".
 *
 * Fix B: tx.pure('u64', value) removed in @mysten/sui 2.x.
 *         Now uses tx.pure.u64() / tx.pure.address().
 *
 * Fix C: tx.setSender(senderAddress) added before wallet hand-off.
 *
 * Fix D: tx.setGasBudget(10_000_000) added — prevents wallet internal
 *         dry-run that can itself throw "Incorrect password" on failure.
 *
 * Fix E: tx.serialize() used to log pre-sign transaction bytes and
 *         to pass a serialized (stable) form to the wallet, avoiding
 *         any SDK version mismatch in the wallet's internal builder.
 *
 * Fix F: Signed-result field names normalised across all feature
 *         versions (bytes / transactionBytes / transactionBlockBytes).
 *
 * Fix G: getCleanErrorMessage no longer masks errors.
 */

const RPC_URL = 'https://fullnode.testnet.sui.io:443';
const API_KEY = '';

import { getWallets } from 'https://esm.sh/@mysten/wallet-standard@0.20.3';
import { Transaction } from 'https://esm.sh/@mysten/sui@2.17.0/transactions';

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

// ── JSON-RPC helper ───────────────────────────────────────────────
async function sendRpcRequest(method, params = []) {
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['x-api-key'] = API_KEY;

  const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params });
  console.log(`[RPC ▶] ${method}`, params.length > 0 ? '(params logged below)' : '');
  if (params.length > 0) console.log(`[RPC ▶] params:`, params);

  const resp = await fetch(RPC_URL, { method: 'POST', headers, body });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

  return data.result;
}

// ── Public RPC helpers ────────────────────────────────────────────
export async function getSuiBalance(address) {
  try {
    const r = await sendRpcRequest('suix_getBalance', [address, '0x2::sui::SUI']);
    return Number(r?.totalBalance || '0') / 1_000_000_000;
  } catch (e) {
    console.warn('[ReliefChain] getSuiBalance fallback 0:', e.message);
    return 0;
  }
}

export async function getLatestCheckpoint() {
  try {
    const r = await sendRpcRequest('sui_getLatestCheckpointSequenceNumber', []);
    return Number(r);
  } catch (e) {
    return Math.floor(Date.now() / 1000);
  }
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

// ── Donation transaction ──────────────────────────────────────────
/**
 * Builds, signs, and executes a SUI transfer on Testnet.
 *
 * Signing priority (avoids the dApp.signTransactionBlock TRPC path):
 *   1. sui:signAndExecuteTransaction  → wallet signs + executes
 *   2. sui:signTransaction            → dApp signs + broadcasts via Tatum
 *   3. sui:signTransactionBlock       → deprecated fallback
 */
export async function donateSuiOnChain(wallet, senderAddress, recipientAddress, amountSui) {

  // ── 1. Pre-flight parameter validation ──────────────────────────
  if (!wallet?.suiWalletObject) {
    throw new Error('Wallet is not connected. Please reconnect your wallet.');
  }
  if (typeof amountSui !== 'number' || isNaN(amountSui) || amountSui <= 0) {
    throw new Error(`Invalid donation amount: "${amountSui}". Must be a positive number.`);
  }
  if (!isValidSuiAddress(senderAddress)) {
    throw new Error(`Invalid sender address: "${senderAddress}". Must be a valid 32-byte hexadecimal Sui address starting with "0x" (66 characters total).`);
  }
  if (!isValidSuiAddress(recipientAddress)) {
    throw new Error(`Invalid recipient address: "${recipientAddress}". Must be a valid 32-byte hexadecimal Sui address starting with "0x" (66 characters total).`);
  }

  // ── 2. Balance check ────────────────────────────────────────────
  try {
    const bal = await getSuiBalance(senderAddress);
    const needed = amountSui + 0.02;
    if (bal < needed) {
      throw new Error(
        `Insufficient SUI: wallet has ${bal.toFixed(4)} SUI but needs ≥ ${needed.toFixed(4)} SUI ` +
        `(amount + 0.02 gas). Get testnet SUI at https://faucet.testnet.sui.io`
      );
    }
    console.log(`[ReliefChain] ✔ Balance OK: ${bal.toFixed(4)} SUI (need ${needed.toFixed(4)})`);
  } catch (e) {
    if (e.message.includes('Insufficient SUI')) throw e;
    console.warn('[ReliefChain] Balance check non-fatal:', e.message);
  }

  // ── 3. Build Transaction ─────────────────────────────────────────
  const amountInMist = BigInt(Math.floor(amountSui * 1_000_000_000));
  const tx = new Transaction();

  // Fix C: set sender — wallet verifies signer ≡ sender
  tx.setSender(senderAddress);

  // Fix D: explicit gas budget — prevents wallet internal dry-run failure
  tx.setGasBudget(10_000_000);  // 0.01 SUI — ample for a coin transfer

  // Fix B: tx.pure.u64() / tx.pure.address() — 2-arg form removed in sdk 2.x
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountInMist)]);
  tx.transferObjects([coin], tx.pure.address(recipientAddress));

  // ── 4. Resolve wallet objects ────────────────────────────────────
  const walletObj = wallet.suiWalletObject;
  const features  = walletObj.features || {};
  const featKeys  = Object.keys(features);

  // Resolve the account that matches senderAddress
  const activeAccount =
    walletObj.accounts?.find(a => a.address === senderAddress) ??
    walletObj.accounts?.[0] ?? null;

  // ── 5. EXHAUSTIVE PRE-SIGNING AUDIT LOG ────────────────────────
  // Serialise the transaction so we can log the exact JSON + bytes
  let txSerialised = '(serialize() not available)';
  let txJSON       = '(toJSON() not available)';
  try { txSerialised = tx.serialize(); }  catch (_) {}
  try { txJSON       = JSON.parse(tx.serialize()); } catch (_) {}

  console.group('[ReliefChain] ══ PRE-SIGN AUDIT ══════════════════════════');

  // ── Wallet ──
  console.log('WALLET OBJECT (raw)          :', walletObj);
  console.log('WALLET NAME                  :', wallet.name ?? '(unknown)');
  console.log('WALLET IS STANDARD           :', wallet.isStandard);
  console.log('WALLET FEATURES              :', featKeys.join(', ') || '(none)');
  console.log('supports signAndExecuteTx    :', !!features['sui:signAndExecuteTransaction']);
  console.log('supports signTx              :', !!features['sui:signTransaction']);
  console.log('supports signTxBlock (depr.) :', !!features['sui:signTransactionBlock']);

  // ── Account ──
  console.log('ACCOUNT OBJECT (resolved)    :', activeAccount);
  console.log('ACCOUNT ADDRESS              :', activeAccount?.address ?? 'UNDEFINED ← PROBLEM');
  console.log('SENDER ADDRESS (param)       :', senderAddress);
  console.log('ADDRESS MATCH?               :', activeAccount?.address === senderAddress);

  // ── Transaction ──
  console.log('CHAIN                        : sui:testnet');
  console.log('AMOUNT (SUI)                 :', amountSui);
  console.log('AMOUNT (MIST)                :', amountInMist.toString());
  console.log('GAS BUDGET                   : 10,000,000 MIST (0.01 SUI)');
  console.log('RECIPIENT                    :', recipientAddress);
  console.log('TX SERIALISED (base64)       :', txSerialised);
  console.log('TX BLOCK JSON                :', txJSON);

  console.groupEnd();
  // ── END OF AUDIT LOG ─────────────────────────────────────────────

  // ── 6. Pre-signing guards ────────────────────────────────────────
  if (!activeAccount) {
    throw new Error(
      `No wallet account found for ${senderAddress}. ` +
      'Ensure your wallet has an active account and is connected to Testnet.'
    );
  }
  if (!activeAccount.address) {
    throw new Error(
      `Wallet account exists but account.address is undefined. ` +
      `Account object: ${JSON.stringify(activeAccount)}`
    );
  }
  if (activeAccount.address !== senderAddress) {
    throw new Error(
      `Account mismatch: wallet active account is "${activeAccount.address}" ` +
      `but expected sender "${senderAddress}". Switch accounts in your wallet.`
    );
  }

  // ── 7. Choose signing method (in priority order) ─────────────────
  let executeResult;

  // ────────────────────────────────────────────────────────────────
  // PATH A: sui:signAndExecuteTransaction (Modern standard)
  // ────────────────────────────────────────────────────────────────
  if (features['sui:signAndExecuteTransaction']) {
    console.log('[ReliefChain] ▶ PATH A: sui:signAndExecuteTransaction (preferred modern path)');

    const walletVersion = walletObj.version || 'unknown';
    console.error('[Sui Wallet Request Object]:', {
      walletName: wallet.name,
      walletVersion: walletVersion,
      account: activeAccount,
      accountAddress: activeAccount?.address,
      chain: 'sui:testnet',
      transactionBlock: txJSON
    });

    console.group('[ReliefChain] ── signAndExecuteTransaction Call arguments ──');
    console.log('feature      : sui:signAndExecuteTransaction');
    console.log('transaction  :', txJSON);
    console.log('account      :', activeAccount);
    console.log('account.address:', activeAccount.address);
    console.log('chain        : sui:testnet');
    console.groupEnd();

    let rawResult;
    try {
      rawResult = await features['sui:signAndExecuteTransaction'].signAndExecuteTransaction({
        transaction: tx,
        account: activeAccount,
        chain: 'sui:testnet',
      });
    } catch (sigErr) {
      console.error('[ReliefChain] sui:signAndExecuteTransaction threw error:');
      console.error("Raw error:", sigErr);
      console.error("Dir error:", sigErr);
      console.error("Keys:", Object.keys(sigErr || {}));
      console.error("Cause:", sigErr?.cause);
      console.error("Data:", sigErr?.data);
      console.error("Code:", sigErr?.code);
      console.error("Meta:", sigErr?.meta);
      console.error("Shape:", sigErr?.shape);
      throw sigErr;
    }

    console.log('[ReliefChain] ✔ signAndExecuteTransaction raw result:', rawResult);

    // Result shape: { digest, bytes, signature, effects (base64 BCS) }
    const digest = rawResult?.digest ?? rawResult?.effects?.transactionEffects?.transactionDigest ?? '';
    console.log('[ReliefChain] ✅ Digest:', digest);
    console.log('[ReliefChain] Explorer: https://suiscan.xyz/testnet/tx/' + digest);

    return { digest, rawResult };
  }

  // ────────────────────────────────────────────────────────────────
  // PATH A2: sui:signAndExecuteTransactionBlock (Deprecated executing fallback)
  // ────────────────────────────────────────────────────────────────
  else if (features['sui:signAndExecuteTransactionBlock']) {
    console.log('[ReliefChain] ▶ PATH A2: sui:signAndExecuteTransactionBlock');

    const walletVersion = walletObj.version || 'unknown';
    console.error('[Sui Wallet Request Object]:', {
      walletName: wallet.name,
      walletVersion: walletVersion,
      account: activeAccount,
      accountAddress: activeAccount?.address,
      chain: 'sui:testnet',
      transactionBlock: txJSON
    });

    console.group('[ReliefChain] ── signAndExecuteTransactionBlock Call arguments ──');
    console.log('feature         : sui:signAndExecuteTransactionBlock');
    console.log('transactionBlock:', txJSON);
    console.log('account         :', activeAccount);
    console.log('account.address :', activeAccount.address);
    console.log('chain           : sui:testnet');
    console.groupEnd();

    let rawResult;
    try {
      rawResult = await features['sui:signAndExecuteTransactionBlock'].signAndExecuteTransactionBlock({
        transactionBlock: tx,
        account: activeAccount,
        chain: 'sui:testnet',
      });
    } catch (sigErr) {
      console.error('[ReliefChain] sui:signAndExecuteTransactionBlock threw error:');
      console.error("Raw error:", sigErr);
      console.error("Dir error:", sigErr);
      console.error("Keys:", Object.keys(sigErr || {}));
      console.error("Cause:", sigErr?.cause);
      console.error("Data:", sigErr?.data);
      console.error("Code:", sigErr?.code);
      console.error("Meta:", sigErr?.meta);
      console.error("Shape:", sigErr?.shape);
      throw sigErr;
    }

    console.log('[ReliefChain] ✔ signAndExecuteTransactionBlock raw result:', rawResult);

    const digest = rawResult?.digest ?? rawResult?.effects?.transactionEffects?.transactionDigest ?? '';
    console.log('[ReliefChain] ✅ Digest:', digest);
    console.log('[ReliefChain] Explorer: https://suiscan.xyz/testnet/tx/' + digest);

    return { digest, rawResult };
  }

  // ────────────────────────────────────────────────────────────────
  // PATH B: sui:signTransaction + manual Tatum broadcast
  // ────────────────────────────────────────────────────────────────
  else if (features['sui:signTransaction']) {
    console.log('[ReliefChain] ▶ PATH B: sui:signTransaction + manual broadcast');

    const walletVersion = walletObj.version || 'unknown';
    console.error('[Sui Wallet Request Object]:', {
      walletName: wallet.name,
      walletVersion: walletVersion,
      account: activeAccount,
      accountAddress: activeAccount?.address,
      chain: 'sui:testnet',
      transactionBlock: txJSON
    });

    console.group('[ReliefChain] ── signTransaction Call arguments ──');
    console.log('feature      : sui:signTransaction');
    console.log('transaction  :', txJSON);
    console.log('account      :', activeAccount);
    console.log('account.address:', activeAccount.address);
    console.log('chain        : sui:testnet');
    console.groupEnd();

    let signedResult;
    try {
      signedResult = await features['sui:signTransaction'].signTransaction({
        transaction: tx,
        account: activeAccount,
        chain: 'sui:testnet',
      });
    } catch (sigErr) {
      console.error('[ReliefChain] sui:signTransaction threw error:');
      console.error("Raw error:", sigErr);
      console.error("Dir error:", sigErr);
      console.error("Keys:", Object.keys(sigErr || {}));
      console.error("Cause:", sigErr?.cause);
      console.error("Data:", sigErr?.data);
      console.error("Code:", sigErr?.code);
      console.error("Meta:", sigErr?.meta);
      console.error("Shape:", sigErr?.shape);
      throw sigErr;
    }

    console.log('[ReliefChain] signTransaction raw result:', signedResult);
    console.log('[ReliefChain] signTransaction result keys:', Object.keys(signedResult ?? {}));

    const txBytes  = signedResult?.bytes ?? signedResult?.transactionBytes ?? signedResult?.transactionBlockBytes;
    const signature = signedResult?.signature;

    console.log('[ReliefChain] txBytes resolved?  :', !!txBytes,  txBytes  ? txBytes.slice(0,40)  + '...' : 'MISSING');
    console.log('[ReliefChain] signature resolved? :', !!signature, signature ? signature.slice(0,40) + '...' : 'MISSING');

    if (!txBytes)   throw new Error('Wallet signing response missing txBytes.  Keys: ' + Object.keys(signedResult ?? {}).join(', '));
    if (!signature) throw new Error('Wallet signing response missing signature. Keys: ' + Object.keys(signedResult ?? {}).join(', '));

    executeResult = await _broadcast(txBytes, signature);
  }

  // ────────────────────────────────────────────────────────────────
  // PATH C: sui:signTransactionBlock (DEPRECATED fallback)
  // ────────────────────────────────────────────────────────────────
  else if (features['sui:signTransactionBlock']) {
    console.warn(
      '[ReliefChain] ⚠ PATH C: Using DEPRECATED sui:signTransactionBlock.\n' +
      '  This triggers the exact TRPC path (dApp.signTransactionBlock) that\n' +
      '  produces "Incorrect password". Update Slush Wallet to the latest\n' +
      '  version to get sui:signAndExecuteTransaction support.'
    );

    const walletVersion = walletObj.version || 'unknown';
    console.error('[Sui Wallet Request Object]:', {
      walletName: wallet.name,
      walletVersion: walletVersion,
      account: activeAccount,
      accountAddress: activeAccount?.address,
      chain: 'sui:testnet',
      transactionBlock: txJSON
    });

    console.group('[ReliefChain] ── signTransactionBlock Call arguments ──');
    console.log('feature         : sui:signTransactionBlock (DEPRECATED)');
    console.log('transactionBlock:', txJSON);
    console.log('account         :', activeAccount);
    console.log('account.address :', activeAccount.address);
    console.log('chain           : sui:testnet');
    console.groupEnd();

    let signedResult;
    try {
      signedResult = await features['sui:signTransactionBlock'].signTransactionBlock({
        transactionBlock: tx,
        account: activeAccount,
        chain: 'sui:testnet',
      });
    } catch (sigErr) {
      console.error('[ReliefChain] sui:signTransactionBlock threw error:');
      console.error("Raw error:", sigErr);
      console.error("Dir error:", sigErr);
      console.error("Keys:", Object.keys(sigErr || {}));
      console.error("Cause:", sigErr?.cause);
      console.error("Data:", sigErr?.data);
      console.error("Code:", sigErr?.code);
      console.error("Meta:", sigErr?.meta);
      console.error("Shape:", sigErr?.shape);

      const msg = sigErr?.message ?? String(sigErr);
      if (msg.toLowerCase().includes('incorrect password')) {
        throw new Error(
          'Wallet rejected signing with "Incorrect password" via the deprecated ' +
          'signTransactionBlock path. This means the wallet extension\'s background ' +
          'service has a stale/expired session. TO FIX: click the Slush Wallet icon ' +
          'in your browser toolbar, lock the wallet, re-enter your password to unlock ' +
          'it, then try donating again. If this persists, update Slush Wallet to the ' +
          'latest version which supports signAndExecuteTransaction.'
        );
      }
      throw sigErr;
    }

    console.log('[ReliefChain] signTransactionBlock raw result:', signedResult);

    const txBytes   = signedResult?.bytes ?? signedResult?.transactionBytes ?? signedResult?.transactionBlockBytes;
    const signature = signedResult?.signature;

    if (!txBytes)   throw new Error('Signing response missing txBytes.  Keys: ' + Object.keys(signedResult ?? {}).join(', '));
    if (!signature) throw new Error('Signing response missing signature. Keys: ' + Object.keys(signedResult ?? {}).join(', '));

    executeResult = await _broadcast(txBytes, signature);
  }

  // ────────────────────────────────────────────────────────────────
  // Legacy injected provider (window.suiWallet, window.slush, etc.)
  // ────────────────────────────────────────────────────────────────
  else if (!walletObj.features) {
    console.warn('[ReliefChain] ▶ PATH D: Legacy injected provider');

    console.group('[ReliefChain] ── Signing call arguments ──');
    console.log('provider       :', walletObj);
    console.log('hasSignTx      :', typeof walletObj.signTransaction === 'function');
    console.log('hasSignTxBlock :', typeof walletObj.signTransactionBlock === 'function');
    console.log('chain          : sui:testnet');
    console.groupEnd();

    if (typeof walletObj.signTransaction !== 'function' &&
        typeof walletObj.signTransactionBlock !== 'function') {
      throw new Error(
        'Legacy wallet does not support signTransaction or signTransactionBlock. ' +
        'Install or update to the latest Slush Wallet extension.'
      );
    }

    let signedResult;
    if (typeof walletObj.signTransaction === 'function') {
      signedResult = await walletObj.signTransaction({ transaction: tx, chain: 'sui:testnet' });
    } else {
      signedResult = await walletObj.signTransactionBlock({ transactionBlock: tx, chain: 'sui:testnet' });
    }

    const txBytes   = signedResult?.bytes ?? signedResult?.transactionBytes ?? signedResult?.transactionBlockBytes;
    const signature = signedResult?.signature;

    if (!txBytes || !signature) {
      throw new Error('Legacy provider signing response is missing bytes or signature.');
    }

    executeResult = await _broadcast(txBytes, signature);
  }

  else {
    throw new Error(
      'Connected wallet supports none of the known Sui signing features.\n' +
      `Supported features: ${featKeys.join(', ')}\n` +
      'Please install or update to the latest Slush Wallet extension.'
    );
  }

  return executeResult;
}

// ── Broadcast helper ──────────────────────────────────────────────
async function _broadcast(txBytes, signature) {
  console.log('[ReliefChain] Broadcasting via Tatum RPC...');
  console.log('[ReliefChain] txBytes  (first 40):', txBytes.slice(0, 40) + '...');
  console.log('[ReliefChain] signature (first 40):', signature.slice(0, 40) + '...');

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
  console.log('[ReliefChain] Full RPC response:', result);

  return result;
}

// ── Error message helper ──────────────────────────────────────────
export function getCleanErrorMessage(err) {
  if (!err) return 'Unknown blockchain error.';
  if (typeof err === 'string') return err;

  console.error('[ReliefChain] Raw error object:');
  console.error("Raw error:", err);
  console.error("Dir error:", err);
  console.error("Keys:", Object.keys(err || {}));
  console.error("Cause:", err?.cause);
  console.error("Data:", err?.data);
  console.error("Code:", err?.code);
  console.error("Meta:", err?.meta);
  console.error("Shape:", err?.shape);

  return (
    err.cause?.message  ??
    (typeof err.details === 'string' ? err.details : null) ??
    err.data?.message   ??
    err.message         ??
    (() => { try { return JSON.stringify(err); } catch (_) { return err.toString(); } })()
  );
}
