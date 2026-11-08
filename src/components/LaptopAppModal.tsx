import React, { useState } from 'react';
import {
  Download,
  Laptop,
  FileText,
  Terminal,
  X,
  Globe,
  Copy,
  ExternalLink,
  Check,
  Cloud,
  Smartphone,
  Share2,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import {
  getAttachedLiveUrl,
  downloadGoogleDriveDocLauncher,
  downloadInternetShortcutUrl,
} from '../utils/generateStandaloneLaptopApp';

interface LaptopAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDownloadStandaloneApp: () => void;
  onDownloadAndroidApp?: () => void;
  onDownloadWindowsLauncher: () => void;
  onDownloadFormattedTables: () => void;
  isOnline?: boolean;
  swReady?: boolean;
  pendingOfflineSync?: {
    hasPending: boolean;
    editCount: number;
    queuedAt: string | null;
  };
  onTriggerImmediateSync?: () => void;
}

export const LaptopAppModal: React.FC<LaptopAppModalProps> = ({
  isOpen,
  onClose,
  onDownloadStandaloneApp,
  onDownloadAndroidApp,
  onDownloadWindowsLauncher,
  onDownloadFormattedTables,
  isOnline = true,
  swReady = false,
  pendingOfflineSync,
  onTriggerImmediateSync,
}) => {
  void isOnline;
  void swReady;
  void pendingOfflineSync;
  void onTriggerImmediateSync;
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [showMobileSteps, setShowMobileSteps] = useState(false);
  const liveUrl = getAttachedLiveUrl();

  if (!isOpen) return null;

  const handleCopyUrl = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(liveUrl);
      } else {
        const ta = document.createElement('textarea');
        ta.value = liveUrl;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2500);
    } catch (e) {
      console.warn('Copy failed', e);
    }
  };

  const whatsappShareHref = `https://wa.me/?text=${encodeURIComponent(
    `⚡ *PLUTUS Cable Production & Requisition Android App*\n\nTap the link below on your Android phone in Chrome, then tap "Install App" (or Menu ⋮ -> Add to Home Screen) to install on your phone:\n${liveUrl}`
  )}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs no-print">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-600 rounded-lg flex items-center gap-1">
              <Smartphone className="w-5 h-5 text-white" />
              <Laptop className="w-4 h-4 text-emerald-200" />
            </div>
            <div>
              <h2 className="text-base font-extrabold tracking-wide">
                Download &amp; Install PLUTUS App on Android Phone, Tablet or Laptop
              </h2>
              <p className="text-xs text-slate-300 mt-0.5">
                Install as a Native Android App (PWA) or Download Standalone Offline File • Real-Time Cloud Sync
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 max-h-[82vh] overflow-y-auto">
          {/* TOP PRIORITY: ANDROID MOBILE APP DOWNLOAD & INSTALL */}
          <div className="border-2 border-emerald-600 bg-gradient-to-br from-emerald-50 via-teal-50/70 to-white rounded-xl p-4 space-y-3 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 bg-emerald-700 text-white text-[10px] font-black uppercase rounded-md flex items-center gap-1 shadow-xs">
                  <Smartphone className="w-3.5 h-3.5" /> Android Mobile App
                </span>
                <span className="text-xs font-extrabold text-emerald-950">
                  Download &amp; Install Directly on Your Android Phone / Tablet
                </span>
              </div>
              {isInstalled && (
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded text-[10px] font-extrabold">
                  ✅ Installed on Device
                </span>
              )}
            </div>

            <p className="text-xs text-slate-700 leading-relaxed">
              Get the full <strong>PLUTUS Cable Production System</strong> on your Android device with all 14 tabs, Daily Production Journal, Container Planning, Process Cards, and Live Stock Management:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Button A: Direct Download Android App File */}
              <button
                type="button"
                onClick={() => {
                  if (onDownloadAndroidApp) {
                    onDownloadAndroidApp();
                  } else {
                    onDownloadStandaloneApp();
                  }
                }}
                className="p-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-extrabold text-xs flex items-center justify-center gap-2 shadow-md transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4 shrink-0" />
                <div className="text-left">
                  <div>📥 Download Android App File</div>
                  <div className="text-[10px] text-emerald-100 font-normal">
                    Saves PLUTUS_ANDROID_MOBILE_APP.html to Device
                  </div>
                </div>
              </button>

              {/* Button B: 1-Tap Native PWA Install on Android / Chrome */}
              {isInstallable && !isInstalled ? (
                <button
                  type="button"
                  onClick={install}
                  className="p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-extrabold text-xs flex items-center justify-center gap-2 shadow-md transition-colors cursor-pointer"
                >
                  <Smartphone className="w-4 h-4 shrink-0" />
                  <div className="text-left">
                    <div>📲 1-Tap Install to Home Screen</div>
                    <div className="text-[10px] text-blue-100 font-normal">
                      Adds PLUTUS App Icon to Android App Drawer
                    </div>
                  </div>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowMobileSteps(prev => !prev)}
                  className="p-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-extrabold text-xs flex items-center justify-center gap-2 shadow-md transition-colors cursor-pointer"
                >
                  <Smartphone className="w-4 h-4 shrink-0 text-emerald-400" />
                  <div className="text-left">
                    <div>📲 Add App Icon to Android Phone</div>
                    <div className="text-[10px] text-slate-300 font-normal">
                      {isIOS ? 'Tap for iPhone / iPad steps' : 'Tap for 2-step Android Home Screen guide'}
                    </div>
                  </div>
                </button>
              )}
            </div>

            {/* Share to Phone via WhatsApp / Copy Link */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-emerald-200/80">
              <span className="text-[11px] font-bold text-emerald-950">
                Using a laptop right now? Send the Android App to your phone:
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={whatsappShareHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-extrabold flex items-center gap-1.5 shadow-2xs"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Send to Phone via WhatsApp</span>
                </a>
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="px-3 py-1.5 bg-white hover:bg-emerald-50 text-emerald-900 border border-emerald-300 rounded-lg text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedUrl ? 'Link Copied!' : 'Copy Android Link'}</span>
                </button>
              </div>
            </div>

            {/* Step-by-step Android & iOS Install Guide */}
            {showMobileSteps && (
              <div className="bg-white border border-emerald-300 rounded-xl p-3 text-xs text-slate-700 space-y-1.5">
                <div className="font-black text-emerald-950 uppercase text-[11px]">
                  📲 How to Install on Your Android Phone Home Screen:
                </div>
                <ol className="list-decimal list-inside space-y-1 text-slate-700 font-medium">
                  <li>
                    Open <strong className="text-indigo-700 select-all">{liveUrl}</strong> in <strong>Google Chrome</strong> on your Android phone (or open the downloaded <code className="bg-slate-100 px-1 rounded">PLUTUS_ANDROID_MOBILE_APP.html</code> file).
                  </li>
                  <li>
                    Tap the <strong>3-dot menu (⋮)</strong> at the top-right corner of Chrome on your phone.
                  </li>
                  <li>
                    Tap <strong>&quot;Install app&quot;</strong> or <strong>&quot;Add to Home screen&quot;</strong> — the <strong>PLUTUS App</strong> icon is added to your Android phone just like a native app!
                  </li>
                </ol>
              </div>
            )}
          </div>

          {/* Attached Live Cloud Web App URL */}
          <div className="border-2 border-indigo-500 bg-indigo-50/70 rounded-xl p-4 space-y-2.5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-indigo-600 text-white text-[10px] font-extrabold uppercase rounded flex items-center gap-1 shadow-xs">
                  <Globe className="w-3 h-3" /> Attached Live Cloud URL
                </span>
                <span className="text-xs font-bold text-indigo-950">
                  Real-Time Multi-Device Sync (Android + Laptop)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="px-3 py-1.5 bg-white hover:bg-slate-100 text-indigo-700 border border-indigo-300 rounded-lg text-xs font-extrabold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                  title="Copy the live web link to clipboard"
                >
                  {copiedUrl ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Copy Live Link</span>
                    </>
                  )}
                </button>
                <a
                  href={liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-extrabold flex items-center gap-1.5 shadow-xs transition-colors"
                  title="Open the live web app in a new tab"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Live App ↗</span>
                </a>
              </div>
            </div>

            <div className="bg-white border border-indigo-200 rounded-lg p-2.5 flex items-center justify-between gap-2 font-mono text-xs text-indigo-950 select-all overflow-x-auto shadow-inner">
              <span className="font-semibold break-all">{liveUrl}</span>
            </div>

            <p className="text-[11px] text-slate-600 leading-relaxed">
              Open this link on your Android phone, tablet, or laptop browser for instant real-time sync across all devices.
            </p>
          </div>

          {/* Google Drive Launcher Section */}
          <div className="border-2 border-amber-500 bg-amber-50/70 rounded-xl p-4 space-y-3 shadow-xs">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-amber-600 text-white text-[10px] font-extrabold uppercase rounded flex items-center gap-1">
                  <Cloud className="w-3 h-3" /> Google Drive Solution
                </span>
                <span className="text-xs font-extrabold text-amber-950">
                  Run Directly from Google Drive on Android or Laptop
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => downloadGoogleDriveDocLauncher(liveUrl)}
                className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold rounded-lg shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                <Cloud className="w-4 h-4" />
                Download Google Drive Click-to-Run File (.doc)
              </button>

              <button
                type="button"
                onClick={() => downloadInternetShortcutUrl(liveUrl)}
                className="px-3.5 py-2 bg-white hover:bg-amber-100 text-amber-900 border border-amber-400 text-xs font-extrabold rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5 text-amber-700" />
                Download Direct Web Shortcut (.url)
              </button>
            </div>
          </div>

          {/* Option 1: Standalone Single-File Laptop HTML App */}
          <div className="border border-emerald-400 bg-emerald-50/40 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-emerald-600 text-white text-[10px] font-extrabold uppercase rounded">
                  Laptop Offline &amp; Online Edition
                </span>
                <span className="text-xs font-bold text-emerald-900">
                  Password: <code className="bg-white px-1.5 py-0.5 rounded border border-emerald-300">Password</code>
                </span>
              </div>
              <h3 className="text-sm font-extrabold text-slate-900">
                Full Standalone Laptop Application (.html)
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Downloads <strong>PLUTUS_CABLE_PRODUCTION_LAPTOP_APP.html</strong> containing all 14 interactive tabs pre-loaded with your current data.
              </p>
            </div>
            <button
              type="button"
              onClick={onDownloadStandaloneApp}
              className="shrink-0 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold rounded-lg shadow-md flex items-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Download Laptop App (.html)
            </button>
          </div>

          {/* Option 2: Windows Desktop Shortcut Launcher (.bat) */}
          <div className="border border-blue-200 bg-blue-50/40 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-extrabold text-slate-900">
                1-Click Windows App Window Launcher (.bat)
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Opens PLUTUS in a clean desktop software window without browser address bars.
              </p>
            </div>
            <button
              type="button"
              onClick={onDownloadWindowsLauncher}
              className="shrink-0 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-xs flex items-center gap-2 cursor-pointer"
            >
              <Terminal className="w-4 h-4" />
              Download Windows Launcher (.bat)
            </button>
          </div>

          {/* Option 4: Formatted Printable Sheets Report */}
          <div className="border border-slate-200 bg-slate-50 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-slate-900">
                Formatted Production &amp; Drum/Pallet Tables Report (.html)
              </h3>
              <p className="text-xs text-slate-600">
                Downloads clean, read-only formatted tables configured to print <strong>1 table per page</strong>.
              </p>
            </div>
            <button
              type="button"
              onClick={onDownloadFormattedTables}
              className="shrink-0 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              Download Formatted Tables
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-3 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold rounded-lg cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
