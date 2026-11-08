import React, { useState } from 'react';
import { CableOrder, DensitySettings, LadiDimensionRule } from '../types/cable';
import { computeRecordRow, fmtExact, getOrderProgressStats, isOrderComplete } from '../utils/calculations';
import { Calculator, FileDown, Printer, Sliders, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

type RecordSortField =
  | 'recRow'
  | 'batch'
  | 'status'
  | 'brand'
  | 'size'
  | 'cores'
  | 'conductor'
  | 'cuArea'
  | 'bunchDia'
  | 'nozzle'
  | 'coreOd'
  | 'coreThickness'
  | 'insDie'
  | 'ins_compound'
  | 'twistingDia'
  | 'strandingDie'
  | 'extNozzle'
  | 'finalDia'
  | 'finalDie'
  | 'sheath_compound'
  | 'orderLen'
  | 'reqCoreLen'
  | 'reqCu'
  | 'reqIns'
  | 'reqSheath';

interface TabRecordProps {
  orders: CableOrder[];
  densities: DensitySettings;
  ladiDimensions: LadiDimensionRule[];
}

export const TabRecord: React.FC<TabRecordProps> = ({ orders, densities, ladiDimensions }) => {
  const [filterBatch, setFilterBatch] = useState('');
  const [printFriendly, setPrintFriendly] = useState(false);
  const [sortField, setSortField] = useState<RecordSortField | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const uniqueBatches = Array.from(new Set(orders.map(o => o.batch))).sort();

  const handleSortColumn = (field: RecordSortField) => {
    if (sortField === field) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        setSortField(null);
        setSortDirection('asc');
      }
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const renderSortIcon = (field: RecordSortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-slate-400 opacity-70 group-hover:opacity-100 shrink-0 inline-block ml-1" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-blue-600 shrink-0 inline-block ml-1" />
    ) : (
      <ArrowDown className="w-3 h-3 text-blue-600 shrink-0 inline-block ml-1" />
    );
  };

  const parseCableSizeNumeric = (sizeStr: string): number => {
    const match = String(sizeStr || '').match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : 0;
  };

  const baseFiltered = orders.filter(o => !filterBatch || o.batch === filterBatch);

  const filtered = [...baseFiltered].sort((a, b) => {
    if (!sortField) return 0;
    const dir = sortDirection === 'asc' ? 1 : -1;
    const rA = computeRecordRow(a, densities, ladiDimensions);
    const rB = computeRecordRow(b, densities, ladiDimensions);

    switch (sortField) {
      case 'recRow':
        return ((rA.record_row || a.id || 0) - (rB.record_row || b.id || 0)) * dir;
      case 'batch':
        return (
          String(rA.batch || '').localeCompare(String(rB.batch || ''), undefined, {
            numeric: true,
            sensitivity: 'base',
          }) * dir
        );
      case 'status': {
        const doneA = isOrderComplete(a, ladiDimensions) ? 1 : 0;
        const doneB = isOrderComplete(b, ladiDimensions) ? 1 : 0;
        if (doneA !== doneB) return (doneA - doneB) * dir;
        const stA = getOrderProgressStats(a, ladiDimensions);
        const stB = getOrderProgressStats(b, ladiDimensions);
        return (stA.percentage - stB.percentage) * dir;
      }
      case 'brand':
        return (
          String(rA.brand || '').localeCompare(String(rB.brand || ''), undefined, {
            numeric: true,
            sensitivity: 'base',
          }) * dir
        );
      case 'size': {
        const szDiff = parseCableSizeNumeric(rA.size) - parseCableSizeNumeric(rB.size);
        if (szDiff !== 0) return szDiff * dir;
        return ((rA.cores || 0) - (rB.cores || 0)) * dir;
      }
      case 'cores':
        return ((rA.cores || 0) - (rB.cores || 0)) * dir;
      case 'conductor':
        return (
          String(rA.conductor || '').localeCompare(String(rB.conductor || ''), undefined, {
            numeric: true,
            sensitivity: 'base',
          }) * dir
        );
      case 'cuArea':
        return ((rA.cuArea || 0) - (rB.cuArea || 0)) * dir;
      case 'bunchDia':
        return ((rA.bunchDia || 0) - (rB.bunchDia || 0)) * dir;
      case 'nozzle':
        return ((rA.nozzle || 0) - (rB.nozzle || 0)) * dir;
      case 'coreOd':
        return ((rA.coreOd || 0) - (rB.coreOd || 0)) * dir;
      case 'coreThickness':
        return ((rA.coreThickness || 0) - (rB.coreThickness || 0)) * dir;
      case 'insDie':
        return ((rA.insDie || 0) - (rB.insDie || 0)) * dir;
      case 'ins_compound':
        return String(rA.ins_compound || '').localeCompare(String(rB.ins_compound || '')) * dir;
      case 'twistingDia':
        return ((rA.twistingDia || 0) - (rB.twistingDia || 0)) * dir;
      case 'strandingDie':
        return ((rA.strandingDie || 0) - (rB.strandingDie || 0)) * dir;
      case 'extNozzle':
        return ((rA.extNozzle || 0) - (rB.extNozzle || 0)) * dir;
      case 'finalDia':
        return ((rA.finalDia || 0) - (rB.finalDia || 0)) * dir;
      case 'finalDie':
        return ((rA.finalDie || 0) - (rB.finalDie || 0)) * dir;
      case 'sheath_compound':
        return String(rA.sheath_compound || '').localeCompare(String(rB.sheath_compound || '')) * dir;
      case 'orderLen':
        return ((rA.orderLen || 0) - (rB.orderLen || 0)) * dir;
      case 'reqCoreLen':
        return ((rA.reqCoreLen || 0) - (rB.reqCoreLen || 0)) * dir;
      case 'reqCu':
        return ((rA.reqCu || 0) - (rB.reqCu || 0)) * dir;
      case 'reqIns':
        return ((rA.reqIns || 0) - (rB.reqIns || 0)) * dir;
      case 'reqSheath':
        return ((rA.reqSheath || 0) - (rB.reqSheath || 0)) * dir;
      default:
        return 0;
    }
  });

  const handleDownloadPdf = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('PLUTUS CABLE PRODUCTION & REQUISITION SYSTEM — MASTER ENGINEERING RECORD', 10, 10);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `Batch Filter: ${filterBatch || 'All Batches'} | Total Orders: ${filtered.length} | Generated: ${new Date().toLocaleString('en-GB')}`,
      10,
      15
    );

    const headers = printFriendly
      ? [
          'Batch',
          'Brand',
          'Size',
          'Core',
          'Conductor',
          'Nozzle (P)',
          'Core OD (Q)',
          'Ins Die (S)',
          'Ins Grade',
          'Twisting (U)',
          'Stranding (V)',
          'Ext Nozzle (X)',
          'Final Dia (Y)',
          'Final Die (Z)',
          'Sheath Grade',
          'Order Len (m)',
          'Req Core Len',
          'Req Cu (kg)',
          'Req Ins (kg)',
          'Req Sheath (kg)',
        ]
      : [
          'Rec Row',
          'Batch',
          'Status',
          'Brand',
          'Size',
          'Core',
          'Conductor',
          'Cu Area',
          'Bunch Dia',
          'Nozzle (P)',
          'Core OD (Q)',
          'Ins Die (S)',
          'Ins Grade',
          'Twist Dia (U)',
          'Strand Die (V)',
          'Ext Noz (X)',
          'Final Dia (Y)',
          'Final Die (Z)',
          'Sheath Grade',
          'Order Len',
          'Req Core Len',
          'Req Cu (kg)',
          'Req Ins (kg)',
          'Req Sheath (kg)',
        ];

    const body = filtered.map((o, idx) => {
      const r = computeRecordRow(o, densities, ladiDimensions);
      const done = isOrderComplete(o, ladiDimensions);
      if (printFriendly) {
        return [
          r.batch,
          r.brand,
          r.size,
          r.cores,
          r.conductor,
          fmtExact(r.nozzle, 4),
          fmtExact(r.coreOd, 4),
          fmtExact(r.insDie, 4),
          r.ins_compound,
          fmtExact(r.twistingDia, 4),
          fmtExact(r.strandingDie, 4),
          fmtExact(r.extNozzle, 4),
          fmtExact(r.finalDia, 4),
          fmtExact(r.finalDie, 4),
          r.sheath_compound || '-',
          r.orderLen.toLocaleString(),
          r.reqCoreLen.toLocaleString(),
          fmtExact(r.reqCu, 2),
          fmtExact(r.reqIns, 2),
          fmtExact(r.reqSheath, 2),
        ];
      }
      return [
        `R${r.record_row || idx + 12}`,
        r.batch,
        done ? 'Done' : 'Active',
        r.brand,
        r.size,
        r.cores,
        r.conductor,
        fmtExact(r.cuArea, 4),
        fmtExact(r.bunchDia, 4),
        fmtExact(r.nozzle, 4),
        fmtExact(r.coreOd, 4),
        fmtExact(r.insDie, 4),
        r.ins_compound,
        fmtExact(r.twistingDia, 4),
        fmtExact(r.strandingDie, 4),
        fmtExact(r.extNozzle, 4),
        fmtExact(r.finalDia, 4),
        fmtExact(r.finalDie, 4),
        r.sheath_compound || '-',
        r.orderLen.toLocaleString(),
        r.reqCoreLen.toLocaleString(),
        fmtExact(r.reqCu, 2),
        fmtExact(r.reqIns, 2),
        fmtExact(r.reqSheath, 2),
      ];
    });

    autoTable(doc, {
      startY: 18,
      head: [headers],
      body,
      styles: { fontSize: 6.5, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 8, right: 8 },
    });

    doc.save(`PLUTUS_Master_Engineering_Record_${filterBatch || 'All_Batches'}.pdf`);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs print-card">
      <div className="flex flex-wrap items-center justify-between pb-3 mb-3 border-b border-slate-200 gap-2">
        <div className="flex items-center gap-2 font-bold text-slate-900 text-sm">
          <Calculator className="w-4 h-4 text-blue-600" />
          <span>📐 Master Engineering &amp; Material Calculation Record (Exact Sheet Formulas &amp; Precision)</span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-slate-100 border border-slate-300 rounded-lg px-2 py-1 no-print">
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-600" />
            <span className="text-[11px] font-bold text-slate-700">Sort:</span>
            <button
              type="button"
              onClick={() => handleSortColumn('batch')}
              className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer transition-colors ${
                sortField === 'batch'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-300'
              }`}
            >
              Batch {sortField === 'batch' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
            </button>
            <button
              type="button"
              onClick={() => handleSortColumn('size')}
              className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer transition-colors ${
                sortField === 'size'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-300'
              }`}
            >
              Size {sortField === 'size' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
            </button>
            <button
              type="button"
              onClick={() => handleSortColumn('status')}
              className={`px-2 py-0.5 rounded text-[11px] font-bold cursor-pointer transition-colors ${
                sortField === 'status'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-300'
              }`}
            >
              Status {sortField === 'status' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
            </button>
            {sortField && (
              <button
                type="button"
                onClick={() => {
                  setSortField(null);
                  setSortDirection('asc');
                }}
                className="px-1.5 py-0.5 rounded bg-rose-100 hover:bg-rose-200 text-rose-800 text-[10.5px] font-bold cursor-pointer"
                title="Reset column sorting to default order"
              >
                Reset
              </button>
            )}
          </div>

          <select
            value={filterBatch}
            onChange={(e) => setFilterBatch(e.target.value)}
            className="text-xs px-2.5 py-1.5 border border-slate-300 rounded font-semibold bg-white"
          >
            <option value="">All Batches</option>
            {uniqueBatches.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setPrintFriendly(prev => !prev)}
            className={`text-xs px-2.5 py-1.5 rounded font-bold flex items-center gap-1.5 border transition-colors no-print cursor-pointer ${
              printFriendly
                ? 'bg-emerald-600 text-white border-emerald-700 shadow-2xs'
                : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
            }`}
            title="Toggle Print-Friendly A4 View (hides Rec Row, Status, and intermediate Ladi sub-columns)"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>{printFriendly ? 'A4 Print-Friendly: ON' : 'A4 Print-Friendly Toggle'}</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadPdf}
            className="text-xs px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-bold flex items-center gap-1.5 shadow-2xs no-print cursor-pointer"
            title="Download Master Engineering Record as a formatted A4 Landscape PDF"
          >
            <FileDown className="w-3.5 h-3.5" /> Download as PDF
          </button>

          <button
            onClick={() => window.print()}
            className="text-xs px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold flex items-center gap-1 shadow-2xs no-print"
            title="Print current page document"
          >
            <Printer className="w-3.5 h-3.5" /> Print current page
          </button>
        </div>
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-xs text-left whitespace-nowrap">
          <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[11px] border-b border-slate-200 select-none">
            <tr>
              {!printFriendly && (
                <th
                  onClick={() => handleSortColumn('recRow')}
                  className={`p-2 border-r border-slate-200 cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                    sortField === 'recRow' ? 'bg-blue-50 text-blue-900' : ''
                  }`}
                  title="Click to sort by Record Row"
                >
                  <span>Rec Row</span>
                  {renderSortIcon('recRow')}
                </th>
              )}
              <th
                onClick={() => handleSortColumn('batch')}
                className={`p-2 border-r border-slate-200 cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                  sortField === 'batch' ? 'bg-blue-50 text-blue-900' : ''
                }`}
                title="Click to sort by Batch"
              >
                <span>Batch</span>
                {renderSortIcon('batch')}
              </th>
              {!printFriendly && (
                <th
                  onClick={() => handleSortColumn('status')}
                  className={`p-2 border-r border-slate-200 cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                    sortField === 'status' ? 'bg-blue-50 text-blue-900' : ''
                  }`}
                  title="Click to sort by Status (Active / Done)"
                >
                  <span>Status</span>
                  {renderSortIcon('status')}
                </th>
              )}
              <th
                onClick={() => handleSortColumn('brand')}
                className={`p-2 border-r border-slate-200 cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                  sortField === 'brand' ? 'bg-blue-50 text-blue-900' : ''
                }`}
                title="Click to sort by Brand"
              >
                <span>Brand</span>
                {renderSortIcon('brand')}
              </th>
              <th
                onClick={() => handleSortColumn('size')}
                className={`p-2 border-r border-slate-200 cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                  sortField === 'size' ? 'bg-blue-50 text-blue-900' : ''
                }`}
                title="Click to sort by Cable Size (SQ MM)"
              >
                <span>Size</span>
                {renderSortIcon('size')}
              </th>
              <th
                onClick={() => handleSortColumn('cores')}
                className={`p-2 border-r border-slate-200 text-right cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                  sortField === 'cores' ? 'bg-blue-50 text-blue-900' : ''
                }`}
                title="Click to sort by Number of Cores"
              >
                <span>No of Core</span>
                {renderSortIcon('cores')}
              </th>
              <th
                onClick={() => handleSortColumn('conductor')}
                className={`p-2 border-r border-slate-200 cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                  sortField === 'conductor' ? 'bg-blue-50 text-blue-900' : ''
                }`}
                title="Click to sort by Conductor"
              >
                <span>Conductor</span>
                {renderSortIcon('conductor')}
              </th>
              {!printFriendly && <th className="p-2 border-r border-slate-200 text-right">Sub Cu 1</th>}
              {!printFriendly && <th className="p-2 border-r border-slate-200 text-right">F2</th>}
              {!printFriendly && <th className="p-2 border-r border-slate-200 text-right">Sub Cu 2</th>}
              {!printFriendly && <th className="p-2 border-r border-slate-200 text-right">H2</th>}
              {!printFriendly && <th className="p-2 border-r border-slate-200 text-right">Ladi Dia 1</th>}
              {!printFriendly && <th className="p-2 border-r border-slate-200 text-right">Ladi Dia 2</th>}
              {!printFriendly && <th className="p-2 border-r border-slate-200 text-right">Ladi Lay</th>}
              <th
                onClick={() => handleSortColumn('cuArea')}
                className={`p-2 border-r border-slate-200 text-right cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                  sortField === 'cuArea' ? 'bg-blue-50 text-blue-900' : ''
                }`}
                title="Click to sort by Cu Area"
              >
                <span>Cu Area</span>
                {renderSortIcon('cuArea')}
              </th>
              <th
                onClick={() => handleSortColumn('bunchDia')}
                className={`p-2 border-r border-slate-200 text-right cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                  sortField === 'bunchDia' ? 'bg-blue-50 text-blue-900' : ''
                }`}
                title="Click to sort by Bunch Dia"
              >
                <span>Bunch Dia</span>
                {renderSortIcon('bunchDia')}
              </th>
              {!printFriendly && <th className="p-2 border-r border-slate-200 text-right">Bunch Lay</th>}
              <th
                onClick={() => handleSortColumn('nozzle')}
                className="p-2 border-r border-slate-200 text-right bg-blue-50 text-blue-900 font-bold cursor-pointer hover:bg-blue-100/80 transition-colors group"
                title="Click to sort by Nozzle (P)"
              >
                <span>Nozzle (P)</span>
                {renderSortIcon('nozzle')}
              </th>
              <th
                onClick={() => handleSortColumn('coreOd')}
                className="p-2 border-r border-slate-200 text-right bg-blue-50 text-blue-900 font-bold cursor-pointer hover:bg-blue-100/80 transition-colors group"
                title="Click to sort by PVC Core OD (Q)"
              >
                <span>PVC Core OD (Q)</span>
                {renderSortIcon('coreOd')}
              </th>
              <th
                onClick={() => handleSortColumn('coreThickness')}
                className={`p-2 border-r border-slate-200 text-right cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                  sortField === 'coreThickness' ? 'bg-blue-50 text-blue-900' : ''
                }`}
                title="Click to sort by Core Thickness (R)"
              >
                <span>Core Thick. (R)</span>
                {renderSortIcon('coreThickness')}
              </th>
              <th
                onClick={() => handleSortColumn('insDie')}
                className="p-2 border-r border-slate-200 text-right bg-blue-50 text-blue-900 font-bold cursor-pointer hover:bg-blue-100/80 transition-colors group"
                title="Click to sort by Ins. Die (S)"
              >
                <span>Ins. Die (S)</span>
                {renderSortIcon('insDie')}
              </th>
              <th
                onClick={() => handleSortColumn('ins_compound')}
                className={`p-2 border-r border-slate-200 cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                  sortField === 'ins_compound' ? 'bg-blue-50 text-blue-900' : ''
                }`}
                title="Click to sort by Ins. Grade"
              >
                <span>Ins. Grade</span>
                {renderSortIcon('ins_compound')}
              </th>
              <th
                onClick={() => handleSortColumn('twistingDia')}
                className="p-2 border-r border-slate-200 text-right bg-indigo-50 text-indigo-900 font-bold cursor-pointer hover:bg-indigo-100/80 transition-colors group"
                title="Click to sort by Twisting Dia (U)"
              >
                <span>Twisting Dia (U)</span>
                {renderSortIcon('twistingDia')}
              </th>
              <th
                onClick={() => handleSortColumn('strandingDie')}
                className="p-2 border-r border-slate-200 text-right bg-indigo-50 text-indigo-900 font-bold cursor-pointer hover:bg-indigo-100/80 transition-colors group"
                title="Click to sort by Stranding Die (V)"
              >
                <span>Stranding Die (V)</span>
                {renderSortIcon('strandingDie')}
              </th>
              {!printFriendly && <th className="p-2 border-r border-slate-200 text-right">Lay Length (W)</th>}
              <th
                onClick={() => handleSortColumn('extNozzle')}
                className="p-2 border-r border-slate-200 text-right bg-amber-50 text-amber-900 font-bold cursor-pointer hover:bg-amber-100/80 transition-colors group"
                title="Click to sort by Ext. Nozzle (X)"
              >
                <span>Ext. Nozzle (X)</span>
                {renderSortIcon('extNozzle')}
              </th>
              <th
                onClick={() => handleSortColumn('finalDia')}
                className="p-2 border-r border-slate-200 text-right bg-amber-50 text-amber-900 font-bold cursor-pointer hover:bg-amber-100/80 transition-colors group"
                title="Click to sort by Final/Cable Dia (Y)"
              >
                <span>Final/Cable Dia (Y)</span>
                {renderSortIcon('finalDia')}
              </th>
              <th
                onClick={() => handleSortColumn('finalDie')}
                className="p-2 border-r border-slate-200 text-right bg-amber-50 text-amber-900 font-bold cursor-pointer hover:bg-amber-100/80 transition-colors group"
                title="Click to sort by Final Die (Z)"
              >
                <span>Final Die (Z)</span>
                {renderSortIcon('finalDie')}
              </th>
              <th
                onClick={() => handleSortColumn('sheath_compound')}
                className={`p-2 border-r border-slate-200 cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                  sortField === 'sheath_compound' ? 'bg-blue-50 text-blue-900' : ''
                }`}
                title="Click to sort by Sheath Grade"
              >
                <span>Sheath Grade</span>
                {renderSortIcon('sheath_compound')}
              </th>
              <th
                onClick={() => handleSortColumn('orderLen')}
                className={`p-2 border-r border-slate-200 text-right cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                  sortField === 'orderLen' ? 'bg-blue-50 text-blue-900' : ''
                }`}
                title="Click to sort by Order Len (m)"
              >
                <span>Order Len (m)</span>
                {renderSortIcon('orderLen')}
              </th>
              <th
                onClick={() => handleSortColumn('reqCoreLen')}
                className={`p-2 border-r border-slate-200 text-right font-bold cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                  sortField === 'reqCoreLen' ? 'bg-blue-50 text-blue-900' : ''
                }`}
                title="Click to sort by Req Core Len (m)"
              >
                <span>Req Core Len (m)</span>
                {renderSortIcon('reqCoreLen')}
              </th>
              <th
                onClick={() => handleSortColumn('reqCu')}
                className={`p-2 border-r border-slate-200 text-right cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                  sortField === 'reqCu' ? 'bg-blue-50 text-blue-900' : ''
                }`}
                title="Click to sort by Req Cu (kg)"
              >
                <span>Req Cu (kg)</span>
                {renderSortIcon('reqCu')}
              </th>
              <th
                onClick={() => handleSortColumn('reqIns')}
                className={`p-2 border-r border-slate-200 text-right cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                  sortField === 'reqIns' ? 'bg-blue-50 text-blue-900' : ''
                }`}
                title="Click to sort by Req Ins. (kg)"
              >
                <span>Req Ins. (kg)</span>
                {renderSortIcon('reqIns')}
              </th>
              <th
                onClick={() => handleSortColumn('reqSheath')}
                className={`p-2 text-right cursor-pointer hover:bg-slate-200/80 transition-colors group ${
                  sortField === 'reqSheath' ? 'bg-blue-50 text-blue-900' : ''
                }`}
                title="Click to sort by Req Sheath (kg)"
              >
                <span>Req Sheath (kg)</span>
                {renderSortIcon('reqSheath')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={printFriendly ? 23 : 34} className="p-6 text-center text-slate-500">
                  No orders in the Master Record. Add a new order in 1. Active Orders to calculate engineering dimensions and material weights.
                </td>
              </tr>
            ) : (
              filtered.map((o, idx) => {
                const r = computeRecordRow(o, densities, ladiDimensions);
                const done = isOrderComplete(o, ladiDimensions);
                return (
                  <tr key={o.id} className="hover:bg-slate-50 transition-colors">
                    {!printFriendly && <td className="p-2 border-r border-slate-100 font-mono text-[11px]">R{r.record_row || (idx + 12)}</td>}
                    <td className="p-2 border-r border-slate-100 font-bold">{r.batch}</td>
                    {!printFriendly && (
                      <td className="p-2 border-r border-slate-100">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${done ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                          {done ? 'Done' : 'Active'}
                        </span>
                      </td>
                    )}
                    <td className="p-2 border-r border-slate-100">{r.brand}</td>
                    <td className="p-2 border-r border-slate-100 font-bold">{r.size}</td>
                    <td className="p-2 border-r border-slate-100 text-right">{r.cores}</td>
                    <td className="p-2 border-r border-slate-100 font-mono text-[11px]">{r.conductor}</td>
                    {!printFriendly && <td className="p-2 border-r border-slate-100 text-right">{r.sub1 || '-'}</td>}
                    {!printFriendly && <td className="p-2 border-r border-slate-100 text-right">{r.f2 || '-'}</td>}
                    {!printFriendly && <td className="p-2 border-r border-slate-100 text-right">{r.sub2 || '-'}</td>}
                    {!printFriendly && <td className="p-2 border-r border-slate-100 text-right">{r.h2 || '-'}</td>}
                    {!printFriendly && <td className="p-2 border-r border-slate-100 text-right">{fmtExact(r.ladiDia1, 6)}</td>}
                    {!printFriendly && <td className="p-2 border-r border-slate-100 text-right">{fmtExact(r.ladiDia2, 6)}</td>}
                    {!printFriendly && <td className="p-2 border-r border-slate-100 text-right">{r.ladiLay || '-'}</td>}
                    <td className="p-2 border-r border-slate-100 text-right">{fmtExact(r.cuArea, 6)}</td>
                    <td className="p-2 border-r border-slate-100 text-right">{fmtExact(r.bunchDia, 6)}</td>
                    {!printFriendly && <td className="p-2 border-r border-slate-100 text-right">{fmtExact(r.bunchLay, 6)}</td>}
                    <td className="p-2 border-r border-slate-100 text-right bg-blue-50/70 font-semibold text-blue-900">{fmtExact(r.nozzle, 6)}</td>
                    <td className="p-2 border-r border-slate-100 text-right bg-blue-50/70 font-bold text-blue-900">{fmtExact(r.coreOd, 4)}</td>
                    <td className="p-2 border-r border-slate-100 text-right">{fmtExact(r.coreThickness, 6)}</td>
                    <td className="p-2 border-r border-slate-100 text-right bg-blue-50/70 font-bold text-blue-900">{fmtExact(r.insDie, 4)}</td>
                    <td className="p-2 border-r border-slate-100">{r.ins_compound}</td>
                    <td className="p-2 border-r border-slate-100 text-right bg-indigo-50/70 font-semibold text-indigo-900">{fmtExact(r.twistingDia, 4)}</td>
                    <td className="p-2 border-r border-slate-100 text-right bg-indigo-50/70 font-bold text-indigo-900">{fmtExact(r.strandingDie, 4)}</td>
                    {!printFriendly && <td className="p-2 border-r border-slate-100 text-right">{r.layLength || '-'}</td>}
                    <td className="p-2 border-r border-slate-100 text-right bg-amber-50/70 font-bold text-amber-950">{fmtExact(r.extNozzle, 5)}</td>
                    <td className="p-2 border-r border-slate-100 text-right bg-amber-50/70 font-bold text-amber-950">{fmtExact(r.finalDia, 4)}</td>
                    <td className="p-2 border-r border-slate-100 text-right bg-amber-50/70 font-bold text-amber-950">{fmtExact(r.finalDie, 4)}</td>
                    <td className="p-2 border-r border-slate-100">{r.sheath_compound || '-'}</td>
                    <td className="p-2 border-r border-slate-100 text-right">{r.orderLen.toLocaleString()}</td>
                    <td className="p-2 border-r border-slate-100 text-right font-bold text-slate-900">{r.reqCoreLen.toLocaleString()}</td>
                    <td className="p-2 border-r border-slate-100 text-right font-medium">{fmtExact(r.reqCu, 4)}</td>
                    <td className="p-2 border-r border-slate-100 text-right font-medium">{fmtExact(r.reqIns, 4)}</td>
                    <td className="p-2 text-right font-medium">{fmtExact(r.reqSheath, 4)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
