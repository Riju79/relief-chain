import dotenv from 'dotenv';

dotenv.config();

export type AppEnvironment = 'development' | 'testnet' | 'production';

export interface AppConfig {
  env: AppEnvironment;
  sui: {
    network: 'testnet' | 'devnet' | 'localnet';
    rpcUrl: string;
    packageId: string;
    moduleName: string;
  };
  walrus: {
    publisherUrl: string;
    aggregatorUrl: string;
  };
  indexer: {
    dbPath: string;
    pollIntervalMs: number;
  };
  server: {
    port: number;
    corsOrigins: string[];
  };
}

const env = (process.env.NODE_ENV || 'development') as AppEnvironment;
const suiNetwork = (process.env.NETWORK || 'testnet') as 'testnet' | 'devnet' | 'localnet';

// Strict Safety Guard: Block accidental mainnet deployment/execution
if ((process.env.NETWORK as string) === 'mainnet') {
  throw new Error('[CRITICAL SAFETY GUARD] ReliefChain is configured for Testnet only. Mainnet configuration is explicitly blocked during development phase.');
}

export const config: AppConfig = {
  env,
  sui: {
    network: suiNetwork,
    rpcUrl: process.env.SUI_RPC_URL || 'https://fullnode.testnet.sui.io:443',
    packageId: process.env.RELIEFCHAIN_PACKAGE_ID || '0x0000000000000000000000000000000000000000000000000000000000000000',
    moduleName: 'relief_chain'
  },
  walrus: {
    publisherUrl: process.env.WALRUS_PUBLISHER || 'https://publisher.walrus-testnet.walrus.space',
    aggregatorUrl: process.env.WALRUS_AGGREGATOR || 'https://aggregator.walrus-testnet.walrus.space'
  },
  indexer: {
    dbPath: process.env.INDEXER_DB_PATH || 'indexer_db.json',
    pollIntervalMs: Number(process.env.INDEXER_POLL_INTERVAL_MS || 5000)
  },
  server: {
    port: Number(process.env.PORT || 3000),
    corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000').split(',')
  }
};

export default config;
