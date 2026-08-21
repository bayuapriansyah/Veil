'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Spinner } from '@phosphor-icons/react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi';
import { parseAbiItem } from 'viem';
import { cc3 } from '../lib/wagmi-config';

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
  const { switchChainAsync } = useSwitchChain();
  const { writeContract, data: txHash, isPending, error: txError, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash });
  const [agentId, setAgentId] = useState<string | null>(null);
  const [step, setStep] = useState<'idle' | 'switching' | 'signing' | 'mining' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
      setStep('idle');
      setErrorMsg(null);
      reset();
    }
  }, [open]);

  // Track tx confirmation
  useEffect(() => {
    if (isConfirmed && txHash) {
      setStep('done');
      setAgentId('registered');
    }
  }, [isConfirmed, txHash]);

  // Track errors
  useEffect(() => {
    if (txError) {
      setStep('error');
      if (txError.message?.includes('User rejected') || txError.message?.includes('user rejected')) {
        setErrorMsg('Transaction rejected by user');
      } else if (txError.message?.includes('insufficient funds')) {
        setErrorMsg('Insufficient CTC for gas. Top up your wallet on CC3.');
      } else {
        setErrorMsg(`Registration failed: ${txError.message?.slice(0, 100)}`);
      }
    }
  }, [txError]);

  async function handleRegister() {
    if (!address) return;
    setErrorMsg(null);

    // Step 1: Switch to CC3 if not already on it
    if (chain?.id !== cc3.id) {
      setStep('switching');
      try {
        await switchChainAsync({ chainId: cc3.id });
      } catch (e: unknown) {
        setStep('error');
        setErrorMsg('Gagal switch ke CC3 chain. Pastikan MetaMask memiliki CC3 network.');
        return;
      }
    }

    // Step 2: Send tx
    setStep('signing');
    try {
      writeContract({
        address: VEIL_REGISTRY_ADDRESS,
        abi: [REGISTER_AGENT_ABI],
        functionName: 'registerAgent',
        args: ['', '', '0x0000000000000000000000000000000000000000000000000000000000000000'],
        chainId: cc3.id,
      });
      setStep('mining');
    } catch {
      setStep('error');
      setErrorMsg('Gagal mengirim transaksi');
    }
  }

  const isOnCC3 = chain?.id === cc3.id;

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
                <div className="mt-1 flex items-center gap-2 text-xs text-mut">
                  Chain:
                  <span className={isOnCC3 ? 'font-medium text-ok' : 'font-medium text-pend'}>
                    {chain?.name ?? 'Unknown'} (ID: {chain?.id ?? '?'})
                  </span>
                  {!isOnCC3 && (
                    <span className="rounded bg-pend/15 px-1.5 py-0.5 text-[10px] text-pend">
                      perlu switch
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* No wallet */}
            {!address && (
              <div className="mb-5 rounded-xl border border-line bg-panel2/70 p-4 text-center">
                <p className="text-sm text-mut">Connect wallet terlebih dahulu</p>
              </div>
            )}

            {/* Step indicators */}
            {step === 'switching' && (
              <div className="mb-5 rounded-xl border border-pend/30 bg-pend/5 p-4">
                <div className="flex items-center gap-2 text-sm text-pend">
                  <Spinner size={14} className="animate-spin" />
                  Switching ke Creditcoin CC3…
                </div>
              </div>
            )}

            {step === 'signing' && (
              <div className="mb-5 rounded-xl border border-pend/30 bg-pend/5 p-4">
                <div className="flex items-center gap-2 text-sm text-pend">
                  <Spinner size={14} className="animate-spin" />
                  Confirm di MetaMask…
                </div>
              </div>
            )}

            {step === 'mining' && (
              <div className="mb-5 rounded-xl border border-pend/30 bg-pend/5 p-4">
                <div className="flex items-center gap-2 text-sm text-pend">
                  <Spinner size={14} className="animate-spin" />
                  Mining on CC3…
                </div>
                {txHash && (
                  <div className="mt-2 font-mono text-[10px] text-mut">
                    Tx: {txHash.slice(0, 10)}…{txHash.slice(-8)}
                  </div>
                )}
              </div>
            )}

            {/* Success */}
            {step === 'done' && (
              <div className="mb-5 rounded-xl border border-ok/30 bg-ok/5 p-4">
                <div className="text-sm font-medium text-ok">✓ Agent registered on CC3</div>
                {txHash && (
                  <div className="mt-1 font-mono text-xs text-mut">
                    Tx: {txHash.slice(0, 10)}…{txHash.slice(-8)}
                  </div>
                )}
              </div>
            )}

            {/* Error */}
            {step === 'error' && errorMsg && (
              <div className="mb-5 rounded-xl border border-fail/30 bg-fail/5 p-4">
                <p className="text-sm text-fail">{errorMsg}</p>
              </div>
            )}

            {/* Register button */}
            <button
              onClick={handleRegister}
              disabled={!address || step === 'switching' || step === 'signing' || step === 'mining' || step === 'done'}
              className="btn btn-primary w-full"
            >
              {!address && 'Connect Wallet First'}
              {step === 'idle' && address && 'Register My Agent'}
              {step === 'switching' && 'Switching Chain…'}
              {step === 'signing' && 'Confirm in MetaMask…'}
              {step === 'mining' && 'Mining on CC3…'}
              {step === 'done' && 'Registered ✓'}
              {step === 'error' && 'Try Again'}
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
