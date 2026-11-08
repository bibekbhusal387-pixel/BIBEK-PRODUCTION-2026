import {
  BatchHistoryEntry,
  CableOrder,
  ColourMapRule,
  ContainerPlan,
  DailyJournalEntry,
  DensitySettings,
  DispatchedContainerRecord,
  DispatchRecord,
  LadiDimensionRule,
  ManualPackingItem,
  PackagingRule,
  PurchaseItem,
  SizePackagingRule,
  StockItem,
  StockOpeningSettings,
  StockReturnRejection,
  MonthlyStockSnapshot,
  StockThresholdSettings,
} from '../types/cable';
import { computeRecordRow, evaluateSpoolSizeForOrder } from './calculations';

export interface StandaloneAppPayload {
  orders: CableOrder[];
  sizeRules: SizePackagingRule[];
  packagingRules: PackagingRule[];
  colourMap: ColourMapRule[];
  densities: DensitySettings;
  ladiDimensions: LadiDimensionRule[];
  purchaseItems: PurchaseItem[];
  manualPackingItems: ManualPackingItem[];
  containerPlans: ContainerPlan[];
  dispatchedContainers?: DispatchedContainerRecord[];
  dispatchRecords?: DispatchRecord[];
  customStockItems?: StockItem[];
  pvcOverrides?: Record<string, any>;
  copSlipNotes?: string;
  stockThresholds?: StockThresholdSettings;
  batchHistory?: BatchHistoryEntry[];
  stockReturnRejections?: StockReturnRejection[];
  stockOpenings?: Record<string, number>;
  stockOverrides?: Record<string, { opening?: number; received?: number; consumed?: number }>;
  stockOpeningsBaseline?: Record<string, number>;
  monthlyStockSnapshots?: Record<string, MonthlyStockSnapshot>;
  dailyJournalEntries?: DailyJournalEntry[];
  exportedAt?: string;
}

export const LIVE_APP_URL = 'https://ais-pre-5r2bu3uvfxmuwsvok5xoor-104198471035.asia-east1.run.app';

export function getAttachedLiveUrl(): string {
  if (typeof window !== 'undefined') {
    if ((window as any).__PLUTUS_LIVE_URL__) {
      return (window as any).__PLUTUS_LIVE_URL__;
    }
    if (window.location && window.location.origin && window.location.origin.startsWith('http')) {
      return window.location.origin;
    }
  }
  return LIVE_APP_URL;
}

declare global {
  interface Window {
    __PLUTUS_EMBEDDED_STATE__?: StandaloneAppPayload;
    __PLUTUS_LIVE_URL__?: string;
  }
}

/**
 * Generates and downloads a 100% self-contained single-file HTML bundle of this exact
 * 14-tab React + Tailwind application pre-loaded with all current orders, container plans,
 * purchase items, and standards so it runs directly on any laptop (file:// or offline)
 * with zero data loss and zero syntax errors, and with the official Live URL attached.
 */
export async function downloadStandaloneLaptopApp(payload: StandaloneAppPayload): Promise<void> {
  const stampedPayload: StandaloneAppPayload = {
    ...payload,
    exportedAt: new Date().toISOString(),
  };

  let appCss = '';
  let appJs = '';

  // 1. Check if we are already running inside a downloaded standalone HTML file on a laptop
  const existingCssEl = document.getElementById('plutus-app-css');
  const existingJsEl = document.getElementById('plutus-app-js');

  if (existingCssEl?.textContent && existingJsEl?.textContent) {
    appCss = existingCssEl.textContent;
    appJs = existingJsEl.textContent;
  } else {
    // 2. Fetch the pre-compiled production React + Tailwind bundle from /laptop-bundle/
    try {
      const [cssRes, jsRes] = await Promise.all([
        fetch('/laptop-bundle/app.css'),
        fetch('/laptop-bundle/app.js'),
      ]);
      if (cssRes.ok && jsRes.ok) {
        appCss = await cssRes.text();
        appJs = await jsRes.text();
      }
    } catch (err) {
      console.warn('Could not fetch /laptop-bundle assets:', err);
    }
  }

  // 3. Fallback: if appCss or appJs are still missing, attempt DOM extraction
  if (!appCss && typeof document !== 'undefined') {
    const styleEls = Array.from(document.querySelectorAll('style'));
    appCss = styleEls.map(s => s.textContent || '').join('\n');
  }

  if (appCss && appJs) {
    // Safely escape any literal </script or </style sequences inside JSON, CSS, or JS
    // so the browser HTML parser never prematurely closes the tag!
    const safeStateJson = JSON.stringify(stampedPayload).replace(/</g, '\\u003c');
    const safeCss = appCss.replace(/<\/style/gi, '<\\/style');
    const safeJs = appJs.replace(/<\/script/gi, '<\\/script');
    const safeOrdersJson = JSON.stringify(stampedPayload.orders || []).replace(/</g, '\\u003c');

    const htmlParts = [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="UTF-8" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '  <meta name="application-url" content="' + LIVE_APP_URL + '" />',
      '  <link rel="canonical" href="' + LIVE_APP_URL + '" />',
      '  <title>PLUTUS Cable Production & Requisition System (Laptop Edition)</title>',
      '  <style id="plutus-app-css">',
      safeCss,
      '  </style>',
      '</head>',
      '<body>',
      '  <div id="root"></div>',
      '  <script id="plutus-live-url">',
      '    window.__PLUTUS_LIVE_URL__ = "' + LIVE_APP_URL + '";',
      '  </script>',
      '  <script id="plutus-init-orders">',
      '    const INITIAL_ORDERS = ' + safeOrdersJson + ';',
      '    window.__PLUTUS_INITIAL_ORDERS__ = INITIAL_ORDERS;',
      '  </script>',
      '  <script id="plutus-embedded-state">',
      '    window.__PLUTUS_EMBEDDED_STATE__ = ' + safeStateJson + ';',
      '    try {',
      '      sessionStorage.setItem("plutus_unlocked", "true");',
      '    } catch (e) {}',
      '  </script>',
      '  <script id="plutus-app-js">',
      safeJs,
      '  </script>',
      '</body>',
      '</html>',
    ];

    const fullHtml = htmlParts.join('\n');
    const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'PLUTUS_CABLE_PRODUCTION_LAPTOP_APP.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }

  // Fallback to formatted tables report if bundle files are unavailable
  downloadFormattedTablesHtml(stampedPayload);
}

/**
 * Generates and downloads a mobile-optimized, touch-friendly standalone Android application file
 * (PLUTUS_ANDROID_MOBILE_APP.html) pre-loaded with all current live data so it can be downloaded
 * directly on any Android device or shared via WhatsApp / Google Drive / USB.
 */
export async function downloadStandaloneAndroidApp(payload: StandaloneAppPayload): Promise<void> {
  const stampedPayload: StandaloneAppPayload = {
    ...payload,
    exportedAt: new Date().toISOString(),
  };

  let appCss = '';
  let appJs = '';

  const existingCssEl = document.getElementById('plutus-app-css');
  const existingJsEl = document.getElementById('plutus-app-js');

  if (existingCssEl?.textContent && existingJsEl?.textContent) {
    appCss = existingCssEl.textContent;
    appJs = existingJsEl.textContent;
  } else {
    try {
      const [cssRes, jsRes] = await Promise.all([
        fetch('/laptop-bundle/app.css'),
        fetch('/laptop-bundle/app.js'),
      ]);
      if (cssRes.ok && jsRes.ok) {
        appCss = await cssRes.text();
        appJs = await jsRes.text();
      }
    } catch (err) {
      console.warn('Could not fetch /laptop-bundle assets:', err);
    }
  }

  if (!appCss && typeof document !== 'undefined') {
    const styleEls = Array.from(document.querySelectorAll('style'));
    appCss = styleEls.map(s => s.textContent || '').join('\n');
  }

  if (appCss && appJs) {
    const safeStateJson = JSON.stringify(stampedPayload).replace(/</g, '\\u003c');
    const safeCss = appCss.replace(/<\/style/gi, '<\\/style');
    const safeJs = appJs.replace(/<\/script/gi, '<\\/script');
    const safeOrdersJson = JSON.stringify(stampedPayload.orders || []).replace(/</g, '\\u003c');

    const htmlParts = [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="UTF-8" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes" />',
      '  <meta name="theme-color" content="#0f172a" />',
      '  <meta name="mobile-web-app-capable" content="yes" />',
      '  <meta name="apple-mobile-web-app-capable" content="yes" />',
      '  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
      '  <meta name="apple-mobile-web-app-title" content="PLUTUS App" />',
      '  <meta name="application-url" content="' + LIVE_APP_URL + '" />',
      '  <link rel="canonical" href="' + LIVE_APP_URL + '" />',
      '  <title>PLUTUS Cable Production App (Android Mobile Edition)</title>',
      '  <style id="plutus-app-css">',
      safeCss,
      '  /* Android mobile touch enhancements */',
      '  html, body { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }',
      '  input, select, textarea, button { font-size: 14px; }',
      '  </style>',
      '</head>',
      '<body>',
      '  <div id="root"></div>',
      '  <script id="plutus-live-url">',
      '    window.__PLUTUS_LIVE_URL__ = "' + LIVE_APP_URL + '";',
      '  </script>',
      '  <script id="plutus-init-orders">',
      '    const INITIAL_ORDERS = ' + safeOrdersJson + ';',
      '    window.__PLUTUS_INITIAL_ORDERS__ = INITIAL_ORDERS;',
      '  </script>',
      '  <script id="plutus-embedded-state">',
      '    window.__PLUTUS_EMBEDDED_STATE__ = ' + safeStateJson + ';',
      '    try {',
      '      sessionStorage.setItem("plutus_unlocked", "true");',
      '      localStorage.setItem("plutus_unlocked_persistent", "true");',
      '    } catch (e) {}',
      '  </script>',
      '  <script id="plutus-app-js">',
      safeJs,
      '  </script>',
      '</body>',
      '</html>',
    ];

    const fullHtml = htmlParts.join('\n');
    const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'PLUTUS_ANDROID_MOBILE_APP.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }

  downloadFormattedTablesHtml(stampedPayload);
}

/**
 * Downloads a 1-click Windows Desktop Batch Launcher (.bat) that opens the app
 * in a dedicated standalone laptop window with the Live Cloud URL attached as primary/fallback.
 */
export function downloadWindowsLaptopLauncher(appUrl?: string): void {
  const targetLiveUrl = appUrl && appUrl.startsWith('http') ? appUrl : LIVE_APP_URL;
  const batContent = `@echo off
title PLUTUS Cable Production & Requisition System - Laptop Launcher
set "LIVE_URL=${targetLiveUrl}"
echo ==============================================================================
echo       PLUTUS CABLE PRODUCTION ^& REQUISITION SYSTEM - LAPTOP LAUNCHER
echo ==============================================================================
echo Attached Live Cloud URL: %LIVE_URL%
echo.
if exist "%~dp0PLUTUS_CABLE_PRODUCTION_LAPTOP_APP.html" (
  echo [1] Launching Local Standalone Laptop App:
  echo     %~dp0PLUTUS_CABLE_PRODUCTION_LAPTOP_APP.html
  start msedge --app="file:///%~dp0PLUTUS_CABLE_PRODUCTION_LAPTOP_APP.html" 2>nul || start chrome --app="file:///%~dp0PLUTUS_CABLE_PRODUCTION_LAPTOP_APP.html" 2>nul || start "" "%~dp0PLUTUS_CABLE_PRODUCTION_LAPTOP_APP.html"
) else (
  echo [2] Standalone HTML file not detected in current folder.
  echo     Launching Attached Live Cloud Web App:
  echo     %LIVE_URL%
  start msedge --app="%LIVE_URL%" 2>nul || start chrome --app="%LIVE_URL%" 2>nul || start "" "%LIVE_URL%"
)
echo.
exit
`;
  const blob = new Blob([batContent], { type: 'application/x-bat;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Run_PLUTUS_Cable_App_on_Laptop.bat';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Downloads a Google Drive / Google Docs compatible visual launcher (.doc).
 * Unlike .html or .json files (which Google Drive displays as raw source code),
 * double-clicking this .doc file inside Google Drive opens a clean formatted document
 * with a clickable button to launch the live PLUTUS application immediately!
 */
export function downloadGoogleDriveDocLauncher(appUrl?: string): void {
  const targetLiveUrl = appUrl && appUrl.startsWith('http') ? appUrl : LIVE_APP_URL;
  const docHtml = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset="utf-8">
<title>PLUTUS Cable Production & Requisition System — Google Drive Launcher</title>
</head>
<body style="font-family: Arial, sans-serif; background-color: #f8fafc; padding: 36px; color: #0f172a;">
  <div style="max-width: 680px; margin: 0 auto; background: #ffffff; border: 3px solid #1e293b; padding: 32px;">
    <h1 style="margin: 0 0 8px 0; font-size: 22px; color: #0f172a;">
      ⚡ PLUTUS CABLE PRODUCTION &amp; REQUISITION SYSTEM
    </h1>
    <p style="margin: 0 0 20px 0; font-size: 13px; color: #475569; font-weight: bold;">
      OFFICIAL GOOGLE DRIVE CLOUD APPLICATION LAUNCHER (REAL-TIME MULTI-DEVICE SYNC)
    </p>
    <hr style="border: none; border-top: 2px solid #cbd5e1; margin-bottom: 24px;" />

    <p style="font-size: 15px; line-height: 1.6; color: #1e293b; margin-bottom: 20px;">
      <strong>Click the blue link below to open and run the live PLUTUS Cable Production System directly from Google Drive:</strong>
    </p>

    <p style="margin: 28px 0; text-align: center;">
      <a href="${targetLiveUrl}" target="_blank" style="background-color: #059669; color: #ffffff; padding: 16px 28px; text-decoration: none; font-size: 16px; font-weight: bold; border: 2px solid #047857; display: inline-block;">
        🚀 CLICK HERE TO RUN PLUTUS CABLE PRODUCTION APP ↗
      </a>
    </p>

    <p style="font-size: 13px; color: #334155; background: #f1f5f9; padding: 14px; border: 1px solid #cbd5e1; word-break: break-all;">
      <strong>Direct Official Live App Link:</strong><br/>
      <a href="${targetLiveUrl}" target="_blank" style="color: #2563eb; font-weight: bold;">${targetLiveUrl}</a>
    </p>

    <h3 style="font-size: 14px; color: #0f172a; margin-top: 24px; margin-bottom: 8px;">
      💡 Why did Google Drive show code earlier?
    </h3>
    <ul style="font-size: 12.5px; color: #334155; line-height: 1.6;">
      <li>Google Drive's built-in previewer displays <code>.html</code> and <code>.json</code> (such as <code>applet_access_history.json</code>) as raw text code instead of running them.</li>
      <li>By opening this <strong>Google Drive Launcher (.doc)</strong> in Google Drive and clicking the link above, the full interactive 14-tab system opens immediately in your browser with <strong>Real-Time Cloud Auto-Save</strong>.</li>
      <li>If you downloaded the offline <code>PLUTUS_CABLE_PRODUCTION_LAPTOP_APP.html</code> file, simply open it from your computer's <strong>Downloads</strong> or <strong>Desktop</strong> folder (outside Google Drive's text viewer) to run it offline.</li>
    </ul>

    <p style="font-size: 12px; color: #64748b; margin-top: 20px;">
      Default Unlock Password: <strong>Password</strong> • Generated: ${new Date().toLocaleString()}
    </p>
  </div>
</body>
</html>`;

  const blob = new Blob(['\ufeff', docHtml], { type: 'application/msword;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'PLUTUS_GOOGLE_DRIVE_CLICK_TO_RUN_APP.doc';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Downloads a native Internet Shortcut (.url) file that opens the Live Cloud App
 * directly in Chrome/Edge when double-clicked from Google Drive Desktop or Windows Desktop.
 */
export function downloadInternetShortcutUrl(appUrl?: string): void {
  const targetLiveUrl = appUrl && appUrl.startsWith('http') ? appUrl : LIVE_APP_URL;
  const shortcutContent = `[InternetShortcut]\r\nURL=${targetLiveUrl}\r\nIconIndex=0\r\n`;
  const blob = new Blob([shortcutContent], { type: 'application/internet-shortcut;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Open_PLUTUS_Cable_Live_App.url';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Downloads all formatted production tables (1 table per page print ready)
 */
export function downloadFormattedTablesHtml(payload: StandaloneAppPayload): void {
  const { orders, densities, ladiDimensions, sizeRules, packagingRules, containerPlans } = payload;

  const orderRowsHtml = orders
    .map((o, idx) => {
      const r = computeRecordRow(o, densities, ladiDimensions);
      const evalPkg = evaluateSpoolSizeForOrder(
        r.finalDia,
        r.orderLen,
        r.size,
        r.cores,
        r.grade,
        sizeRules,
        packagingRules,
        o.spool_size
      );
      const packLabel = evalPkg.packaging || '1000m / Drum';
      const drumLen = packLabel.includes('500') ? 500 : 1000;
      const drumCount = r.orderLen > 0 ? Math.ceil(r.orderLen / drumLen) : 0;
      const bbn = Math.max(1, Number(evalPkg.bbnPerPallet) || 1);
      const palletCount = drumCount > 0 ? Math.ceil(drumCount / bbn) : 0;
      const stages = r.pStatus
        ? `${r.pStatus.b ? 'B ' : ''}${r.pStatus.c ? 'CS ' : ''}${r.pStatus.i ? 'I ' : ''}${r.pStatus.t ? 'TS ' : ''}${r.pStatus.s ? 'SH' : ''}`.trim() || 'Pending'
        : 'Pending';
      return `<tr>
        <td>${idx + 1}</td>
        <td><strong>${o.batch}</strong></td>
        <td>${o.brand}</td>
        <td>${o.grade || '-'}</td>
        <td><strong>${o.cores}C × ${o.size}</strong></td>
        <td>${o.conductor}</td>
        <td>${r.coreOd.toFixed(2)} mm</td>
        <td>${r.finalDia.toFixed(2)} mm</td>
        <td>${r.orderLen.toLocaleString()} m</td>
        <td>${r.reqCu.toFixed(2)} kg</td>
        <td>${r.reqIns.toFixed(2)} kg</td>
        <td>${r.reqSheath.toFixed(2)} kg</td>
        <td><strong>${evalPkg.spool}</strong></td>
        <td><strong>${drumCount} Drums</strong> (${packLabel})</td>
        <td><strong>${evalPkg.pallet}</strong> (${palletCount} Pallets)</td>
        <td>${stages}</td>
      </tr>`;
    })
    .join('');

  const drumAggMap: Record<
    string,
    { spool: string; packLen: string; drums: number; pallet: string; bbn: number; pallets: number; totalLen: number }
  > = {};
  orders.forEach(o => {
    const r = computeRecordRow(o, densities, ladiDimensions);
    const evalPkg = evaluateSpoolSizeForOrder(
      r.finalDia,
      r.orderLen,
      r.size,
      r.cores,
      r.grade,
      sizeRules,
      packagingRules,
      o.spool_size
    );
    const packLabel = evalPkg.packaging || '1000m / Drum';
    const drumLen = packLabel.includes('500') ? 500 : 1000;
    const drums = r.orderLen > 0 ? Math.ceil(r.orderLen / drumLen) : 0;
    const bbn = Math.max(1, Number(evalPkg.bbnPerPallet) || 1);
    const key = `${evalPkg.spool}__${evalPkg.pallet}`;
    if (!drumAggMap[key]) {
      drumAggMap[key] = {
        spool: evalPkg.spool,
        packLen: packLabel,
        drums: 0,
        pallet: evalPkg.pallet,
        bbn,
        pallets: 0,
        totalLen: 0,
      };
    }
    drumAggMap[key].drums += drums;
    drumAggMap[key].totalLen += r.orderLen;
    drumAggMap[key].pallets = Math.ceil(drumAggMap[key].drums / bbn);
  });

  const drumSummaryRowsHtml = Object.values(drumAggMap)
    .map(
      (d, i) => `<tr>
        <td>${i + 1}</td>
        <td><strong>${d.spool}</strong></td>
        <td>${d.packLen}</td>
        <td><strong>${d.drums} Drums</strong></td>
        <td><strong>${d.pallet}</strong></td>
        <td>${d.bbn} Drums / Pallet</td>
        <td><strong>${d.pallets} Pallets</strong></td>
        <td>${d.totalLen.toLocaleString()} m</td>
      </tr>`
    )
    .join('');

  const containerRowsHtml = containerPlans
    .map(
      (c, i) => `<tr>
        <td>${i + 1}</td>
        <td><strong>${c.containerNo}</strong></td>
        <td>${c.containerType}</td>
        <td>${c.planningSheetTitle || '-'}</td>
        <td>${c.clientName || '-'}</td>
        <td>${c.destination || '-'}</td>
        <td><strong>${c.items.reduce((s, it) => s + (Number(it.drumCount) || 0), 0)} Drums</strong></td>
        <td><strong>${c.items.reduce((s, it) => s + (Number(it.palletsRequired) || 0), 0)} Pallets</strong></td>
        <td>${c.items.reduce((s, it) => s + (Number(it.totalLength) || 0), 0).toLocaleString()} m</td>
        <td>${c.items.reduce((s, it) => s + (Number(it.grossWt) || 0), 0).toFixed(1)} kg</td>
      </tr>`
    )
    .join('');

  const pkgRulesHtml = packagingRules
    .map(
      (p, i) => `<tr>
        <td>${i + 1}</td>
        <td><strong>${p.spool}</strong></td>
        <td>${p.m1000 || '-'}</td>
        <td>${p.m500 || '-'}</td>
        <td><strong>${p.pallet}</strong></td>
        <td>${p.bbnPerPallet || '1'}</td>
      </tr>`
    )
    .join('');

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PLUTUS Cable Production & Requisition System — Formatted Report</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; margin: 0; padding: 20px; background: #f8fafc; color: #0f172a; }
  .top-bar { background: #0f172a; color: #fff; padding: 14px 20px; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
  .top-bar h1 { margin: 0; font-size: 18px; }
  .btn { background: #2563eb; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 12px; }
  .sheet-card { background: #fff; border: 1.5px solid #cbd5e1; border-radius: 10px; padding: 16px; margin-bottom: 24px; page-break-after: always; break-after: page; page-break-inside: avoid; break-inside: avoid; }
  .sheet-card:last-child { page-break-after: auto; break-after: auto; }
  h2 { margin: 0 0 10px 0; font-size: 14px; color: #0f172a; border-bottom: 2px solid #0f172a; padding-bottom: 6px; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid #94a3b8; padding: 5px 7px; text-align: left; }
  th { background: #f1f5f9; font-weight: 800; text-transform: uppercase; font-size: 10px; }
  tr:nth-child(even) td { background: #f8fafc; }
  @page { size: A4 landscape; margin: 6mm; }
  @media print {
    body { background: #fff; padding: 0; }
    .no-print { display: none !important; }
    .sheet-card { border: 1px solid #475569; border-radius: 0; margin: 0; padding: 8px; page-break-after: always !important; break-after: page !important; page-break-inside: avoid !important; break-inside: avoid !important; }
    .sheet-card:last-child { page-break-after: auto !important; break-after: auto !important; }
    table { font-size: 9.5px; }
    th, td { padding: 3px 5px; }
  }
</style>
</head>
<body>
  <div class="top-bar no-print">
    <div>
      <h1>⚡ PLUTUS CABLE PRODUCTION & REQUISITION SYSTEM — FORMATTED TABLES</h1>
      <div style="font-size:11px;color:#cbd5e1;margin-top:2px;">Generated: ${new Date().toLocaleString()} • Configured for 1 Table Per Page Printing</div>
    </div>
    <button class="btn" onclick="window.print()">🖨️ Print All Tables (1 Per Page)</button>
  </div>

  <div class="sheet-card">
    <h2>1. Master Cable Orders, Material Calculations & Exact Drum / Pallet Schedule (${orders.length} Orders)</h2>
    <table>
      <thead>
        <tr>
          <th>#</th><th>Batch / Job</th><th>Brand</th><th>Grade</th><th>Size & Cores</th><th>Conductor</th>
          <th>Core OD</th><th>Final OD</th><th>Length</th><th>Cu Wt</th><th>Ins Wt</th><th>Sheath Wt</th>
          <th>Exact Drum Size</th><th>Drums Req</th><th>Exact Pallet Size</th><th>Stage</th>
        </tr>
      </thead>
      <tbody>${orderRowsHtml}</tbody>
    </table>
  </div>

  <div class="sheet-card">
    <h2>2. Exact Drum Size & Wooden Pallet Requisition Summary</h2>
    <table>
      <thead>
        <tr>
          <th>#</th><th>Exact Drum / Spool Size</th><th>Packing Length</th><th>Total Drums Required</th>
          <th>Exact Pallet Size</th><th>Drums / Pallet</th><th>Total Pallets Required</th><th>Total Cable Length</th>
        </tr>
      </thead>
      <tbody>${drumSummaryRowsHtml}</tbody>
    </table>
  </div>

  <div class="sheet-card">
    <h2>3. Container Stuffing & Dispatch Plans (${containerPlans.length} Containers)</h2>
    <table>
      <thead>
        <tr>
          <th>#</th><th>Container No</th><th>Type</th><th>Planning Sheet Title</th><th>Client</th>
          <th>Destination</th><th>Total Drums</th><th>Total Pallets</th><th>Total Length</th><th>Gross Weight</th>
        </tr>
      </thead>
      <tbody>${containerRowsHtml}</tbody>
    </table>
  </div>

  <div class="sheet-card">
    <h2>4. Master Drum & Pallet Reference Standards</h2>
    <table>
      <thead>
        <tr>
          <th>#</th><th>Exact Drum Size</th><th>OD Range (1000m / Drum)</th><th>OD Range (500m / Drum)</th><th>Exact Pallet Size</th><th>Bobbins / Pallet</th>
        </tr>
      </thead>
      <tbody>${pkgRulesHtml}</tbody>
    </table>
  </div>
</body>
</html>`;

  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'PLUTUS_CABLE_PRODUCTION_FORMATTED_SHEETS.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
