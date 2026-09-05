import dotenv from 'dotenv';

dotenv.config();

export type AppEnvironment = 'development' | 'testnet' | 'production';

export interface AppConfig {
  env: AppEnvironment;
  sui: {
    network: 'testnet' | 'devnet' | 'localnet';
    rpcUrl: string;
    rpcUrls: string[];
    packageId: string;
    moduleName: string;
    adminCapId: string;
    verifierCapId: string;
  };
  walrus: {
    publisherUrl: string;
    publisherUrls: string[];
    aggregatorUrl: string;
    aggregatorUrls: string[];
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

// Strict Startup Guard: RELIEFCHAIN_PACKAGE_ID with verified Testnet fallback
const DEFAULT_TESTNET_PACKAGE_ID = '0x9c0e1fe411f3f1bc9b877710d000ef4ca3113e3461cdffed469be1f1bd7b5bfe';
const packageId = process.env.RELIEFCHAIN_PACKAGE_ID || DEFAULT_TESTNET_PACKAGE_ID;

const defaultSuiRpcUrls = [
  'https://sui-testnet-endpoint.blockvision.org',
  'https://testnet.sui.rpcpool.com',
  process.env.SUI_RPC_URL || 'https://fullnode.testnet.sui.io:443'
].filter(Boolean);

const suiRpcUrls = process.env.SUI_RPC_URLS
  ? process.env.SUI_RPC_URLS.split(',').map(u => u.trim()).filter(Boolean)
  : defaultSuiRpcUrls;

const defaultWalrusPublishers = [
  process.env.WALRUS_PUBLISHER || 'https://publisher.walrus-testnet.walrus.space',
  'https://walrus-testnet-publisher.nodes.guru',
  'https://walrus-testnet.blockscope.net:11444'
].filter(Boolean);

const walrusPublishers = process.env.WALRUS_PUBLISHERS
  ? process.env.WALRUS_PUBLISHERS.split(',').map(u => u.trim()).filter(Boolean)
  : defaultWalrusPublishers;

const defaultWalrusAggregators = [
  process.env.WALRUS_AGGREGATOR || 'https://aggregator.walrus-testnet.walrus.space',
  'https://walrus-testnet-aggregator.nodes.guru',
  'https://walrus-testnet.blockscope.net:11445'
].filter(Boolean);

const walrusAggregators = process.env.WALRUS_AGGREGATORS
  ? process.env.WALRUS_AGGREGATORS.split(',').map(u => u.trim()).filter(Boolean)
  : defaultWalrusAggregators;

export const config: AppConfig = {
  env,
  sui: {
    network: suiNetwork,
    rpcUrl: suiRpcUrls[0] || 'https://fullnode.testnet.sui.io:443',
    rpcUrls: suiRpcUrls,
    packageId,
    moduleName: 'relief_chain',
    adminCapId: process.env.ADMIN_CAP_OBJECT_ID || '0x21e2ca751c1157689c086dd223487841fe4ef53b5e95ac0c935f009261c5191f',
    verifierCapId: process.env.VERIFIER_CAP_OBJECT_ID || '0xf5d8fbb6bb38c2b5be734f2fd8e4ac5797e033b9f073448267f5adb953e1921c',
  },
  walrus: {
    publisherUrl: walrusPublishers[0] || 'https://publisher.walrus-testnet.walrus.space',
    publisherUrls: walrusPublishers,
    aggregatorUrl: walrusAggregators[0] || 'https://aggregator.walrus-testnet.walrus.space',
    aggregatorUrls: walrusAggregators
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
