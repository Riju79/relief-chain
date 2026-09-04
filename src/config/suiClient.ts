import dotenv from 'dotenv';
import { JsonRpcHTTPTransport, SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import config from './appConfig.js';

dotenv.config();

const headers: Record<string, string> = {
  'Content-Type': 'application/json',
};

const transport = new JsonRpcHTTPTransport({
  url: config.sui.rpcUrl,
  rpc: {
    headers,
  },
});

/**
 * Singleton instance of the SuiJsonRpcClient connected to Sui RPC endpoint.
 */
export const suiClient = new SuiJsonRpcClient({
  transport,
  network: config.sui.network,
});

export default suiClient;
