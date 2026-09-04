import { SuiHTTPStatusError, JsonRpcError, SuiHTTPTransportError } from '@mysten/sui/jsonRpc';
import type { Transaction } from '@mysten/sui/transactions';
import type { Signer } from '@mysten/sui/cryptography';
import suiClient from '../config/suiClient.js';

/**
 * Standard structured error response.
 */
export interface ErrorResponse {
  success: false;
  error: string;
  statusCode?: number;
}

/**
 * Formatted balance response containing MIST and formatted SUI values.
 */
export interface BalanceResponse {
  success: true;
  balanceMist: string;
  balanceSui: number;
  coinObjectCount: number;
}

/**
 * Handle HTTP/RPC errors throwing from the Tatum RPC Gateway.
 * Detects 401 (Unauthorized) and 429 (Too Many Requests) specifically.
 * 
 * @param error - The raw error caught from the RPC call
 * @returns A structured ErrorResponse object
 */
export function handleRpcError(error: any): ErrorResponse {
  if (error instanceof SuiHTTPStatusError) {
    const status = error.status;
    if (status === 401) {
      return {
        success: false,
        error: 'Tatum Authentication Failure: Invalid or expired API key (HTTP 401).',
        statusCode: 401,
      };
    }
    if (status === 429) {
      return {
        success: false,
        error: 'Tatum Rate Limit Exceeded: Too many requests, please slow down (HTTP 429).',
        statusCode: 429,
      };
    }
    return {
      success: false,
      error: `Sui RPC Gateway HTTP error (${status}): ${error.message}`,
      statusCode: status,
    };
  }

  if (error instanceof SuiHTTPTransportError) {
    return {
      success: false,
      error: `Sui RPC Transport failure: ${error.message}`,
    };
  }

  if (error instanceof JsonRpcError) {
    return {
      success: false,
      error: `Sui JSON-RPC Node error: ${error.message} (Code: ${error.code})`,
    };
  }

  return {
    success: false,
    error: error instanceof Error ? error.message : 'An unknown blockchain error occurred.',
  };
}

/**
 * Fetches the total SUI balance for a given public address.
 * 
 * @param address - The public Sui address (e.g. 0x...)
 * @returns Structured BalanceResponse or ErrorResponse
 */
export async function getBalance(address: string): Promise<BalanceResponse | ErrorResponse> {
  try {
    if (!address.startsWith('0x')) {
      throw new Error('Invalid Sui address format: Must start with "0x"');
    }

    const balanceResult = await suiClient.getBalance({
      owner: address,
      coinType: '0x2::sui::SUI',
    });

    const balanceMist = balanceResult.totalBalance;
    const coinObjectCount = balanceResult.coinObjectCount;
    // 1 SUI = 10^9 MIST
    const balanceSui = Number(balanceMist) / 1_000_000_000;

    return {
      success: true,
      balanceMist,
      balanceSui,
      coinObjectCount,
    };
  } catch (err) {
    return handleRpcError(err);
  }
}

/**
 * Fetches structural transaction block details for a given digest.
 * 
 * @param digest - The unique transaction digest string
 * @returns Structured success transaction response or ErrorResponse
 */
export async function getTransactionBlock(digest: string): Promise<{ success: true; transaction: any } | ErrorResponse> {
  try {
    if (!digest) {
      throw new Error('Transaction digest is required.');
    }

    const transaction = await suiClient.getTransactionBlock({
      digest,
      options: {
        showInput: true,
        showEffects: true,
        showEvents: true,
        showBalanceChanges: true,
        showObjectChanges: true,
      },
    });

    return {
      success: true,
      transaction,
    };
  } catch (err) {
    return handleRpcError(err);
  }
}

/**
 * Fetches all objects owned by a given public address.
 * 
 * @param address - The public Sui address (e.g. 0x...)
 * @returns Structured list of owned objects or ErrorResponse
 */
export async function getOwnedObjects(address: string): Promise<{ success: true; objects: any[] } | ErrorResponse> {
  try {
    if (!address.startsWith('0x')) {
      throw new Error('Invalid Sui address format: Must start with "0x"');
    }

    const paginatedObjects = await suiClient.getOwnedObjects({
      owner: address,
      options: {
        showType: true,
        showContent: true,
        showDisplay: true,
      },
    });

    return {
      success: true,
      objects: paginatedObjects.data,
    };
  } catch (err) {
    return handleRpcError(err);
  }
}

/**
 * Signs and executes a transaction block on the Sui blockchain.
 * 
 * @param txBlock - The Transaction instance to execute
 * @param keypair - The signer (Ed25519Keypair or other valid Signer)
 * @returns The executed transaction response or ErrorResponse
 */
export async function executeTransaction(
  txBlock: Uint8Array | Transaction,
  keypair: Signer
): Promise<{ success: true; result: any } | ErrorResponse> {
  try {
    const result = await suiClient.signAndExecuteTransaction({
      transaction: txBlock,
      signer: keypair,
      options: {
        showEffects: true,
        showEvents: true,
        showObjectChanges: true,
      },
    });

    return {
      success: true,
      result,
    };
  } catch (err) {
    return handleRpcError(err);
  }
}

/**
 * Fetches the latest checkpoint sequence number from the Sui blockchain.
 * 
 * @returns The latest checkpoint sequence number or ErrorResponse
 */
export async function getLatestCheckpoint(): Promise<{ success: true; checkpoint: string } | ErrorResponse> {
  try {
    const checkpoint = await suiClient.getLatestCheckpointSequenceNumber();
    return {
      success: true,
      checkpoint,
    };
  } catch (err) {
    return handleRpcError(err);
  }
}
