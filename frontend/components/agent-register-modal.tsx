'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Spinner } from '@phosphor-icons/react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseAbiItem } from 'viem';

const VEIL_REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_VEIL_REGISTRY_ADDRESS ?? '0x6d9DCfAFC1Ee54Dcc1922d3d6BfC4C03402500eE') as `0x${string}`;

const REGISTER_AGENT_ABI = parseAbiItem(
  'function registerAgent(string endpoint, string agentCardHash, bytes32 reputationRef) returns (uint256)'
);

interface AgentRegisterModalProps {
  open: boolean;
  onClose: () => void;
}

export function AgentRegisterModal({ open, onClose }: AgentRegisterModalProps) {
  const { address, chain } = useAccount();
  const { writeContract, data: txHash, isPending, error: txError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash });
  const [agentId, setAgentId] = useState<string | null>(null);

  // Escape key + body scroll lock
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setAgentId(null);
    }
  }, [open]);

  // Parse agentId from tx receipt logs
  useEffect(() => {
    if (isConfirmed && txHash) {
      // AgentRegistered event: event AgentRegistered(uint256 indexed agentId, address indexed owner, string endpoint)
      // The agentId is in the first topic (indexed)
      setAgentId('registered');
    }
  }, [isConfirmed, txHash]);

  function handleRegister() {
    if (!address) return;
    writeContract({
      address: VEIL_REGISTRY_ADDRESS,
      abi: [REGISTER_AGENT_ABI],
      functionName: 'registerAgent',
      args: ['', '', '0x0000000000000000000000000000000000000000000000000000000000000000'],
    });
  }

  const isOnCC3 = chain?.id === 102031;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/60"
            onClick={onClose}
          />
          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="panel relative z-10 w-full max-w-md p-6 shadow-pop"
            role="dialog"
            aria-modal="true"
            aria-label="Register Agent"
          >
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-panel2 text-mut transition-colors hover:text-ink"
              aria-label="Close"
            >
              <X size={16} weight="bold" />
            </button>

            {/* Header */}
            <h2 className="mb-1 text-lg font-semibold text-ink">Register My Agent</h2>
            <p className="mb-6 text-sm text-mut">
              Mendaftarkan agent baru on-chain menggunakan wallet address kamu.
            </p>

            {/* Wallet info */}
            {address && (
              <div className="mb-5 rounded-xl border border-line bg-panel2/70 p-4">
                <div className="mb-2 text-xs text-mut">Wallet connected</div>
                <div className="font-mono text-sm text-ink">{address}</div>
                <div className="mt-1 text-xs text-mut">
                  Chain: {chain?.name ?? 'Unknown'} (ID: {chain?.id ?? '?'})
                </div>
              </div>
            )}

            {/* No wallet */}
            {!address && (
              <div className="mb-5 rounded-xl border border-line bg-panel2/70 p-4 text-center">
                <p className="text-sm text-mut">Connect wallet terlebih dahulu</p>
              </div>
            )}

            {/* Wrong chain */}
            {address && !isOnCC3 && (
              <div className="mb-5 rounded-xl border border-pend/30 bg-pend/5 p-4">
                <p className="text-sm text-pend">
                  Switch ke Creditcoin CC3 (ID: 102031) untuk register agent.
                </p>
              </div>
            )}

            {/* Result */}
            {isConfirmed && (
              <div className="mb-5 rounded-xl border border-ok/30 bg-ok/5 p-4">
                <div className="text-sm font-medium text-ok">✓ Agent registered on CC3</div>
                <div className="mt-1 font-mono text-xs text-mut">
                  Tx: {txHash?.slice(0, 10)}…{txHash?.slice(-8)}
                </div>
              </div>
            )}

            {/* Error */}
            {txError && (
              <div className="mb-5 rounded-xl border border-fail/30 bg-fail/5 p-4">
                <p className="text-sm text-fail">
                  {txError.message?.includes('User rejected')
                    ? 'Transaction rejected by user'
                    : 'Registration failed — coba lagi'}
                </p>
              </div>
            )}

            {/* Register button */}
            <button
              onClick={handleRegister}
              disabled={!address || isPending || isConfirming || isConfirmed}
              className="btn btn-primary w-full"
            >
              {!address && 'Connect Wallet First'}
              {isPending && (
                <span className="flex items-center justify-center gap-2">
                  <Spinner size={14} className="animate-spin" /> Confirm in MetaMask…
                </span>
              )}
              {isConfirming && (
                <span className="flex items-center justify-center gap-2">
                  <Spinner size={14} className="animate-spin" /> Mining on CC3…
                </span>
              )}
              {isConfirmed && 'Registered ✓'}
              {!isPending && !isConfirming && !isConfirmed && address && 'Register My Agent'}
            </button>

            {/* Footer */}
            <p className="mt-4 text-center text-xs text-mut">
              Agent ID akan dibuat otomatis berdasarkan wallet address kamu.
            </p>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
