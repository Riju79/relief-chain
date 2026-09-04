import suiClient from './config/suiClient.js';
import { checkSuiConnection } from './utils/healthCheck.js';

// Export suiClient singleton
export { suiClient };

// Export all service layer functions and interfaces
export * from './services/blockchainService.js';

// Export health check utilities
export * from './utils/healthCheck.js';

// Automatically execute connection health check on startup
checkSuiConnection().catch((error) => {
  console.error('ReliefChain Backend Startup Connection Warning:', error.message);
});
