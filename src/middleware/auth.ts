import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { getDb } from '../db/client.js';
import { nonces } from '../db/schema.js';
import { eq, and, gt } from 'drizzle-orm';

const JWT_SECRET = process.env.JWT_SECRET || 'reliefchain_dev_jwt_secret_key_2026_secure';
const RPC_URL = process.env.SUI_RPC_URL || 'https://fullnode.testnet.sui.io:443';
const PACKAGE_ID = process.env.RELIEFCHAIN_PACKAGE_ID || '0x9c0e1fe411f3f1bc9b877710d000ef4ca3113e3461cdffed469be1f1bd7b5bfe';

export { JWT_SECRET };

// ── Nonce Generation ───────────────────────────────────────────────
export async function createNonce(walletAddress?: string): Promise<{ nonce: string; message: string; expiresAt: Date }> {
  const db = await getDb();
  const nonce = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes validity

  await db.insert(nonces).values({
    nonce,
    walletAddress: walletAddress || null,
    expiresAt,
    used: false,
  });

  const message = `Sign this message to authenticate with ReliefChain: ${nonce}`;
  return { nonce, message, expiresAt };
}

// ── Wallet Signature Verification & JWT Issuance ───────────────────
export async function verifyAndIssueToken(address: string, signature: string, nonce: string): Promise<{ token: string; address: string }> {
  if (!address || !signature || !nonce) {
    throw new Error('Address, signature, and nonce are required.');
  }

  const db = await getDb();

  // Find valid unexpired nonce
  const now = new Date();
  const matchedNonces = await db
    .select()
    .from(nonces)
    .where(and(eq(nonces.nonce, nonce), eq(nonces.used, false), gt(nonces.expiresAt, now)))
    .limit(1);

  if (matchedNonces.length === 0) {
    throw new Error('Nonce is invalid or has expired. Please request a fresh nonce.');
  }

  // Verify personal message signature
  const messageStr = `Sign this message to authenticate with ReliefChain: ${nonce}`;
  const messageBytes = new TextEncoder().encode(messageStr);

  let recoveredAddress = '';
  try {
    const pubKey = await verifyPersonalMessageSignature(messageBytes, signature);
    recoveredAddress = pubKey.toSuiAddress();
  } catch (sigErr: any) {
    throw new Error(`Cryptographic signature verification failed: ${sigErr.message}`);
  }

  if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
    throw new Error(`Signature mismatch: recovered "${recoveredAddress}" but expected "${address}".`);
  }

  // Mark nonce as used
  await db.update(nonces).set({ used: true }).where(eq(nonces.nonce, nonce));

  // Issue short-lived JWT (1 hour)
  const token = jwt.sign(
    {
      address: recoveredAddress,
      sub: recoveredAddress,
      iss: 'reliefchain-api',
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  return { token, address: recoveredAddress };
}

// ── JWT Verification Middleware ────────────────────────────────────
export function verifyJwt(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Missing Bearer token in Authorization header.',
    });
  }

  const token = authHeader.substring(7).trim();

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    req.user = { address: decoded.address };
    next();
  } catch (err: any) {
    return res.status(401).json({
      success: false,
      error: `Invalid or expired token: ${err.message}`,
    });
  }
}

// ── On-Chain Role Guard Middleware ─────────────────────────────────
/**
 * Verifies that the authenticated caller's wallet owns an AdminCap or VerifierCap
 * for the deployed ReliefChain Move package by querying Sui RPC in real-time.
 */
export function requireRole(allowedRoles: ('verifier' | 'admin')[]) {
  return async (req: any, res: any, next: any) => {
    // 1. Ensure user is authenticated
    if (!req.user || !req.user.address) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required before verifying on-chain roles.',
      });
    }

    const callerAddress = req.user.address;

    try {
      // 2. Query Sui RPC for owned objects
      const client = new SuiGrpcClient({ network: 'testnet', baseUrl: RPC_URL });
      const owned = await client.listOwnedObjects({
        owner: callerAddress,
      });

      const userObjects = owned.objects || [];
      const adminCapType = `${PACKAGE_ID}::relief_chain::AdminCap`;
      const verifierCapType = `${PACKAGE_ID}::relief_chain::VerifierCap`;

      const hasAdminCap = userObjects.some((o: any) => o.type?.includes(adminCapType));
      const hasVerifierCap = userObjects.some((o: any) => o.type?.includes(verifierCapType));

      let matchedRole: 'admin' | 'verifier' | null = null;
      if (hasAdminCap && allowedRoles.includes('admin')) {
        matchedRole = 'admin';
      } else if (hasVerifierCap && allowedRoles.includes('verifier')) {
        matchedRole = 'verifier';
      }

      if (!matchedRole) {
        return res.status(403).json({
          success: false,
          error: `Forbidden: Address "${callerAddress}" does not hold required on-chain capability (${allowedRoles.join(' or ')}). ` +
            `Must own an AdminCap or VerifierCap object for package ${PACKAGE_ID} on Sui testnet.`,
          requiredCaps: allowedRoles.map(r => r === 'admin' ? adminCapType : verifierCapType),
        });
      }

      req.user.role = matchedRole;
      req.user.hasAdminCap = hasAdminCap;
      req.user.hasVerifierCap = hasVerifierCap;
      next();
    } catch (rpcErr: any) {
      console.error('[requireRole RPC Error]:', rpcErr);
      return res.status(500).json({
        success: false,
        error: `Failed to verify on-chain capabilities via Sui RPC: ${rpcErr.message}`,
      });
    }
  };
}
