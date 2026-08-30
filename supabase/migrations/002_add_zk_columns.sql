-- Add ZK proof columns to vault_transactions
-- Run this in the Supabase SQL editor: https://supabase.com/dashboard/project/atuzizqqozeutpasuwmy/sql/new

ALTER TABLE vault_transactions
  ADD COLUMN IF NOT EXISTS zk_proof_hash TEXT,
  ADD COLUMN IF NOT EXISTS zk_receipt_status TEXT;
