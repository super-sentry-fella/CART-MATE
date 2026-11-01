import React, { useState, useEffect } from 'react';
import { ShieldCheck, Lock, X, Check, AlertCircle, KeyRound } from 'lucide-react';
import { soundEffects } from '../services/audio';

interface EmployeeAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const EmployeeAuthModal: React.FC<EmployeeAuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const [pin, setPin] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setPin('');
      setErrorMsg(null);
      setIsSuccess(false);
    }
  }, [isOpen]);

  // Handle keyboard typing
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, pin]);

  const handleDigit = (digit: string) => {
    if (pin.length >= 4) return;
    const nextPin = pin + digit;
    setPin(nextPin);
    setErrorMsg(null);
    soundEffects.beep();

    if (nextPin.length === 4) {
      validatePin(nextPin);
    }
  };

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
    setErrorMsg(null);
  };

  const handleClear = () => {
    setPin('');
    setErrorMsg(null);
  };

  const validatePin = (code: string) => {
    if (code === '1234') {
      setIsSuccess(true);
      soundEffects.complete();
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 400);
    } else {
      soundEffects.error();
      setErrorMsg('Incorrect passcode. Use 1234 for employee access.');
      setTimeout(() => {
        setPin('');
      }, 600);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-850 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold">Staff / Employee Access</h3>
              <p className="text-[11px] text-slate-400">Enter code to unlock menus</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col items-center space-y-5">
          <div className="text-center space-y-1">
            <div className="w-12 h-12 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mx-auto text-emerald-400 mb-2 shadow-inner">
              <Lock className="w-6 h-6" />
            </div>
            <h4 className="text-base font-bold text-white">Enter 4-Digit Passcode</h4>
            <p className="text-xs text-slate-400">
              Default employee unlock code is <strong className="text-emerald-400 font-mono">1234</strong>
            </p>
          </div>

          {/* 4-Dot PIN Indicator */}
          <div className="flex items-center justify-center gap-4 py-2">
            {[0, 1, 2, 3].map((idx) => {
              const isFilled = pin.length > idx;
              return (
                <div
                  key={idx}
                  className={`w-4 h-4 rounded-full transition-all duration-200 ${
                    isSuccess
                      ? 'bg-emerald-400 scale-110 shadow-lg shadow-emerald-400/50'
                      : isFilled
                      ? 'bg-emerald-500 scale-105 shadow-md shadow-emerald-500/30'
                      : 'bg-slate-800 border border-slate-600'
                  }`}
                />
              );
            })}
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div className="text-xs text-rose-400 flex items-center gap-1.5 bg-rose-950/40 border border-rose-800/60 px-3 py-1.5 rounded-lg animate-in shake">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Interactive Numeric Keypad */}
          <div className="w-full max-w-[260px] grid grid-cols-3 gap-2.5">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  if (k === 'C') handleClear();
                  else if (k === '⌫') handleBackspace();
                  else handleDigit(k);
                }}
                className={`py-3.5 rounded-xl font-mono text-lg font-bold transition-all active:scale-95 cursor-pointer select-none ${
                  k === 'C'
                    ? 'bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-white text-sm'
                    : k === '⌫'
                    ? 'bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-white text-sm'
                    : 'bg-slate-800 text-white hover:bg-slate-700 shadow-sm border border-slate-700/60'
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>

        {/* Footer info */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-850 flex items-center justify-between text-xs text-slate-400">
          <span>Protected Area</span>
          <span className="font-mono text-emerald-400 font-semibold">PIN: 1234</span>
        </div>
      </div>
    </div>
  );
};
