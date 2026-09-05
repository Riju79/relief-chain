import axios from 'axios';
import config from './appConfig.js';

export interface WalrusUploadResult {
  blobId: string;
  publisherUrl: string;
  durationMs: number;
}

export interface WalrusFetchResult {
  data: Buffer;
  contentType: string;
  aggregatorUrl: string;
  durationMs: number;
}

export class FailoverWalrusClient {
  private publishers: string[];
  private aggregators: string[];
  private currentPublisherIndex: number = 0;
  private currentAggregatorIndex: number = 0;

  constructor(publisherUrls?: string[], aggregatorUrls?: string[]) {
    this.publishers = publisherUrls && publisherUrls.length > 0 ? publisherUrls : config.walrus.publisherUrls;
    this.aggregators = aggregatorUrls && aggregatorUrls.length > 0 ? aggregatorUrls : config.walrus.aggregatorUrls;

    console.log(`[Walrus Failover Client] Configured with ${this.publishers.length} publishers, ${this.aggregators.length} aggregators`);
    this.publishers.forEach((p, i) => console.log(`  Publisher [${i}]: ${p}`));
    this.aggregators.forEach((a, i) => console.log(`  Aggregator [${i}]: ${a}`));
  }

  public getPublishers(): string[] {
    return [...this.publishers];
  }

  public getAggregators(): string[] {
    return [...this.aggregators];
  }

  /**
   * Upload binary data to Walrus with publisher failover
   */
  public async uploadBlob(
    buffer: Buffer,
    mimeType: string = 'application/octet-stream',
    epochs: number = 5
  ): Promise<WalrusUploadResult> {
    const totalPublishers = this.publishers.length;
    const errors: { url: string; error: string }[] = [];
    const startIndex = this.currentPublisherIndex;

    for (let attempt = 0; attempt < totalPublishers; attempt++) {
      const index = (startIndex + attempt) % totalPublishers;
      const url = this.publishers[index];
      const startTime = Date.now();

      try {
        console.log(`[WALRUS] Attempting upload to publisher [${index}]: ${url} (${buffer.length} bytes)...`);
        const response = await axios.put(`${url}/v1/blobs?epochs=${epochs}`, buffer, {
          headers: { 'Content-Type': mimeType },
          timeout: 10000
        });

        const durationMs = Date.now() - startTime;
        let blobId: string | null = null;

        if (response.data?.newlyCreated?.blobObject?.blobId) {
          blobId = response.data.newlyCreated.blobObject.blobId;
        } else if (response.data?.alreadyCertified?.blobId) {
          blobId = response.data.alreadyCertified.blobId;
        }

        if (!blobId) {
          throw new Error(`Unrecognized response payload structure: ${JSON.stringify(response.data)}`);
        }

        if (attempt > 0) {
          console.warn(
            `[WALRUS FAILOVER RESOLVED] Blob upload succeeded on backup publisher: ${url} (took ${durationMs}ms, attempt ${attempt + 1}/${totalPublishers})`
          );
          this.currentPublisherIndex = index;
        } else {
          console.log(`[WALRUS SUCCESS] Blob stored on ${url} in ${durationMs}ms. ID: ${blobId}`);
        }

        return { blobId, publisherUrl: url, durationMs };
      } catch (err: any) {
        const durationMs = Date.now() - startTime;
        const msg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        console.warn(
          `[WALRUS FAILOVER WARNING] Publisher [${index}] ${url} failed (${durationMs}ms): ${msg}. Trying next publisher...`
        );
        errors.push({ url, error: msg });
      }
    }

    const aggregatedErrorMessage = errors.map(e => `[${e.url}]: ${e.error}`).join(' | ');
    throw new Error(`[WALRUS CRITICAL] All ${totalPublishers} publishers failed: ${aggregatedErrorMessage}`);
  }

  /**
   * Fetch binary blob from Walrus with aggregator failover
   */
  public async fetchBlob(blobId: string): Promise<WalrusFetchResult> {
    const totalAggregators = this.aggregators.length;
    const errors: { url: string; error: string }[] = [];
    const startIndex = this.currentAggregatorIndex;

    for (let attempt = 0; attempt < totalAggregators; attempt++) {
      const index = (startIndex + attempt) % totalAggregators;
      const url = this.aggregators[index];
      const startTime = Date.now();

      try {
        const fetchUrl = `${url}/v1/blobs/${blobId}`;
        const response = await axios.get(fetchUrl, {
          responseType: 'arraybuffer',
          timeout: 10000
        });

        const durationMs = Date.now() - startTime;
        const contentType = String(response.headers['content-type'] || 'application/octet-stream');
        const buffer = Buffer.from(response.data);

        if (attempt > 0) {
          console.warn(
            `[WALRUS AGGREGATOR FAILOVER RESOLVED] Read succeeded on backup aggregator: ${url} (took ${durationMs}ms)`
          );
          this.currentAggregatorIndex = index;
        }

        return {
          data: buffer,
          contentType,
          aggregatorUrl: url,
          durationMs
        };
      } catch (err: any) {
        const durationMs = Date.now() - startTime;
        console.warn(`[WALRUS AGGREGATOR FAILOVER WARNING] Aggregator ${url} failed (${durationMs}ms): ${err.message}`);
        errors.push({ url, error: err.message });
      }
    }

    const aggregatedErrorMessage = errors.map(e => `[${e.url}]: ${e.error}`).join(' | ');
    throw new Error(`[WALRUS CRITICAL] All ${totalAggregators} aggregators failed for blob "${blobId}": ${aggregatedErrorMessage}`);
  }
}

export const walrusClient = new FailoverWalrusClient();
export default walrusClient;
