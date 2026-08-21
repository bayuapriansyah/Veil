/**
 * Attestation replay — retries failed source-chain recordings from the error
 * queue. Run periodically (e.g. cron) or on-demand to recover from transient
 * RPC failures.
 *
 * Usage: npx tsx services/attestation/replay.ts
 */
import 'dotenv/config';
import { readErrors, clearErrors, recordAgentPayment, recordFulfillment, FailedRecord } from './record';

async function replayOne(record: FailedRecord): Promise<{ ok: boolean; error?: string }> {
  const opts = record.opts;
  if (record.type === 'payment') {
    return recordAgentPayment({
      orderId: BigInt(opts.orderId),
      provider: opts.provider,
      amount: BigInt(opts.amount),
      serviceId: opts.serviceId,
      transactionRef: opts.transactionRef,
    });
  }
  if (record.type === 'fulfillment') {
    return recordFulfillment({
      orderId: BigInt(opts.orderId),
      resultHash: opts.resultHash,
      serviceId: opts.serviceId,
      transactionRef: opts.transactionRef,
    });
  }
  return { ok: false, error: `unknown type: ${record.type}` };
}

async function main(): Promise<void> {
  const errors = readErrors();
  if (errors.length === 0) {
    console.log('No failed attestations to replay.');
    return;
  }

  console.log(`Replaying ${errors.length} failed attestation(s)...`);
  let succeeded = 0;
  let failed = 0;

  for (const record of errors) {
    const result = await replayOne(record);
    if (result.ok) {
      console.log(`  OK: ${record.type} order=${record.orderId}`);
      succeeded++;
    } else {
      console.log(`  FAIL: ${record.type} order=${record.orderId} — ${result.error}`);
      failed++;
    }
  }

  // Clear the queue (successful ones are done; failed ones would need fresh entries)
  if (succeeded > 0) {
    clearErrors();
    console.log(`Cleared ${succeeded} successfully replayed entry/entries.`);
  }

  console.log(`Done: ${succeeded} succeeded, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Replay failed:', e);
    process.exit(1);
  });
}
