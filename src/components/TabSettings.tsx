import React, { useState } from 'react';
import {
  CableOrder,
  ColourMapRule,
  DensitySettings,
  LadiDimensionRule,
  PackagingRule,
  SizePackagingRule,
} from '../types/cable';
import {
  DEFAULT_COLOUR_MAP,
  DEFAULT_DENSITIES,
  DEFAULT_LADI_DIMENSIONS,
  DEFAULT_PACKAGING_RULES,
  DEFAULT_SIZE_PACKAGING,
} from '../data/defaults';
import {
  DEFAULT_MARU_MIRACLE_CARTON_RULES,
  DEFAULT_VIHAN_TRIGUARD_CARTON_RULES,
  formatMixFormulaNumbers,
  loadMaruMiracleCartonRules,
  loadVihanTriguardCartonRules,
  MaruMiracleCartonRule,
  saveMaruMiracleCartonRules,
  saveVihanTriguardCartonRules,
  VihanTriguardCartonRule,
} from '../utils/is694CartonPackaging';
import { Is694CartonMasterTables } from './Is694CartonMasterTables';
import {
  Cloud,
  Download,
  Upload,
  RotateCcw,
  Plus,
  Trash2,
  Edit2,
  Printer,
  CheckCircle2,
  Copy,
  X,
  Box,
} from 'lucide-react';

interface TabSettingsProps {
  orders: CableOrder[];
  colourMap: ColourMapRule[];
  sizeRules: SizePackagingRule[];
  packagingRules: PackagingRule[];
  densities: DensitySettings;
  ladiDimensions: LadiDimensionRule[];
  is694VihanRules?: VihanTriguardCartonRule[];
  is694MaruRules?: MaruMiracleCartonRule[];
  onUpdateColourMap: (rules: ColourMapRule[]) => void;
  onUpdateSizeRules: (rules: SizePackagingRule[]) => void;
  onUpdatePackagingRules: (rules: PackagingRule[]) => void;
  onUpdateDensities: (densities: DensitySettings) => void;
  onUpdateLadiDimensions: (ladi: LadiDimensionRule[]) => void;
  onUpdateVihanRules?: (rules: VihanTriguardCartonRule[]) => void;
  onUpdateMaruRules?: (rules: MaruMiracleCartonRule[]) => void;
  onResetFactoryOrders: () => void;
  onRestoreFullBackup: (data: any) => void;
  onDownloadStandaloneLaptopApp?: () => void;
  onForceCloudUpload?: () => Promise<void>;
  onForceCloudDownload?: () => Promise<void>;
}

export const TabSettings: React.FC<TabSettingsProps> = ({
  orders,
  colourMap,
  sizeRules,
  packagingRules,
  densities,
  ladiDimensions,
  is694VihanRules,
  is694MaruRules,
  onUpdateColourMap,
  onUpdateSizeRules,
  onUpdatePackagingRules,
  onUpdateDensities,
  onUpdateLadiDimensions,
  onUpdateVihanRules,
  onUpdateMaruRules,
  onResetFactoryOrders,
  onRestoreFullBackup,
  onDownloadStandaloneLaptopApp,
  onForceCloudUpload,
  onForceCloudDownload,
}) => {
  // Inline feedback banner (replaces blocked browser alert/confirm in sandboxed iframe)
  const [feedbackBanner, setFeedbackBanner] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);

  const showFeedback = (message: string, type: 'success' | 'error' = 'success') => {
    setFeedbackBanner({ message, type });
    setTimeout(() => {
      setFeedbackBanner(prev => (prev?.message === message ? null : prev));
    }, 4000);
  };

  // Density Modal state
  const [isDensityModalOpen, setIsDensityModalOpen] = useState(false);
  const [denEditKey, setDenEditKey] = useState('');
  const [denCat, setDenCat] = useState<'INSULATION' | 'SHEATH' | 'COPPER'>('INSULATION');
  const [denName, setDenName] = useState('');
  const [denFactor, setDenFactor] = useState('');

  // Ladi Modal state
  const [isLadiModalOpen, setIsLadiModalOpen] = useState(false);
  const [ladiEditIdx, setLadiEditIdx] = useState<number | null>(null);
  const [ladiSize, setLadiSize] = useState('');
  const [ladiCond, setLadiCond] = useState('');
  const [ladiPattern, setLadiPattern] = useState('');

  // IS-694 Master Carton & Mix Colour Carton Backup Standards
  const [vihanCartonRules, setVihanCartonRules] = useState<VihanTriguardCartonRule[]>(() =>
    is694VihanRules && is694VihanRules.length > 0 ? is694VihanRules : loadVihanTriguardCartonRules()
  );
  const [maruCartonRules, setMaruCartonRules] = useState<MaruMiracleCartonRule[]>(() =>
    is694MaruRules && is694MaruRules.length > 0 ? is694MaruRules : loadMaruMiracleCartonRules()
  );

  React.useEffect(() => {
    if (is694VihanRules && is694VihanRules.length > 0) {
      setVihanCartonRules(is694VihanRules);
    }
  }, [is694VihanRules]);

  React.useEffect(() => {
    if (is694MaruRules && is694MaruRules.length > 0) {
      setMaruCartonRules(is694MaruRules);
    }
  }, [is694MaruRules]);

  React.useEffect(() => {
    const refreshIs694 = () => {
      setVihanCartonRules(loadVihanTriguardCartonRules());
      setMaruCartonRules(loadMaruMiracleCartonRules());
    };
    window.addEventListener('plutus_is694_carton_rules_updated', refreshIs694);
    return () => window.removeEventListener('plutus_is694_carton_rules_updated', refreshIs694);
  }, []);

  const handleDownloadFormattedStandards = () => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>PLUTUS Master Standards & Backup Reference Tables</title>
  <style>
    @page { size: A4 landscape; margin: 6mm; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; padding: 20px; margin: 0; }
    .header { background: #0f172a; color: #fff; padding: 14px 20px; border-radius: 10px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
    .print-card { background: #fff; border: 1.5px solid #0f172a; border-radius: 8px; padding: 14px; margin-bottom: 24px; page-break-after: always; break-after: page; page-break-inside: avoid; break-inside: avoid; }
    .print-card:last-child { page-break-after: auto; break-after: auto; }
    h2 { margin: 0 0 10px 0; font-size: 14px; text-transform: uppercase; color: #0f172a; border-bottom: 2px solid #cbd5e1; padding-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { border: 1px solid #94a3b8; padding: 5px 8px; text-align: left; }
    th { background: #e2e8f0; font-weight: 700; text-transform: uppercase; font-size: 10px; }
    @media print { .no-print { display: none !important; } body { background: #fff; padding: 0; } }
  </style>
</head>
<body>
  <div class="header no-print">
    <div>
      <strong style="font-size:15px;">⚡ PLUTUS MASTER STANDARDS & REFERENCE TABLES (FORMATTED REPORT)</strong>
      <div style="font-size:11px;color:#cbd5e1;">Generated: ${new Date().toLocaleString()} — Ready to view or print (1 table per page)</div>
    </div>
    <button onclick="window.print()" style="background:#2563eb;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-weight:bold;cursor:pointer;">🖨️ Print All Tables (1 Per Page)</button>
  </div>

  <div class="print-card">
    <h2>1. Packaging Spool & Pallet Lookup Standard (${packagingRules.length} Rules)</h2>
    <table>
      <thead><tr><th>#</th><th>Drum / Spool Size</th><th>Min to Max OD (1000m)</th><th>Min to Max OD (500m)</th><th>Pallet Size</th><th>No. of Bbn / Pallet</th></tr></thead>
      <tbody>
        ${packagingRules.map((r, i) => `<tr><td>${i + 1}</td><td><strong>${r.spool}</strong></td><td>${r.m1000}</td><td>${r.m500}</td><td><strong>${r.pallet}</strong></td><td>${r.bbnPerPallet || '1'} Bbn / Pallet</td></tr>`).join('')}
      </tbody>
    </table>
  </div>

  <div class="print-card">
    <h2>2. Cable Grade & Size-wise Drum & Packaging Standard (${sizeRules.length} Rules)</h2>
    <table>
      <thead><tr><th>#</th><th>Cable Grade</th><th>Cores</th><th>Cable Size</th><th>Explicit Drum Size</th><th>Packaging Length</th></tr></thead>
      <tbody>
        ${sizeRules.map((r, i) => `<tr><td>${i + 1}</td><td>${r.grade}</td><td>${r.cores}</td><td><strong>${r.size}</strong></td><td>${r.spool || 'Auto by Final OD'}</td><td>${r.packaging}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>

  <div class="print-card">
    <h2>3. Core Colour Sequence Standard (${colourMap.length} Rules)</h2>
    <table>
      <thead><tr><th>#</th><th>Cable Grade</th><th>Cores</th><th>Colour Sequence</th></tr></thead>
      <tbody>
        ${colourMap.map((r, i) => `<tr><td>${i + 1}</td><td>${r.grade}</td><td>${r.cores}C</td><td>${r.seq}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>

  <div class="print-card">
    <h2>4. Material Densities Standard</h2>
    <table>
      <thead><tr><th>Category</th><th>Material / Compound Grade</th><th>Density Factor</th></tr></thead>
      <tbody>
        <tr><td><strong>COPPER</strong></td><td>COPPER</td><td><strong>${densities.COPPER}</strong></td></tr>
        ${Object.entries(densities.INSULATION).map(([k, v]) => `<tr><td>INSULATION</td><td>${k}</td><td>${v}</td></tr>`).join('')}
        ${Object.entries(densities.SHEATH).map(([k, v]) => `<tr><td>SHEATH</td><td>${k}</td><td>${v}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>

  <div class="print-card">
    <h2>5. Ladi Stranding Dimension Lookup Standard (${ladiDimensions.length} Rules)</h2>
    <table>
      <thead><tr><th>#</th><th>Cable Size (SQ MM)</th><th>Conductor Construction</th><th>Ladi Pattern</th></tr></thead>
      <tbody>
        ${ladiDimensions.map((r, i) => `<tr><td>${i + 1}</td><td><strong>${r.size} SQ MM</strong></td><td>${r.conductor}</td><td>${r.pattern}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>

  <div class="print-card">
    <h2>6A. IS-694 Master Cartons & Mix C/S Standard — Vihan Opto & Triguard (${vihanCartonRules.length} Sizes)</h2>
    <table>
      <thead><tr><th>Size</th><th>OPTO 90 MTRS</th><th>OPTO 45 MTR</th><th>OPTO 180 MTR</th><th>TRIGUARD BOX</th><th>TRIGUARD STACK</th><th>MIX C/S 90 MTRS (RD+BK+BL+YL+GR)</th><th>MIX C/S 45 MTRS (RD+BK+BL+YL+GR)</th></tr></thead>
      <tbody>
        ${vihanCartonRules.map(r => `<tr><td><strong>${r.size}</strong></td><td>${r.opto90m || '-'}</td><td>${r.opto45m || '-'}</td><td>${r.opto180m || '-'}</td><td>${r.triguardBox || '-'}</td><td>${r.triguardStack || '-'}</td><td><strong>${formatMixFormulaNumbers(r.mix90m)}</strong></td><td><strong>${formatMixFormulaNumbers(r.mix45m)}</strong></td></tr>`).join('')}
      </tbody>
    </table>
  </div>

  <div class="print-card">
    <h2>6B. IS-694 Maru Miracle Data, Master Cartons & Mix Pattern 90 Mtrs / 45 Mtrs (${maruCartonRules.length} Sizes)</h2>
    <table>
      <thead><tr><th>Size</th><th>Cond.</th><th>Ins. OD</th><th>90 MTRS Carton</th><th>45 MTR Carton</th><th>180 MTR Carton</th><th>Mix Pattern 90m (RD+BK+BL+YL+GR)</th><th>Mix Pattern 45m (RD+BK+BL+YL+GR)</th></tr></thead>
      <tbody>
        ${maruCartonRules.map(r => `<tr><td><strong>${r.size}</strong></td><td>${r.conductor}</td><td>${r.insOd.toFixed(2)} MM</td><td><strong>${r.coils90m || '-'}</strong></td><td><strong>${r.coils45m || '-'}</strong></td><td><strong>${r.coils180m || '-'}</strong></td><td><strong>${formatMixFormulaNumbers(r.mix90m)}</strong></td><td><strong>${formatMixFormulaNumbers(r.mix45m)}</strong></td></tr>`).join('')}
      </tbody>
    </table>
  </div>
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PLUTUS_FORMATTED_STANDARDS_REPORT_${new Date().toISOString().split('T')[0]}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showFeedback('Downloaded Formatted Standards Report (.html) — ready to view or print 1 table per page!');
  };

  const handleDownloadBackup = () => {
    const fullBackup = {
      appOrders: orders,
      customSizePkg: sizeRules,
      customPackaging: packagingRules,
      customColourMap: colourMap,
      customLadi: ladiDimensions,
      customDensities: densities,
      is694VihanRules: vihanCartonRules,
      is694MaruRules: maruCartonRules,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(fullBackup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PLUTUS_MASTER_BACKUP_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showFeedback('Downloaded system backup file for restore (including IS-694 Master Carton Standards).');
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        onRestoreFullBackup(parsed);
        showFeedback('Full backup restored successfully!');
      } catch (err: any) {
        showFeedback(`Error reading backup file: ${err.message}`, 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Density Actions
  const handleOpenAddDensity = () => {
    setDenEditKey('');
    setDenCat('INSULATION');
    setDenName('');
    setDenFactor('');
    setIsDensityModalOpen(true);
  };

  const handleOpenEditDensity = (
    cat: 'INSULATION' | 'SHEATH' | 'COPPER',
    name: string,
    val: number
  ) => {
    setDenEditKey(`${cat}||${name}`);
    setDenCat(cat);
    setDenName(name);
    setDenFactor(String(val));
    setIsDensityModalOpen(true);
  };

  const handleSaveDensity = (e: React.FormEvent) => {
    e.preventDefault();
    const factor = parseFloat(denFactor);
    if (!denName.trim() || isNaN(factor) || factor <= 0) {
      showFeedback('Please provide a valid material name and density factor.', 'error');
      return;
    }
    const updated = JSON.parse(JSON.stringify(densities));
    if (denEditKey) {
      const [oldCat, oldName] = denEditKey.split('||');
      if (oldCat === 'COPPER') {
        updated.COPPER = factor;
      } else {
        if (oldName !== denName) delete updated[oldCat][oldName];
        updated[denCat][denName.toUpperCase()] = factor;
      }
    } else {
      if (denCat === 'COPPER') updated.COPPER = factor;
      else updated[denCat][denName.toUpperCase()] = factor;
    }
    onUpdateDensities(updated);
    setIsDensityModalOpen(false);
    showFeedback(`Saved material density for "${denName.toUpperCase()}".`);
  };

  const handleInlineDensityChange = (
    cat: 'INSULATION' | 'SHEATH' | 'COPPER',
    name: string,
    rawVal: string
  ) => {
    const num = parseFloat(rawVal);
    if (isNaN(num) || num <= 0) return;
    const updated = JSON.parse(JSON.stringify(densities));
    if (cat === 'COPPER') {
      updated.COPPER = num;
    } else {
      updated[cat][name] = num;
    }
    onUpdateDensities(updated);
  };

  const handleDeleteDensity = (cat: 'INSULATION' | 'SHEATH', name: string) => {
    const updated = JSON.parse(JSON.stringify(densities));
    delete updated[cat][name];
    onUpdateDensities(updated);
    showFeedback(`Deleted material "${name}" from ${cat}.`);
  };

  // Ladi Actions
  const handleOpenAddLadi = () => {
    setLadiEditIdx(null);
    setLadiSize('');
    setLadiCond('');
    setLadiPattern('');
    setIsLadiModalOpen(true);
  };

  const handleOpenEditLadi = (idx: number, rule: LadiDimensionRule) => {
    setLadiEditIdx(idx);
    setLadiSize(String(rule.size));
    setLadiCond(rule.conductor);
    setLadiPattern(rule.pattern);
    setIsLadiModalOpen(true);
  };

  const handleSaveLadi = (e: React.FormEvent) => {
    e.preventDefault();
    const sz = parseFloat(ladiSize);
    if (isNaN(sz) || !ladiCond.trim() || !ladiPattern.trim()) {
      showFeedback('Please fill in all Ladi lookup fields correctly.', 'error');
      return;
    }
    const updated = [...ladiDimensions];
    if (ladiEditIdx !== null) {
      updated[ladiEditIdx] = {
        size: sz,
        conductor: ladiCond.trim(),
        pattern: ladiPattern.trim(),
      };
    } else {
      updated.push({ size: sz, conductor: ladiCond.trim(), pattern: ladiPattern.trim() });
    }
    onUpdateLadiDimensions(updated);
    setIsLadiModalOpen(false);
    showFeedback(`Saved Ladi rule (${sz} SQ MM — ${ladiCond.trim()}).`);
  };

  const handleUpdateLadiField = (
    idx: number,
    field: keyof LadiDimensionRule,
    val: string
  ) => {
    const updated = [...ladiDimensions];
    if (field === 'size') {
      const parsed = parseFloat(val);
      updated[idx] = { ...updated[idx], size: isNaN(parsed) ? 0 : parsed };
    } else {
      updated[idx] = { ...updated[idx], [field]: val };
    }
    onUpdateLadiDimensions(updated);
  };

  const handleDeleteLadi = (idx: number) => {
    const removed = ladiDimensions[idx];
    const updated = ladiDimensions.filter((_, i) => i !== idx);
    onUpdateLadiDimensions(updated);
    showFeedback(
      `Deleted Ladi rule (${removed?.size ?? ''} SQ MM — ${removed?.conductor ?? ''}).`
    );
  };

  // Colour Map Actions
  const handleUpdateColourField = (idx: number, field: keyof ColourMapRule, val: string) => {
    const updated = [...colourMap];
    updated[idx] = { ...updated[idx], [field]: val };
    onUpdateColourMap(updated);
  };

  const handleDeleteColourRow = (idx: number) => {
    const removed = colourMap[idx];
    const updated = colourMap.filter((_, i) => i !== idx);
    onUpdateColourMap(updated);
    showFeedback(`Deleted colour sequence rule (${removed?.grade} - ${removed?.cores}C).`);
  };

  const handleDuplicateColourRow = (idx: number) => {
    const item = colourMap[idx];
    if (!item) return;
    const updated = [...colourMap];
    updated.splice(idx + 1, 0, { ...item });
    onUpdateColourMap(updated);
    showFeedback(`Duplicated colour sequence rule (${item.grade} - ${item.cores}C).`);
  };

  const handleAddColourRow = () => {
    onUpdateColourMap([
      ...colourMap,
      { grade: 'H07RN-F', cores: '6', seq: 'BLACK*5, YL/GN' },
    ]);
    showFeedback('Added new colour sequence rule row.');
  };

  // Size Pkg Actions
  const handleUpdateSizePkgField = (
    idx: number,
    field: keyof SizePackagingRule,
    val: string
  ) => {
    const updated = [...sizeRules];
    updated[idx] = { ...updated[idx], [field]: val };
    onUpdateSizeRules(updated);
  };

  const handleDeleteSizePkgRow = (idx: number) => {
    const removed = sizeRules[idx];
    const updated = sizeRules.filter((_, i) => i !== idx);
    onUpdateSizeRules(updated);
    showFeedback(
      `Deleted size packaging rule (${removed?.grade} ${removed?.cores}C × ${removed?.size}).`
    );
  };

  const handleDuplicateSizePkgRow = (idx: number) => {
    const item = sizeRules[idx];
    if (!item) return;
    const updated = [...sizeRules];
    updated.splice(idx + 1, 0, { ...item });
    onUpdateSizeRules(updated);
    showFeedback(`Duplicated size packaging rule (${item.grade} ${item.cores}C × ${item.size}).`);
  };

  const handleAddSizePkgRow = () => {
    onUpdateSizeRules([
      ...sizeRules,
      {
        grade: 'H07RN-F',
        cores: '3',
        size: '1.50 SQ MM',
        spool: '28 X 12 X 15',
        packaging: '1000m / Drum',
      },
    ]);
    showFeedback('Added new Grade & Size Drum rule row.');
  };

  // Packaging Rules Actions
  const handleUpdatePkgField = (idx: number, field: keyof PackagingRule, val: string) => {
    const updated = [...packagingRules];
    updated[idx] = { ...updated[idx], [field]: val };
    onUpdatePackagingRules(updated);
  };

  const handleDeletePkgRow = (idx: number) => {
    const removed = packagingRules[idx];
    const updated = packagingRules.filter((_, i) => i !== idx);
    onUpdatePackagingRules(updated);
    showFeedback(`Deleted packaging spool rule (${removed?.spool}).`);
  };

  const handleDuplicatePkgRow = (idx: number) => {
    const item = packagingRules[idx];
    if (!item) return;
    const updated = [...packagingRules];
    updated.splice(idx + 1, 0, { ...item });
    onUpdatePackagingRules(updated);
    showFeedback(`Duplicated packaging spool rule (${item.spool}).`);
  };

  const handleAddPkgRow = () => {
    onUpdatePackagingRules([
      ...packagingRules,
      {
        spool: '30 X 12 X 15',
        m1000: '0 - 0 mm',
        m500: '-',
        pallet: '30X30x6',
        bbnPerPallet: '4',
      },
    ]);
    showFeedback('Added new Packaging Spool & Pallet rule row.');
  };

  return (
    <div className="space-y-6">
      {/* Status Feedback Banner */}
      {feedbackBanner && (
        <div
          className={`sticky top-2 z-40 flex items-center justify-between px-4 py-2.5 rounded-xl border shadow-md text-xs font-bold transition-all ${
            feedbackBanner.type === 'error'
              ? 'bg-red-600 text-white border-red-700'
              : 'bg-slate-900 text-emerald-300 border-slate-700'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{feedbackBanner.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="p-1 hover:bg-white/10 rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Cloud & Backup Card */}
      <div className="bg-emerald-50 border-2 border-emerald-600 rounded-xl p-4 shadow-xs">
        <div className="flex items-center gap-2 font-bold text-emerald-900 text-sm pb-2 border-b border-emerald-200 mb-3">
          <Cloud className="w-5 h-5 text-emerald-600" />
          <span>☁️ Master Cloud Sync & Data Management</span>
        </div>
        <p className="text-xs text-emerald-800 font-medium mb-3">
          All your additions, deletions, orders, custom rules, and slips persist automatically in browser storage and can be exported as a full JSON backup file or restored across devices.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={async () => {
              if (onForceCloudUpload) {
                await onForceCloudUpload();
              }
              showFeedback(
                'All changes are synced and saved to Local Storage, IndexedDB & Cloud in real time!'
              );
            }}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
          >
            <Cloud className="w-4 h-4" /> ⬆ FORCE UPLOAD (Save All Data to Local & Cloud)
          </button>

          {onForceCloudDownload && (
            <button
              type="button"
              onClick={async () => {
                await onForceCloudDownload();
                showFeedback('Downloaded and restored latest data from Cloud Database!');
              }}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Download className="w-4 h-4" /> ⬇ FORCE DOWNLOAD (Pull Latest Data from Cloud)
            </button>
          )}
        </div>
      </div>

      {/* Backup & Restore */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
        <div className="font-bold text-slate-900 text-sm pb-2 border-b border-slate-200 mb-3 flex items-center gap-2">
          <Download className="w-4 h-4 text-blue-600" />
          <span>💾 Data Backup & Restore</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap no-print">
          {onDownloadStandaloneLaptopApp && (
            <button
              type="button"
              onClick={onDownloadStandaloneLaptopApp}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-extrabold flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Download className="w-4 h-4" /> 💻 Download Full Standalone Laptop App (.html)
            </button>
          )}

          <button
            type="button"
            onClick={handleDownloadFormattedStandards}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Download className="w-4 h-4" /> Download Formatted Standards Tables (.html)
          </button>

          <button
            type="button"
            onClick={handleDownloadBackup}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-xs"
          >
            <Download className="w-4 h-4" /> Save Restore File
          </button>

          <label className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs">
            <Upload className="w-4 h-4" /> Restore from JSON Backup
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleImportBackup}
            />
          </label>

          <button
            type="button"
            onClick={() => {
              onResetFactoryOrders();
              showFeedback('Restored factory master sheet orders and standards.');
            }}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5"
          >
            <RotateCcw className="w-4 h-4" /> Reset to Master Sheet Defaults (124 Orders)
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs"
            title="Print current page"
          >
            <Printer className="w-4 h-4 text-slate-600" />
            <span>Print current page</span>
          </button>
        </div>
      </div>

      {/* Real-time Dynamic Reflection Map Card */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-400 rounded-xl p-4 shadow-xs">
        <div className="flex items-center gap-2 font-bold text-blue-950 text-sm pb-2 border-b border-blue-200 mb-2">
          <span>⚡ Live Real-Time Reflection System (Backup → All Sheets & Slips)</span>
        </div>
        <p className="text-xs text-blue-900 mb-3">
          Every time you add, edit, or delete any standard rule below, the change <strong>immediately and automatically recalculates</strong> across every relevant tab in real-time without requiring reloads:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 text-xs">
          <div className="bg-white p-2.5 rounded-lg border border-blue-200 shadow-2xs">
            <span className="font-bold text-slate-900 block mb-0.5">🎨 1. Core Colour Sequence:</span>
            <span className="text-[11px] text-slate-600">Reflects in <b>Tab 3 (Process Cards & Requisition)</b> for insulated core sequence codes and twisting operations.</span>
          </div>
          <div className="bg-white p-2.5 rounded-lg border border-blue-200 shadow-2xs">
            <span className="font-bold text-slate-900 block mb-0.5">📐 2. Size & Packaging Standards:</span>
            <span className="text-[11px] text-slate-600">Reflects in <b>Tab 1 (Order Entry dropdowns)</b>, <b>Tab 5 (Drum Summary)</b>, <b>Tab 6 (Packing 500m/1000m Reels)</b>, and <b>Tab 6B (Containers)</b>.</span>
          </div>
          <div className="bg-white p-2.5 rounded-lg border border-blue-200 shadow-2xs">
            <span className="font-bold text-slate-900 block mb-0.5">📦 3. Spool & Pallet Lookups:</span>
            <span className="text-[11px] text-slate-600">Reflects in <b>Tab 5 (Drum Summary)</b>, <b>Tab 6 (Packing List)</b>, <b>Tab 6B (Container Stacking & Volume)</b>, and <b>Tab 10 (Drum Slip)</b>.</span>
          </div>
          <div className="bg-white p-2.5 rounded-lg border border-blue-200 shadow-2xs">
            <span className="font-bold text-slate-900 block mb-0.5">⚖️ 4. Material Densities:</span>
            <span className="text-[11px] text-slate-600">Reflects in <b>Tab 1 (Orders)</b>, <b>Tab 4 (Engineering Record)</b>, <b>Tab 5 (Summary)</b>, <b>Tab 8 (PVC Slip)</b>, <b>Tab 9 (Copper Slip)</b>, and <b>Tab 11 (Stock)</b>.</span>
          </div>
          <div className="bg-white p-2.5 rounded-lg border border-blue-200 shadow-2xs">
            <span className="font-bold text-slate-900 block mb-0.5">🧶 5. Ladi Dimension Lookups:</span>
            <span className="text-[11px] text-slate-600">Reflects in <b>Tab 1 & 2 (Cu Stranding CS stages)</b>, <b>Tab 3 (Process Cards)</b>, and <b>Tab 4 (Record Sub 1, Sub 2, Ladi Dia & Lay)</b>.</span>
          </div>
          <div className="bg-white p-2.5 rounded-lg border border-blue-200 shadow-2xs">
            <span className="font-bold text-slate-900 block mb-0.5">💾 Auto-Save & Cloud:</span>
            <span className="text-[11px] text-slate-600">All modified backup tables automatically save to <b>LocalStorage</b>, <b>IndexedDB</b>, and <b>Cloud RTDB</b> immediately.</span>
          </div>
        </div>
      </div>

      {/* 1. Core Colour Sequence Manager */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3 print-card">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
          <div className="font-bold text-slate-900 text-sm">
            🎨 Core Colour Sequence Manager ({colourMap.length} Rules)
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAddColourRow}
              className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold flex items-center gap-1 shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5" /> Add Colour Rule
            </button>
            <button
              type="button"
              onClick={() => {
                onUpdateColourMap(DEFAULT_COLOUR_MAP);
                showFeedback('Reset core colour sequences to defaults.');
              }}
              className="text-xs px-2.5 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded font-semibold"
            >
              🔄 Reset Default Sequences
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Customize core colour mapping for each Grade and Core count. Click any field to edit, or use the action buttons to duplicate or delete rows.
        </p>

        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
              <tr>
                <th className="p-2 border-r border-slate-200 w-10 text-center">#</th>
                <th className="p-2 border-r border-slate-200">Cable Grade / Standard</th>
                <th className="p-2 border-r border-slate-200 text-center">Cores</th>
                <th className="p-2 border-r border-slate-200">Colour Sequence (Comma Separated)</th>
                <th className="p-2 text-center w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {colourMap.map((item, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="p-2 border-r border-slate-100 text-center text-slate-400 font-mono">
                    {idx + 1}
                  </td>
                  <td className="p-2 border-r border-slate-100">
                    <input
                      type="text"
                      value={item.grade}
                      onChange={e => handleUpdateColourField(idx, 'grade', e.target.value)}
                      className="w-40 px-2 py-1 border border-slate-300 rounded font-semibold text-xs bg-white focus:border-blue-600 focus:outline-none"
                    />
                  </td>
                  <td className="p-2 border-r border-slate-100 text-center">
                    <input
                      type="text"
                      value={item.cores}
                      onChange={e => handleUpdateColourField(idx, 'cores', e.target.value)}
                      className="w-20 px-1 py-1 border border-slate-300 rounded font-semibold text-center text-xs bg-white focus:border-blue-600 focus:outline-none"
                    />
                  </td>
                  <td className="p-2 border-r border-slate-100">
                    <input
                      type="text"
                      value={item.seq}
                      onChange={e => handleUpdateColourField(idx, 'seq', e.target.value)}
                      className="w-full px-2 py-1 border border-slate-300 rounded font-semibold text-xs bg-white focus:border-blue-600 focus:outline-none"
                    />
                  </td>
                  <td className="p-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleDuplicateColourRow(idx)}
                        className="p-1.5 hover:bg-blue-50 text-blue-600 rounded transition-colors"
                        title="Duplicate this row"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteColourRow(idx)}
                        className="p-1.5 hover:bg-red-50 text-red-600 rounded transition-colors"
                        title="Delete this row"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={5} className="p-2 text-center bg-slate-50">
                  <button
                    type="button"
                    onClick={handleAddColourRow}
                    className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold flex items-center gap-1 mx-auto"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Custom Sequence Rule
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. Cable Grade & Size-wise Drum & Packaging Standard */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3 print-card">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
          <div className="font-bold text-slate-900 text-sm">
            📐 Cable Grade & Size-wise Drum & Packaging Standard ({sizeRules.length} Rules)
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAddSizePkgRow}
              className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold flex items-center gap-1 shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5" /> Add Size & Drum Rule
            </button>
            <button
              type="button"
              onClick={() => {
                onUpdateSizeRules(DEFAULT_SIZE_PACKAGING);
                showFeedback('Reset size packaging rules to defaults.');
              }}
              className="text-xs px-2.5 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded font-semibold"
            >
              🔄 Reset Defaults
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Define specific cable grade, size, cores, drum packaging length, and spool size. Matches automatically when entering orders.
        </p>

        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
              <tr>
                <th className="p-2 border-r border-slate-200 w-10 text-center">#</th>
                <th className="p-2 border-r border-slate-200">Cable Grade</th>
                <th className="p-2 border-r border-slate-200 text-center">Cores</th>
                <th className="p-2 border-r border-slate-200">Cable Size</th>
                <th className="p-2 border-r border-slate-200">Drum Size</th>
                <th className="p-2 border-r border-slate-200">Packaging / Drum Length</th>
                <th className="p-2 text-center w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sizeRules.map((rule, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="p-2 border-r border-slate-100 text-center text-slate-400 font-mono">
                    {idx + 1}
                  </td>
                  <td className="p-2 border-r border-slate-100">
                    <input
                      type="text"
                      value={rule.grade || 'H07RN-F'}
                      onChange={e => handleUpdateSizePkgField(idx, 'grade', e.target.value)}
                      className="w-32 px-2 py-1 border border-slate-300 rounded font-semibold text-xs bg-white focus:border-blue-600 focus:outline-none"
                    />
                  </td>
                  <td className="p-2 border-r border-slate-100 text-center">
                    <input
                      type="text"
                      value={rule.cores || '1'}
                      onChange={e => handleUpdateSizePkgField(idx, 'cores', e.target.value)}
                      className="w-16 px-1 py-1 border border-slate-300 rounded font-semibold text-center text-xs bg-white focus:border-blue-600 focus:outline-none"
                    />
                  </td>
                  <td className="p-2 border-r border-slate-100">
                    <input
                      type="text"
                      value={rule.size}
                      onChange={e => handleUpdateSizePkgField(idx, 'size', e.target.value)}
                      className="w-36 px-2 py-1 border border-slate-300 rounded font-semibold text-xs bg-white focus:border-blue-600 focus:outline-none"
                    />
                  </td>
                  <td className="p-2 border-r border-slate-100">
                    <input
                      type="text"
                      value={rule.spool || ''}
                      onChange={e => handleUpdateSizePkgField(idx, 'spool', e.target.value)}
                      placeholder="Auto by OD or e.g. 28 X 12 X 15"
                      className="w-40 px-2 py-1 border border-slate-300 rounded font-semibold text-xs bg-white focus:border-blue-600 focus:outline-none"
                    />
                  </td>
                  <td className="p-2 border-r border-slate-100">
                    <input
                      type="text"
                      value={rule.packaging}
                      onChange={e => handleUpdateSizePkgField(idx, 'packaging', e.target.value)}
                      className="w-36 px-2 py-1 border border-slate-300 rounded font-semibold text-xs bg-white focus:border-blue-600 focus:outline-none"
                    />
                  </td>
                  <td className="p-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleDuplicateSizePkgRow(idx)}
                        className="p-1.5 hover:bg-blue-50 text-blue-600 rounded transition-colors"
                        title="Duplicate this row"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSizePkgRow(idx)}
                        className="p-1.5 hover:bg-red-50 text-red-600 rounded transition-colors"
                        title="Delete this row"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={7} className="p-2 text-center bg-slate-50">
                  <button
                    type="button"
                    onClick={handleAddSizePkgRow}
                    className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold flex items-center gap-1 mx-auto"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Grade, Cores & Size Drum Rule
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Packaging Spool & Pallet Lookup Standard */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3 print-card">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
          <div className="font-bold text-slate-900 text-sm">
            📦 Packaging Spool & Pallet Lookup Standard ({packagingRules.length} Rules)
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAddPkgRow}
              className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold flex items-center gap-1 shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5" /> Add Spool & Pallet Rule
            </button>
            <button
              type="button"
              onClick={() => {
                onUpdatePackagingRules(DEFAULT_PACKAGING_RULES);
                showFeedback('Reset packaging spool & pallet rules to defaults.');
              }}
              className="text-xs px-2.5 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded font-semibold"
            >
              🔄 Reset Defaults
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Edit spool sizes, OD ranges, pallet dimensions, and No. of Bobbins (Bbn) in a pallet directly. All process cards, drum slips, and packing lists update automatically.
        </p>

        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
              <tr>
                <th className="p-2 border-r border-slate-200 w-10 text-center">#</th>
                <th className="p-2 border-r border-slate-200">Spool Size</th>
                <th className="p-2 border-r border-slate-200">Min to Max (1000 mtr)</th>
                <th className="p-2 border-r border-slate-200">Min to Max (500 mtr)</th>
                <th className="p-2 border-r border-slate-200">Pallet Size</th>
                <th className="p-2 border-r border-slate-200 bg-indigo-50/80 text-indigo-950 text-center">
                  No. of Bbn in a Pallet
                </th>
                <th className="p-2 text-center w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {packagingRules.map((rule, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="p-2 border-r border-slate-100 text-center text-slate-400 font-mono">
                    {idx + 1}
                  </td>
                  <td className="p-2 border-r border-slate-100">
                    <input
                      type="text"
                      value={rule.spool}
                      onChange={e => handleUpdatePkgField(idx, 'spool', e.target.value)}
                      className="w-36 px-2 py-1 border border-slate-300 rounded font-semibold text-xs bg-white focus:border-blue-600 focus:outline-none"
                    />
                  </td>
                  <td className="p-2 border-r border-slate-100">
                    <input
                      type="text"
                      value={rule.m1000}
                      onChange={e => handleUpdatePkgField(idx, 'm1000', e.target.value)}
                      className="w-36 px-2 py-1 border border-slate-300 rounded font-semibold text-xs bg-white focus:border-blue-600 focus:outline-none"
                    />
                  </td>
                  <td className="p-2 border-r border-slate-100">
                    <input
                      type="text"
                      value={rule.m500}
                      onChange={e => handleUpdatePkgField(idx, 'm500', e.target.value)}
                      className="w-36 px-2 py-1 border border-slate-300 rounded font-semibold text-xs bg-white focus:border-blue-600 focus:outline-none"
                    />
                  </td>
                  <td className="p-2 border-r border-slate-100">
                    <input
                      type="text"
                      value={rule.pallet}
                      onChange={e => handleUpdatePkgField(idx, 'pallet', e.target.value)}
                      className="w-32 px-2 py-1 border border-slate-300 rounded font-semibold text-xs bg-white focus:border-blue-600 focus:outline-none"
                    />
                  </td>
                  <td className="p-2 border-r border-slate-100 bg-indigo-50/20 text-center">
                    <input
                      type="text"
                      value={rule.bbnPerPallet !== undefined ? String(rule.bbnPerPallet) : '1'}
                      onChange={e => handleUpdatePkgField(idx, 'bbnPerPallet', e.target.value)}
                      placeholder="e.g. 2 or 4"
                      title="Specify how many bobbins / drums fit on 1 pallet for this spool size"
                      className="w-24 px-2 py-1 border border-indigo-300 rounded font-bold text-center text-xs bg-white text-indigo-950 focus:border-indigo-600 focus:outline-none"
                    />
                  </td>
                  <td className="p-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleDuplicatePkgRow(idx)}
                        className="p-1.5 hover:bg-blue-50 text-blue-600 rounded transition-colors"
                        title="Duplicate this row"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeletePkgRow(idx)}
                        className="p-1.5 hover:bg-red-50 text-red-600 rounded transition-colors"
                        title="Delete this row"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={7} className="p-2 text-center bg-slate-50">
                  <button
                    type="button"
                    onClick={handleAddPkgRow}
                    className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold flex items-center gap-1 mx-auto"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Packaging Rule
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Grid: Densities & Ladi Dimensions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 4. Material Densities Manager */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3 print-card">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
            <div className="font-bold text-slate-900 text-sm">
              ⚖️ Material Densities Manager
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleOpenAddDensity}
                className="text-xs px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add Material
              </button>
              <button
                type="button"
                onClick={() => {
                  onUpdateDensities(DEFAULT_DENSITIES);
                  showFeedback('Reset material densities to defaults.');
                }}
                className="text-xs px-2 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded font-semibold"
              >
                🔄 Reset
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Edit density factors directly or add new custom compounds. Calculations update instantly.
          </p>

          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200">
                <tr>
                  <th className="p-2 border-r border-slate-200">Category</th>
                  <th className="p-2 border-r border-slate-200">Material / Grade</th>
                  <th className="p-2 border-r border-slate-200 text-right">Density Factor</th>
                  <th className="p-2 text-center w-20">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="p-2 border-r border-slate-100 font-bold">COPPER</td>
                  <td className="p-2 border-r border-slate-100">COPPER</td>
                  <td className="p-2 border-r border-slate-100 text-right">
                    <input
                      type="number"
                      step="0.01"
                      value={densities.COPPER}
                      onChange={e =>
                        handleInlineDensityChange('COPPER', 'COPPER', e.target.value)
                      }
                      className="w-24 px-2 py-1 border border-slate-300 rounded font-mono font-bold text-right text-blue-700 bg-white"
                    />
                  </td>
                  <td className="p-2 text-center">
                    <button
                      type="button"
                      onClick={() => handleOpenEditDensity('COPPER', 'COPPER', densities.COPPER)}
                      className="p-1.5 hover:bg-slate-100 rounded text-slate-600"
                      title="Edit Copper Density"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
                {Object.entries(densities.INSULATION).map(([name, val]) => (
                  <tr key={`ins-${name}`} className="hover:bg-slate-50">
                    <td className="p-2 border-r border-slate-100 text-teal-700 font-semibold">
                      INSULATION
                    </td>
                    <td className="p-2 border-r border-slate-100 font-bold">{name}</td>
                    <td className="p-2 border-r border-slate-100 text-right">
                      <input
                        type="number"
                        step="0.00001"
                        value={val}
                        onChange={e =>
                          handleInlineDensityChange('INSULATION', name, e.target.value)
                        }
                        className="w-24 px-2 py-1 border border-slate-300 rounded font-mono font-semibold text-right bg-white"
                      />
                    </td>
                    <td className="p-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEditDensity('INSULATION', name, val)}
                          className="p-1.5 hover:bg-slate-100 rounded text-slate-600"
                          title="Edit material"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteDensity('INSULATION', name)}
                          className="p-1.5 hover:bg-red-50 text-red-600 rounded"
                          title="Delete material"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {Object.entries(densities.SHEATH).map(([name, val]) => (
                  <tr key={`sh-${name}`} className="hover:bg-slate-50">
                    <td className="p-2 border-r border-slate-100 text-amber-800 font-semibold">
                      SHEATH
                    </td>
                    <td className="p-2 border-r border-slate-100 font-bold">{name}</td>
                    <td className="p-2 border-r border-slate-100 text-right">
                      <input
                        type="number"
                        step="0.00001"
                        value={val}
                        onChange={e =>
                          handleInlineDensityChange('SHEATH', name, e.target.value)
                        }
                        className="w-24 px-2 py-1 border border-slate-300 rounded font-mono font-semibold text-right bg-white"
                      />
                    </td>
                    <td className="p-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEditDensity('SHEATH', name, val)}
                          className="p-1.5 hover:bg-slate-100 rounded text-slate-600"
                          title="Edit material"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteDensity('SHEATH', name)}
                          className="p-1.5 hover:bg-red-50 text-red-600 rounded"
                          title="Delete material"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 5. Ladi Dimension Lookup Manager */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3 print-card">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
            <div className="font-bold text-slate-900 text-sm">
              🧶 Ladi Dimension Lookup Manager ({ladiDimensions.length} Rules)
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleOpenAddLadi}
                className="text-xs px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add Ladi Rule
              </button>
              <button
                type="button"
                onClick={() => {
                  onUpdateLadiDimensions(DEFAULT_LADI_DIMENSIONS);
                  showFeedback('Reset Ladi dimension rules to defaults.');
                }}
                className="text-xs px-2 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded font-semibold"
              >
                🔄 Reset
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Manage copper stranding and ladi bunch sequences for conductor sizes ≥ 10 SQ MM. Edit inline or add/remove rules.
          </p>

          <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-96">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200 sticky top-0">
                <tr>
                  <th className="p-2 border-r border-slate-200 text-right">Size (SQ MM)</th>
                  <th className="p-2 border-r border-slate-200">Copper Construction</th>
                  <th className="p-2 border-r border-slate-200">Bunch Ladi Sequence</th>
                  <th className="p-2 text-center w-20">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ladiDimensions.map((rule, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="p-2 border-r border-slate-100 text-right">
                      <input
                        type="number"
                        step="1"
                        value={rule.size}
                        onChange={e => handleUpdateLadiField(idx, 'size', e.target.value)}
                        className="w-16 px-1.5 py-1 border border-slate-300 rounded font-bold text-right bg-white"
                      />
                    </td>
                    <td className="p-2 border-r border-slate-100">
                      <input
                        type="text"
                        value={rule.conductor}
                        onChange={e => handleUpdateLadiField(idx, 'conductor', e.target.value)}
                        className="w-28 px-2 py-1 border border-slate-300 rounded font-mono text-[11px] bg-white"
                      />
                    </td>
                    <td className="p-2 border-r border-slate-100">
                      <input
                        type="text"
                        value={rule.pattern}
                        onChange={e => handleUpdateLadiField(idx, 'pattern', e.target.value)}
                        className="w-28 px-2 py-1 border border-slate-300 rounded font-bold text-blue-700 bg-white"
                      />
                    </td>
                    <td className="p-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEditLadi(idx, rule)}
                          className="p-1.5 hover:bg-slate-100 rounded text-slate-600"
                          title="Edit Ladi rule in modal"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteLadi(idx)}
                          className="p-1.5 hover:bg-red-50 text-red-600 rounded"
                          title="Delete Ladi rule"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 6. IS-694 Grade Only — Master Carton & Mix Colour Carton Packing Standards (Stored in Backup) */}
      <div className="bg-white border-2 border-rose-800 rounded-xl p-4 shadow-xs space-y-3 print-card">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-rose-200">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-rose-800 text-white shadow-2xs">
              <Box className="w-4 h-4" />
            </span>
            <div>
              <div className="font-black text-rose-950 text-sm uppercase tracking-wide">
                📦 6. IS-694 Master Carton &amp; Mix Colour Carton Packing Standards (Vihan Opto, Triguard &amp; Maru Miracle)
              </div>
              <div className="text-xs text-slate-600">
                Stored permanently in <strong>Tab 12: Backup</strong> — any edits here automatically synchronize with <strong>Tab 1 (Active Orders Sheet)</strong> and <strong>Tab 6 (IS-694 Individual Packing Table)</strong> in real time.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setVihanCartonRules(DEFAULT_VIHAN_TRIGUARD_CARTON_RULES);
              setMaruCartonRules(DEFAULT_MARU_MIRACLE_CARTON_RULES);
              saveVihanTriguardCartonRules(DEFAULT_VIHAN_TRIGUARD_CARTON_RULES);
              saveMaruMiracleCartonRules(DEFAULT_MARU_MIRACLE_CARTON_RULES);
              onUpdateVihanRules?.(DEFAULT_VIHAN_TRIGUARD_CARTON_RULES);
              onUpdateMaruRules?.(DEFAULT_MARU_MIRACLE_CARTON_RULES);
              showFeedback('Reset IS-694 Master Carton & Mix Colour Carton rules to factory defaults.');
            }}
            className="text-xs px-3 py-1.5 bg-rose-50 text-rose-900 hover:bg-rose-100 border border-rose-300 rounded font-bold"
          >
            🔄 Reset IS-694 Carton Defaults
          </button>
        </div>

        <Is694CartonMasterTables
          vihanRules={vihanCartonRules}
          maruRules={maruCartonRules}
          onUpdateVihanRules={next => {
            setVihanCartonRules(next);
            saveVihanTriguardCartonRules(next);
            onUpdateVihanRules?.(next);
          }}
          onUpdateMaruRules={next => {
            setMaruCartonRules(next);
            saveMaruMiracleCartonRules(next);
            onUpdateMaruRules?.(next);
          }}
        />
      </div>

      {/* Density Modal */}
      {isDensityModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 text-slate-800">
            <h3 className="text-base font-bold text-slate-900 mb-3">
              {denEditKey ? 'Edit Material Density' : 'Add New Material Density'}
            </h3>
            <form onSubmit={handleSaveDensity} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">
                  Category *
                </label>
                <select
                  value={denCat}
                  onChange={e => setDenCat(e.target.value as any)}
                  disabled={denCat === 'COPPER'}
                  className="w-full p-2 border border-slate-300 rounded font-semibold bg-white"
                >
                  <option value="INSULATION">INSULATION</option>
                  <option value="SHEATH">SHEATH</option>
                  <option value="COPPER">COPPER</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">
                  Material / Grade Name *
                </label>
                <input
                  type="text"
                  value={denName}
                  onChange={e => setDenName(e.target.value)}
                  disabled={denCat === 'COPPER'}
                  placeholder="e.g. XLPE-01 or PVC-FR"
                  className="w-full p-2 border border-slate-300 rounded font-bold"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">
                  Density Factor (per Meter) *
                </label>
                <input
                  type="number"
                  step="0.00001"
                  value={denFactor}
                  onChange={e => setDenFactor(e.target.value)}
                  placeholder="e.g. 0.00135"
                  className="w-full p-2 border border-slate-300 rounded font-bold text-blue-700"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsDensityModalOpen(false)}
                  className="px-3 py-1.5 border border-slate-300 rounded text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold"
                >
                  Save Material
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Ladi Modal */}
      {isLadiModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 text-slate-800">
            <h3 className="text-base font-bold text-slate-900 mb-3">
              {ladiEditIdx !== null ? 'Edit Ladi Dimension Rule' : 'Add Ladi Dimension Rule'}
            </h3>
            <form onSubmit={handleSaveLadi} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">
                  Size (SQ MM) *
                </label>
                <input
                  type="number"
                  step="1"
                  value={ladiSize}
                  onChange={e => setLadiSize(e.target.value)}
                  placeholder="e.g. 70"
                  className="w-full p-2 border border-slate-300 rounded font-bold"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">
                  Copper Construction *
                </label>
                <input
                  type="text"
                  value={ladiCond}
                  onChange={e => setLadiCond(e.target.value)}
                  placeholder="e.g. 840/0.266"
                  className="w-full p-2 border border-slate-300 rounded font-semibold"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-0.5">
                  Bunch Ladi Sequence Pattern *
                </label>
                <input
                  type="text"
                  value={ladiPattern}
                  onChange={e => setLadiPattern(e.target.value)}
                  placeholder="e.g. 42*20 or 93*8+101*4"
                  className="w-full p-2 border border-slate-300 rounded font-bold text-blue-700"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsLadiModalOpen(false)}
                  className="px-3 py-1.5 border border-slate-300 rounded text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold"
                >
                  Save Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
