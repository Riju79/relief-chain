import dotenv from 'dotenv';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { JsonRpcHTTPTransport, SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import config from './appConfig.js';

dotenv.config();

export interface RpcEndpointStats {
  url: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  lastUsedAt?: number;
  lastFailureAt?: number;
  lastError?: string;
}

export class FailoverSuiClient {
  private network: 'testnet' | 'devnet' | 'localnet';
  private endpoints: string[];
  private grpcClients: SuiGrpcClient[];
  private jsonRpcClients: SuiJsonRpcClient[];
  private currentIndex: number = 0;
  private stats: Map<string, RpcEndpointStats>;

  constructor(rpcUrls?: string[], network?: 'testnet' | 'devnet' | 'localnet') {
    this.network = network || config.sui.network;
    this.endpoints = rpcUrls && rpcUrls.length > 0 ? rpcUrls : config.sui.rpcUrls;
    this.stats = new Map();

    this.grpcClients = [];
    this.jsonRpcClients = [];

    for (const url of this.endpoints) {
      this.stats.set(url, {
        url,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0
      });

      this.grpcClients.push(
        new SuiGrpcClient({
          network: this.network,
          baseUrl: url
        })
      );

      this.jsonRpcClients.push(
        new SuiJsonRpcClient({
          transport: new JsonRpcHTTPTransport({ url }),
          network: this.network
        })
      );
    }

    console.log(`[Sui RPC Failover] Initialized with ${this.endpoints.length} endpoints:`);
    this.endpoints.forEach((url, i) => console.log(`  [${i}] ${url}`));
  }

  public getEndpoints(): string[] {
    return [...this.endpoints];
  }

  public getStats(): RpcEndpointStats[] {
    return Array.from(this.stats.values());
  }

  public getActiveEndpoint(): string {
    return this.endpoints[this.currentIndex];
  }

  /**
   * Execute an operation with automatic retry and rotation across backup RPC endpoints
   */
  public async executeWithFailover<T>(
    operationName: string,
    operation: (clients: { grpc: SuiGrpcClient; jsonRpc: SuiJsonRpcClient }, endpointUrl: string) => Promise<T>
  ): Promise<T> {
    const totalEndpoints = this.endpoints.length;
    const errors: { url: string; error: string }[] = [];
    const startIndex = this.currentIndex;

    for (let attempt = 0; attempt < totalEndpoints; attempt++) {
      const index = (startIndex + attempt) % totalEndpoints;
      const url = this.endpoints[index];
      const grpc = this.grpcClients[index];
      const jsonRpc = this.jsonRpcClients[index];
      const endpointStats = this.stats.get(url)!;

      endpointStats.totalRequests++;
      endpointStats.lastUsedAt = Date.now();
      const startTime = Date.now();

      try {
        const result = await operation({ grpc, jsonRpc }, url);
        const duration = Date.now() - startTime;
        endpointStats.successfulRequests++;

        if (attempt > 0) {
          console.warn(
            `[SUI RPC FAILOVER RESOLVED] ${operationName} succeeded on backup endpoint: ${url} (took ${duration}ms, attempt ${attempt + 1}/${totalEndpoints})`
          );
          this.currentIndex = index; // Keep successful endpoint active
        } else {
          console.log(`[SUI RPC] ${operationName} served by ${url} (${duration}ms)`);
        }

        return result;
      } catch (err: any) {
        const duration = Date.now() - startTime;
        endpointStats.failedRequests++;
        endpointStats.lastFailureAt = Date.now();
        endpointStats.lastError = err.message || String(err);

        console.warn(
          `[SUI RPC FAILOVER WARNING] ${operationName} failed on endpoint [${index}] ${url} (${duration}ms): ${err.message}. Rotating to next endpoint...`
        );

        errors.push({ url, error: err.message || String(err) });
      }
    }

    const aggregatedErrorMessage = errors.map(e => `[${e.url}]: ${e.error}`).join(' | ');
    throw new Error(
      `[SUI RPC CRITICAL] All ${totalEndpoints} RPC endpoints failed for operation "${operationName}": ${aggregatedErrorMessage}`
    );
  }

  // ── Unified API surface supporting both modern gRPC & legacy JSON-RPC ─────────────

  public async getObject(params: any): Promise<any> {
    const objectId = params.objectId || params.id;
    return this.executeWithFailover(`getObject(${objectId})`, async ({ grpc, jsonRpc }) => {
      if (params.objectId) {
        return await grpc.getObject(params);
      }
      return await jsonRpc.getObject(params);
    });
  }

  public async listOwnedObjects(params: Parameters<SuiGrpcClient['listOwnedObjects']>[0]) {
    return this.executeWithFailover(`listOwnedObjects(${params.owner})`, ({ grpc }) => grpc.listOwnedObjects(params));
  }

  public async getOwnedObjects(params: Parameters<SuiJsonRpcClient['getOwnedObjects']>[0]) {
    return this.executeWithFailover(`getOwnedObjects(${params.owner})`, ({ jsonRpc }) => jsonRpc.getOwnedObjects(params));
  }

  public async queryEvents(params: Parameters<SuiJsonRpcClient['queryEvents']>[0]) {
    return this.executeWithFailover(`queryEvents`, ({ jsonRpc }) => jsonRpc.queryEvents(params));
  }

  public async getBalance(params: Parameters<SuiJsonRpcClient['getBalance']>[0]) {
    return this.executeWithFailover(`getBalance(${params.owner})`, ({ jsonRpc }) => jsonRpc.getBalance(params));
  }

  public async getTransactionBlock(params: Parameters<SuiJsonRpcClient['getTransactionBlock']>[0]) {
    return this.executeWithFailover(`getTransactionBlock(${params.digest})`, ({ jsonRpc }) => jsonRpc.getTransactionBlock(params));
  }

  public async signAndExecuteTransaction(params: Parameters<SuiJsonRpcClient['signAndExecuteTransaction']>[0]) {
    return this.executeWithFailover(`signAndExecuteTransaction`, ({ jsonRpc }) => jsonRpc.signAndExecuteTransaction(params));
  }

  public async getLatestCheckpointSequenceNumber(): Promise<string> {
    return this.executeWithFailover(`getLatestCheckpointSequenceNumber`, ({ jsonRpc }) => jsonRpc.getLatestCheckpointSequenceNumber());
  }

  public async executeTransaction(params: Parameters<SuiGrpcClient['executeTransaction']>[0]) {
    return this.executeWithFailover(`executeTransaction`, ({ grpc }) => grpc.executeTransaction(params));
  }
}

export const suiClient = new FailoverSuiClient();
export default suiClient;
