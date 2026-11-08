import React, { useState } from 'react';
import { Lock, KeyRound } from 'lucide-react';

interface LockScreenProps {
  onUnlock: () => void;
  appPassword: string;
}

export const LockScreen: React.FC<LockScreenProps> = ({ onUnlock, appPassword }) => {
  const [pass, setPass] = useState('');
  const [error, setError] = useState(false);

  const handleUnlock = () => {
    if (pass.trim() === appPassword || pass.trim().toLowerCase() === appPassword.toLowerCase()) {
      try {
        sessionStorage.setItem('plutus_unlocked', 'true');
      } catch (e) {}
      onUnlock();
    } else {
      setError(true);
      setTimeout(() => setError(false), 2200);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 p-8 rounded-xl shadow-2xl max-w-sm w-full text-center text-white">
        <div className="inline-flex p-3 rounded-full bg-blue-600/20 text-blue-400 mb-4">
          <Lock className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold tracking-wide">PLUTUS Production Locked</h2>
        <p className="text-xs text-slate-400 mt-2">
          Enter authorized password to access production records and requisition data
        </p>

        <div className="my-6">
          <div className="relative">
            <input
              type="password"
              placeholder="Enter Password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
              autoFocus
              className="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-lg text-center font-bold text-white text-base focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
            <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          </div>

          {error && (
            <p className="text-red-400 text-xs mt-2 font-medium animate-pulse">
              Incorrect password. Please try again.
            </p>
          )}
        </div>

        <button
          onClick={handleUnlock}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] transition-all rounded-lg font-bold text-sm shadow-md"
        >
          Unlock System
        </button>

        <p className="text-[11px] text-slate-500 mt-4">
          Default Password: <code className="bg-slate-900 px-1 py-0.5 rounded text-slate-300">Password</code>
        </p>
      </div>
    </div>
  );
};
