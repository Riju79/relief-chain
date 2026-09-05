# ReliefChain Load Testing & Capacity Benchmark Report

**Date of Execution:** 2026-09-05  
**Target Environment:** Local Node.js / Express 4.19 / PGLite / SuiEventIndexer  
**Test Harness:** `scripts/loadTestBackendAndIndexer.ts` (Concurrent worker pool)  
**System Profile:** Apple Silicon (macOS) / Node v20+

---

## Executive Summary

During major disaster events, relief protocols experience severe asymmetric traffic spikes:
1. **Donor Discovery & Feed Reads:** Thousands of concurrent web visitors checking fund balances, photos, and live campaign goals.
2. **On-Chain Donation Ingestion:** Bursts of Sui blockchain transaction events arriving via WebSockets/RPC polling.
3. **Evidence Integrity Verification:** Real-time SHA-256 cryptographic hash checks executed before donors trust Walrus image blobs.

This benchmark establishes the quantitative throughput limits, latency distributions, and saturation ceilings for ReliefChain's backend and local indexer service.

---

## 1. Backend HTTP Throughput & Latency Distributions

### Scenario A: Donor Feed Read Spike (`GET /api/campaigns`)
- **Simulated Condition:** Disaster announcement burst; 1,500 requests at 30 concurrent connections.
- **Total Requests:** 1500
- **Duration:** 0.49 seconds
- **Throughput:** **3042.6 req/sec**
- **Error Rate:** 0.00% (0 failed requests)
- **Latency Distribution:**
  - **Min:** 5.26 ms
  - **p50 (Median):** **8.37 ms**
  - **p90:** 13.48 ms
  - **p95:** **16.69 ms**
  - **p99:** **25.57 ms**
  - **Max:** 100.94 ms

### Scenario B: Public Audit Log Transparency (`GET /api/audit-logs`)
- **Simulated Condition:** Multiple transparency watchers & NGO dashboards scraping governance actions; 800 requests at 20 concurrent connections.
- **Total Requests:** 800
- **Duration:** 0.32 seconds
- **Throughput:** **2500 req/sec**
- **Error Rate:** 0.00%
- **Latency Distribution:**
  - **p50 (Median):** **6.73 ms**
  - **p95:** **14.32 ms**
  - **p99:** **21.14 ms**

### Scenario C: Evidence Hash Re-Verification API (`POST /api/evidence/verify-integrity`)
- **Simulated Condition:** Real-time SHA-256 integrity checks against cached metadata; 500 requests at 15 concurrent connections.
- **Total Requests:** 500
- **Duration:** 0.06 seconds
- **Throughput:** **8196.72 req/sec**
- **Error Rate:** 0.00%
- **Latency Distribution:**
  - **p50 (Median):** **1.40 ms**
  - **p95:** **4.12 ms**
  - **p99:** **4.54 ms**

---

## 2. Sui Event Indexer & Deduplication Performance

The local Sui Event Indexer (`src/indexer/eventIndexer.ts`) processes streaming on-chain events (`DonationReceived`, `MilestoneCreated`, `MilestoneApproved`, `FundsReleased`).

| Metric | Result | Operational Significance |
|---|---|---|
| **Event Stream Batch Size** | **3,000 events** | Realistic multi-hour disaster surge |
| **Ingestion Time** | **2086.78 ms** | Real-time stream processing |
| **Ingestion Throughput** | **1,437.62 events/sec** | Well exceeds Sui peak block event generation |
| **Duplicate Events Injected** | **500 duplicates** | Simulating RPC reconnections & re-scans |
| **Deduplication Rate** | **654,058.17 checks/sec** | O(1) hash set deduplication efficiency |
| **State Disk Serialization** | **1.56 ms** | Low I/O overhead on NVMe/SSD |
| **Projected State Size** | **559.7 KB** | Compact disk footprint per 3k events |

---

## 3. Production Bottlenecks & Capacity Limits

1. **Memory Growth in Long-Running Indexer:**
   - The current in-memory `Set<string>` for `processedEventIds` retains all historical event IDs.
   - *Capacity Limit:* At ~1,000,000 events, memory footprint is ~65 MB. Beyond 50,000,000 events, migration to an on-disk Bloom filter or partitioned PostgreSQL index table (`sui_processed_events`) is recommended.
2. **Rate Limiting Boundaries:**
   - Nonce issuance (`/api/auth/nonce`) is capped at 30 requests / 15 min per IP.
   - File uploads (`/api/upload`) are capped at 20 requests / 15 min per IP.
   - These limits protect the server against Sybil flooding during viral social media donation drives.
3. **Database Write Concurrency:**
   - With PostgreSQL / PGLite ACID transactions in place for auth nonces and audit logs, the backend eliminates race conditions found in plain JSON storage.
   - Under heavy concurrent write spikes (>500 writes/sec), connection pool sizing should be scaled from default 10 to 50 connections.

---

## 4. Operational Recommendations for Mainnet Launch

1. **CDN Edge Caching:**
   - Deploy Cloudflare or Fastly caching in front of `GET /api/campaigns` with `Cache-Control: public, s-maxage=3, stale-while-revalidate=5`. This will offload 99% of read spikes directly to edge points of presence.
2. **Multi-Node Fullnode RPC Failover:**
   - Keep minimum 3 independent Sui fullnode RPC providers configured in `rpcFailover.js` to guarantee that indexer ingestion is not halted by public RPC rate limits or intermittent node maintenance.
3. **Horizontal Indexer Separation:**
   - Separate the event ingestion daemon into its own background worker container, isolated from the public HTTP API container, preventing indexer CPU spikes from impacting web client latency.
