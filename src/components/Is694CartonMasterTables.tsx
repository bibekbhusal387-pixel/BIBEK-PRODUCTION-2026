import React, { useState } from 'react';
import {
  DEFAULT_MARU_MIRACLE_CARTON_RULES,
  DEFAULT_VIHAN_TRIGUARD_CARTON_RULES,
  formatMixFormulaNumbers,
  MaruMiracleCartonRule,
  MixCartonBreakdown,
  sumMixBreakdown,
  VihanTriguardCartonRule,
} from '../utils/is694CartonPackaging';
import { Box, Plus, RotateCcw, Trash2, Edit3 } from 'lucide-react';

interface Is694CartonMasterTablesProps {
  vihanRules: VihanTriguardCartonRule[];
  maruRules: MaruMiracleCartonRule[];
  onUpdateVihanRules: (rules: VihanTriguardCartonRule[]) => void;
  onUpdateMaruRules: (rules: MaruMiracleCartonRule[]) => void;
  compact?: boolean;
}

export const Is694CartonMasterTables: React.FC<Is694CartonMasterTablesProps> = ({
  vihanRules,
  maruRules,
  onUpdateVihanRules,
  onUpdateMaruRules,
  compact = false,
}) => {
  const [activeSheet, setActiveSheet] = useState<'BOTH' | 'VIHAN' | 'MARU'>('BOTH');

  const handleVihanCellChange = (
    idx: number,
    field: keyof Omit<VihanTriguardCartonRule, 'mix90m' | 'mix45m'>,
    val: string
  ) => {
    const next = [...vihanRules];
    if (field === 'size') {
      next[idx] = { ...next[idx], size: val };
    } else {
      next[idx] = { ...next[idx], [field]: parseFloat(val) || 0 };
    }
    onUpdateVihanRules(next);
  };

  const handleVihanMixChange = (
    idx: number,
    mixKey: 'mix90m' | 'mix45m',
    col: keyof MixCartonBreakdown,
    val: string
  ) => {
    const next = [...vihanRules];
    const updatedMix = {
      ...next[idx][mixKey],
      [col]: parseFloat(val) || 0,
    };
    next[idx] = {
      ...next[idx],
      [mixKey]: updatedMix,
    };
    onUpdateVihanRules(next);
  };

  const handleAddVihanRow = () => {
    onUpdateVihanRules([
      ...vihanRules,
      {
        size: '16.00 SQ MM',
        opto90m: 2,
        opto45m: 0,
        opto180m: 0,
        triguardBox: 2,
        triguardStack: 2,
        mix90m: { RED: 0, BLACK: 0, BLUE: 0, YELLOW: 0, GREEN: 0 },
        mix45m: { RED: 0, BLACK: 0, BLUE: 0, YELLOW: 0, GREEN: 0 },
      },
    ]);
  };

  const handleDeleteVihanRow = (idx: number) => {
    onUpdateVihanRules(vihanRules.filter((_, i) => i !== idx));
  };

  const handleMaruCellChange = (
    idx: number,
    field: keyof Omit<MaruMiracleCartonRule, 'mix90m' | 'mix45m'>,
    val: string
  ) => {
    const next = [...maruRules];
    if (field === 'size' || field === 'conductor') {
      next[idx] = { ...next[idx], [field]: val };
    } else {
      next[idx] = { ...next[idx], [field]: parseFloat(val) || 0 };
    }
    onUpdateMaruRules(next);
  };

  const handleMaruMixChange = (
    idx: number,
    mixKey: 'mix90m' | 'mix45m',
    col: keyof MixCartonBreakdown,
    val: string
  ) => {
    const next = [...maruRules];
    const currentMix = next[idx][mixKey] || { RED: 0, BLACK: 0, BLUE: 0, YELLOW: 0, GREEN: 0 };
    next[idx] = {
      ...next[idx],
      [mixKey]: {
        ...currentMix,
        [col]: parseFloat(val) || 0,
      },
    };
    onUpdateMaruRules(next);
  };

  const handleAddMaruRow = () => {
    onUpdateMaruRules([
      ...maruRules,
      {
        size: '16.00 SQ MM',
        conductor: '224/0.260',
        insOd: 6.8,
        coils90m: 2,
        coils45m: 0,
        coils180m: 0,
        mix90m: { RED: 0, BLACK: 0, BLUE: 0, YELLOW: 0, GREEN: 0 },
        mix45m: { RED: 0, BLACK: 0, BLUE: 0, YELLOW: 0, GREEN: 0 },
      },
    ]);
  };

  const handleDeleteMaruRow = (idx: number) => {
    onUpdateMaruRules(maruRules.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-4">
      {/* Header switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-rose-50/90 border border-rose-200 rounded-xl p-3">
        <div className="flex items-center gap-2">
          <span className="p-2 rounded-lg bg-rose-700 text-white shadow-2xs">
            <Box className="w-4 h-4" />
          </span>
          <div>
            <h3 className="text-xs sm:text-sm font-black text-rose-950 uppercase tracking-wide flex items-center gap-2">
              <span>IS-694 Grade Only — Editable Master Carton &amp; Mix Colour Carton Standards</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300">
                Live Connected with Order Sheet &amp; Packing List
              </span>
            </h3>
            <p className="text-[11px] text-rose-800">
              Edit any Individual Colour Carton or Mix Colour Carton (`RD+BK+BL+YL+GR`) value below — changes auto-save and immediately update the Order Sheet &amp; IS-694 Packing List.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 no-print">
          <button
            type="button"
            onClick={() => setActiveSheet('BOTH')}
            className={`px-2.5 py-1 rounded text-xs font-extrabold border cursor-pointer transition-colors ${
              activeSheet === 'BOTH'
                ? 'bg-rose-800 text-white border-rose-900'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
            }`}
          >
            Show Both Standards
          </button>
          <button
            type="button"
            onClick={() => setActiveSheet('VIHAN')}
            className={`px-2.5 py-1 rounded text-xs font-extrabold border cursor-pointer transition-colors ${
              activeSheet === 'VIHAN'
                ? 'bg-rose-800 text-white border-rose-900'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
            }`}
          >
            1. Vihan Opto &amp; Triguard
          </button>
          <button
            type="button"
            onClick={() => setActiveSheet('MARU')}
            className={`px-2.5 py-1 rounded text-xs font-extrabold border cursor-pointer transition-colors ${
              activeSheet === 'MARU'
                ? 'bg-rose-800 text-white border-rose-900'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
            }`}
          >
            2. Maru Miracle
          </button>
        </div>
      </div>

      <div className={`grid grid-cols-1 ${activeSheet === 'BOTH' && !compact ? 'xl:grid-cols-2' : ''} gap-4`}>
        {/* SHEET 1: FOR VIHAN OPTO & TRIGUARD */}
        {(activeSheet === 'BOTH' || activeSheet === 'VIHAN') && (
          <div className="border-2 border-slate-800 rounded-xl bg-white overflow-hidden shadow-xs">
            <div className="bg-slate-800 text-white px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-black uppercase tracking-wider text-amber-300">
                  SHEET 1: FOR VIHAN OPTO &amp; TRIGUARD (IS-694 GRADE)
                </div>
                <div className="text-[11px] text-slate-300 font-semibold">
                  Master Cartons Packaging (Individual Colour) &amp; Mix C/S Details (RD+BK+BL+YL+GR)
                </div>
              </div>
              <div className="flex items-center gap-1.5 no-print">
                <button
                  type="button"
                  onClick={handleAddVihanRow}
                  className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Add Size
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateVihanRules(DEFAULT_VIHAN_TRIGUARD_CARTON_RULES)}
                  className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                  title="Reset Vihan Opto & Triguard table to factory default"
                >
                  <RotateCcw className="w-3 h-3" /> Reset
                </button>
              </div>
            </div>

            {/* Part 1A: Master Cartons Packaging (Individual Colour Carton) */}
            <div className="p-2.5 border-b border-slate-200">
              <div className="text-[11px] font-black uppercase text-slate-800 mb-1.5 flex items-center justify-between">
                <span>A. MASTER CARTONS PACKAGING (INDIVIDUAL COLOUR COILS / CARTON)</span>
                <span className="text-[10px] text-slate-500 font-semibold flex items-center gap-1">
                  <Edit3 className="w-3 h-3" /> Click any number to edit
                </span>
              </div>
              <div className="overflow-x-auto border border-slate-300 rounded">
                <table className="w-full text-xs text-left whitespace-nowrap">
                  <thead>
                    <tr className="bg-slate-200 text-slate-900 font-black text-[10px] uppercase border-b border-slate-300">
                      <th rowSpan={2} className="p-2 border-r border-slate-300">SIZE</th>
                      <th colSpan={3} className="p-1.5 border-r border-slate-300 text-center bg-amber-100/80 text-amber-950">
                        OPTO (COILS / CARTON)
                      </th>
                      <th colSpan={2} className="p-1.5 border-r border-slate-300 text-center bg-indigo-100/80 text-indigo-950">
                        TRIGUARD (COILS / CARTON)
                      </th>
                      <th rowSpan={2} className="p-1.5 text-center w-10 no-print">Del</th>
                    </tr>
                    <tr className="bg-slate-100 text-slate-800 font-extrabold text-[10px] uppercase border-b border-slate-300">
                      <th className="p-1.5 border-r border-slate-300 text-center bg-amber-50">90 MTRS</th>
                      <th className="p-1.5 border-r border-slate-300 text-center bg-amber-50">45 MTR</th>
                      <th className="p-1.5 border-r border-slate-300 text-center bg-amber-50">180 MTR</th>
                      <th className="p-1.5 border-r border-slate-300 text-center bg-indigo-50">BOX</th>
                      <th className="p-1.5 border-r border-slate-300 text-center bg-indigo-50">STACK</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {vihanRules.map((r, idx) => (
                      <tr key={`vihan-ind-${idx}`} className="hover:bg-slate-50">
                        <td className="p-1.5 border-r border-slate-200 font-bold">
                          <input
                            type="text"
                            value={r.size}
                            onChange={e => handleVihanCellChange(idx, 'size', e.target.value)}
                            className="w-24 px-1.5 py-0.5 text-xs font-black text-slate-900 border border-slate-200 rounded bg-white"
                          />
                        </td>
                        <td className="p-1.5 border-r border-slate-200 text-center bg-amber-50/30">
                          <input
                            type="number"
                            min="0"
                            value={r.opto90m || ''}
                            placeholder="----"
                            onChange={e => handleVihanCellChange(idx, 'opto90m', e.target.value)}
                            className="w-14 px-1 py-0.5 text-xs font-black text-center border border-amber-300 rounded bg-white text-slate-900"
                          />
                        </td>
                        <td className="p-1.5 border-r border-slate-200 text-center bg-amber-50/30">
                          <input
                            type="number"
                            min="0"
                            value={r.opto45m || ''}
                            placeholder="----"
                            onChange={e => handleVihanCellChange(idx, 'opto45m', e.target.value)}
                            className="w-14 px-1 py-0.5 text-xs font-bold text-center border border-amber-300 rounded bg-white text-slate-900"
                          />
                        </td>
                        <td className="p-1.5 border-r border-slate-200 text-center bg-amber-50/30">
                          <input
                            type="number"
                            min="0"
                            value={r.opto180m || ''}
                            placeholder="----"
                            onChange={e => handleVihanCellChange(idx, 'opto180m', e.target.value)}
                            className="w-14 px-1 py-0.5 text-xs font-bold text-center border border-amber-300 rounded bg-white text-slate-900"
                          />
                        </td>
                        <td className="p-1.5 border-r border-slate-200 text-center bg-indigo-50/30">
                          <input
                            type="number"
                            min="0"
                            value={r.triguardBox || ''}
                            placeholder="----"
                            onChange={e => handleVihanCellChange(idx, 'triguardBox', e.target.value)}
                            className="w-14 px-1 py-0.5 text-xs font-bold text-center border border-indigo-300 rounded bg-white text-slate-900"
                          />
                        </td>
                        <td className="p-1.5 border-r border-slate-200 text-center bg-indigo-50/30">
                          <input
                            type="number"
                            min="0"
                            value={r.triguardStack || ''}
                            placeholder="----"
                            onChange={e => handleVihanCellChange(idx, 'triguardStack', e.target.value)}
                            className="w-14 px-1 py-0.5 text-xs font-bold text-center border border-indigo-300 rounded bg-white text-slate-900"
                          />
                        </td>
                        <td className="p-1.5 text-center no-print">
                          <button
                            type="button"
                            onClick={() => handleDeleteVihanRow(idx)}
                            className="p-1 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                            title="Delete size row"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Part 1B: MIX C/S DETAILS (RD+BK+BL+YL+GR) */}
            <div className="p-2.5 bg-rose-50/30">
              <div className="text-[11px] font-black uppercase text-rose-950 mb-1.5 flex items-center justify-between">
                <span>B. MIX C/S DETAILS — MIX COLOUR CARTON (`RD + BK + BL + YL + GR`)</span>
                <span className="text-[10px] font-bold text-rose-700">
                  Editable Colour-Wise Coils per 1 Mix Master Carton
                </span>
              </div>
              <div className="overflow-x-auto border border-rose-200 rounded bg-white">
                <table className="w-full text-xs text-left whitespace-nowrap">
                  <thead>
                    <tr className="bg-rose-100/90 text-rose-950 font-black text-[10px] uppercase border-b border-rose-200">
                      <th rowSpan={2} className="p-2 border-r border-rose-200">SIZE</th>
                      <th colSpan={6} className="p-1.5 border-r border-rose-200 text-center bg-rose-100">
                        90 MTRS (VIJ.) — RD + BK + BL + YL + GR
                      </th>
                      <th colSpan={6} className="p-1.5 text-center bg-amber-100 text-amber-950">
                        45 MTRS — RD + BK + BL + YL + GR
                      </th>
                    </tr>
                    <tr className="bg-slate-100 text-slate-800 font-extrabold text-[9.5px] uppercase border-b border-rose-200">
                      <th className="p-1 border-r border-slate-200 text-center text-red-700">RD</th>
                      <th className="p-1 border-r border-slate-200 text-center text-slate-900">BK</th>
                      <th className="p-1 border-r border-slate-200 text-center text-blue-700">BL</th>
                      <th className="p-1 border-r border-slate-200 text-center text-amber-600">YL</th>
                      <th className="p-1 border-r border-slate-200 text-center text-emerald-700">GR</th>
                      <th className="p-1 border-r border-rose-200 text-center bg-rose-50">PATTERN</th>
                      <th className="p-1 border-r border-slate-200 text-center text-red-700">RD</th>
                      <th className="p-1 border-r border-slate-200 text-center text-slate-900">BK</th>
                      <th className="p-1 border-r border-slate-200 text-center text-blue-700">BL</th>
                      <th className="p-1 border-r border-slate-200 text-center text-amber-600">YL</th>
                      <th className="p-1 border-r border-slate-200 text-center text-emerald-700">GR</th>
                      <th className="p-1 text-center bg-amber-50">PATTERN</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {vihanRules.map((r, idx) => {
                      const sum90 = sumMixBreakdown(r.mix90m);
                      const sum45 = sumMixBreakdown(r.mix45m);
                      return (
                        <tr key={`vihan-mix-${idx}`} className="hover:bg-rose-50/40">
                          <td className="p-1.5 border-r border-slate-200 font-black text-slate-900">{r.size}</td>
                          {(['RED', 'BLACK', 'BLUE', 'YELLOW', 'GREEN'] as const).map(col => (
                            <td key={`90-${col}`} className="p-1 border-r border-slate-100 text-center">
                              <input
                                type="number"
                                min="0"
                                value={r.mix90m[col] || ''}
                                placeholder="0"
                                onChange={e => handleVihanMixChange(idx, 'mix90m', col, e.target.value)}
                                className="w-10 px-1 py-0.5 text-[11px] font-bold text-center border border-slate-300 rounded bg-white"
                              />
                            </td>
                          ))}
                          <td className="p-1.5 border-r border-rose-200 text-center font-mono font-black text-[10.5px] text-rose-900 bg-rose-50/50">
                            {sum90 > 0 ? formatMixFormulaNumbers(r.mix90m) : '-'}
                          </td>
                          {(['RED', 'BLACK', 'BLUE', 'YELLOW', 'GREEN'] as const).map(col => (
                            <td key={`45-${col}`} className="p-1 border-r border-slate-100 text-center">
                              <input
                                type="number"
                                min="0"
                                value={r.mix45m[col] || ''}
                                placeholder="0"
                                onChange={e => handleVihanMixChange(idx, 'mix45m', col, e.target.value)}
                                className="w-10 px-1 py-0.5 text-[11px] font-bold text-center border border-slate-300 rounded bg-white"
                              />
                            </td>
                          ))}
                          <td className="p-1.5 text-center font-mono font-black text-[10.5px] text-amber-900 bg-amber-50/50">
                            {sum45 > 0 ? formatMixFormulaNumbers(r.mix45m) : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* SHEET 2: MARU MIRACLE DATA & PACKAGING */}
        {(activeSheet === 'BOTH' || activeSheet === 'MARU') && (
          <div className="border-2 border-red-900 rounded-xl bg-white overflow-hidden shadow-xs">
            <div className="bg-red-900 text-white px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-black uppercase tracking-wider text-amber-300">
                  SHEET 2: MARU MIRACLE DATA &amp; PACKAGING (IS-694 GRADE)
                </div>
                <div className="text-[11px] text-red-100 font-semibold">
                  Conductor, Ins.OD, Master Cartons (90M / 45M / 180M) &amp; Mix Pattern Maru (90 Mtrs &amp; 45 Mtrs)
                </div>
              </div>
              <div className="flex items-center gap-1.5 no-print">
                <button
                  type="button"
                  onClick={handleAddMaruRow}
                  className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Add Size
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateMaruRules(DEFAULT_MARU_MIRACLE_CARTON_RULES)}
                  className="px-2 py-1 rounded bg-red-950 hover:bg-red-800 text-red-100 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                  title="Reset Maru Miracle table to factory default"
                >
                  <RotateCcw className="w-3 h-3" /> Reset
                </button>
              </div>
            </div>

            {/* Part 2A: MARU MIRACLE DATA, INDIVIDUAL CARTONS & MIX PATTERN (90M & 45M) */}
            <div className="p-2.5 border-b border-slate-200">
              <div className="text-[11px] font-black uppercase text-slate-800 mb-1.5 flex items-center justify-between">
                <span>A. MARU MIRACLE DATA &amp; MASTER CARTONS PACKAGING (90M / 45M / 180M)</span>
                <span className="text-[10px] text-slate-500 font-semibold flex items-center gap-1">
                  <Edit3 className="w-3 h-3" /> Click any number to edit
                </span>
              </div>
              <div className="overflow-x-auto border border-slate-300 rounded">
                <table className="w-full text-xs text-left whitespace-nowrap">
                  <thead>
                    <tr className="bg-red-100 text-red-950 font-black text-[10px] uppercase border-b border-red-200">
                      <th rowSpan={2} className="p-2 border-r border-red-200">SIZE</th>
                      <th rowSpan={2} className="p-2 border-r border-red-200">COND.</th>
                      <th rowSpan={2} className="p-2 border-r border-red-200 text-right">INS.OD (MM)</th>
                      <th colSpan={3} className="p-1.5 border-r border-red-200 text-center bg-amber-100 text-amber-950">
                        INDIVIDUAL CARTON
                      </th>
                      <th colSpan={6} className="p-1.5 border-r border-red-200 text-center bg-emerald-100 text-emerald-950">
                        MIX PATTERN MARU 90 MTRS (COILS / CARTON)
                      </th>
                      <th colSpan={6} className="p-1.5 border-r border-red-200 text-center bg-amber-100 text-amber-950">
                        MIX PATTERN MARU 45 MTRS (COILS / CARTON)
                      </th>
                      <th rowSpan={2} className="p-1.5 text-center no-print">Del</th>
                    </tr>
                    <tr className="bg-slate-100 text-slate-800 font-extrabold text-[9.5px] uppercase border-b border-slate-300">
                      <th className="p-1.5 border-r border-slate-300 text-center bg-amber-50">90 MTRS</th>
                      <th className="p-1.5 border-r border-slate-300 text-center bg-amber-50">45 MTR</th>
                      <th className="p-1.5 border-r border-slate-300 text-center bg-amber-50">180 MTR</th>
                      <th className="p-1 border-r border-slate-200 text-center text-red-700">Red</th>
                      <th className="p-1 border-r border-slate-200 text-center text-slate-900">Black</th>
                      <th className="p-1 border-r border-slate-200 text-center text-blue-700">Blue</th>
                      <th className="p-1 border-r border-slate-200 text-center text-amber-600">Yellow</th>
                      <th className="p-1 border-r border-slate-200 text-center text-emerald-700">Green</th>
                      <th className="p-1 border-r border-slate-300 text-center bg-emerald-50">TOTAL</th>
                      <th className="p-1 border-r border-slate-200 text-center text-red-700">Red</th>
                      <th className="p-1 border-r border-slate-200 text-center text-slate-900">Black</th>
                      <th className="p-1 border-r border-slate-200 text-center text-blue-700">Blue</th>
                      <th className="p-1 border-r border-slate-200 text-center text-amber-600">Yellow</th>
                      <th className="p-1 border-r border-slate-200 text-center text-emerald-700">Green</th>
                      <th className="p-1 border-r border-slate-200 text-center bg-amber-50">TOTAL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {maruRules.map((r, idx) => {
                      const mix90Total = sumMixBreakdown(r.mix90m);
                      const mix45Total = sumMixBreakdown(r.mix45m);
                      return (
                        <tr key={`maru-${idx}`} className="hover:bg-slate-50">
                          <td className="p-1.5 border-r border-slate-200 font-bold">
                            <input
                              type="text"
                              value={r.size}
                              onChange={e => handleMaruCellChange(idx, 'size', e.target.value)}
                              className="w-24 px-1.5 py-0.5 text-xs font-black text-slate-900 border border-slate-200 rounded bg-white"
                            />
                          </td>
                          <td className="p-1.5 border-r border-slate-200">
                            <input
                              type="text"
                              value={r.conductor}
                              onChange={e => handleMaruCellChange(idx, 'conductor', e.target.value)}
                              className="w-20 px-1.5 py-0.5 text-xs font-mono font-bold text-slate-800 border border-slate-200 rounded bg-white"
                            />
                          </td>
                          <td className="p-1.5 border-r border-slate-200 text-right">
                            <input
                              type="number"
                              step="0.05"
                              value={r.insOd}
                              onChange={e => handleMaruCellChange(idx, 'insOd', e.target.value)}
                              className="w-16 px-1.5 py-0.5 text-xs font-bold text-right text-teal-800 border border-slate-200 rounded bg-white"
                            />
                          </td>
                          <td className="p-1.5 border-r border-slate-200 text-center bg-amber-50/30">
                            <input
                              type="number"
                              min="0"
                              value={r.coils90m || ''}
                              placeholder="0"
                              onChange={e => handleMaruCellChange(idx, 'coils90m', e.target.value)}
                              className="w-12 px-1 py-0.5 text-xs font-black text-center border border-amber-300 rounded bg-white text-slate-900"
                            />
                          </td>
                          <td className="p-1.5 border-r border-slate-200 text-center bg-amber-50/30">
                            <input
                              type="number"
                              min="0"
                              value={r.coils45m || ''}
                              placeholder="----"
                              onChange={e => handleMaruCellChange(idx, 'coils45m', e.target.value)}
                              className="w-12 px-1 py-0.5 text-xs font-bold text-center border border-amber-300 rounded bg-white text-slate-900"
                            />
                          </td>
                          <td className="p-1.5 border-r border-slate-200 text-center bg-amber-50/30">
                            <input
                              type="number"
                              min="0"
                              value={r.coils180m || ''}
                              placeholder="-"
                              onChange={e => handleMaruCellChange(idx, 'coils180m', e.target.value)}
                              className="w-12 px-1 py-0.5 text-xs font-bold text-center border border-amber-300 rounded bg-white text-slate-900"
                            />
                          </td>
                          {(['RED', 'BLACK', 'BLUE', 'YELLOW', 'GREEN'] as const).map(col => (
                            <td key={`maru-mix90-${col}`} className="p-1 border-r border-slate-100 text-center">
                              <input
                                type="number"
                                min="0"
                                value={r.mix90m?.[col] ?? 0}
                                onChange={e => handleMaruMixChange(idx, 'mix90m', col, e.target.value)}
                                className="w-10 px-1 py-0.5 text-[11px] font-bold text-center border border-slate-300 rounded bg-white"
                              />
                            </td>
                          ))}
                          <td className="p-1.5 border-r border-slate-300 text-center font-black text-emerald-900 bg-emerald-50/50">
                            {mix90Total > 0 ? `${mix90Total}` : '-'}
                          </td>
                          {(['RED', 'BLACK', 'BLUE', 'YELLOW', 'GREEN'] as const).map(col => (
                            <td key={`maru-mix45-${col}`} className="p-1 border-r border-slate-100 text-center">
                              <input
                                type="number"
                                min="0"
                                value={r.mix45m?.[col] ?? 0}
                                onChange={e => handleMaruMixChange(idx, 'mix45m', col, e.target.value)}
                                className="w-10 px-1 py-0.5 text-[11px] font-bold text-center border border-slate-300 rounded bg-white"
                              />
                            </td>
                          ))}
                          <td className="p-1.5 border-r border-slate-200 text-center font-black text-amber-900 bg-amber-50/50">
                            {mix45Total > 0 ? `${mix45Total}` : '-'}
                          </td>
                          <td className="p-1.5 text-center no-print">
                            <button
                              type="button"
                              onClick={() => handleDeleteMaruRow(idx)}
                              className="p-1 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                              title="Delete size row"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Part 2B: MIX C/S DETAILS — MARU MIRACLE (90 MTRS & 45 MTRS) SAME AS VIHAN DETAILS PLACED */}
            <div className="p-2.5 bg-rose-50/30">
              <div className="text-[11px] font-black uppercase text-rose-950 mb-1.5 flex items-center justify-between">
                <span>B. MIX PATTERN MARU DETAILS — MIX COLOUR CARTON (`RD + BK + BL + YL + GR`)</span>
                <span className="text-[10px] font-bold text-rose-700">
                  90 Mtrs &amp; 45 Mtrs Editable Colour-Wise Coils per 1 Mix Master Carton
                </span>
              </div>
              <div className="overflow-x-auto border border-rose-200 rounded bg-white">
                <table className="w-full text-xs text-left whitespace-nowrap">
                  <thead>
                    <tr className="bg-rose-100/90 text-rose-950 font-black text-[10px] uppercase border-b border-rose-200">
                      <th rowSpan={2} className="p-2 border-r border-rose-200">SIZE</th>
                      <th colSpan={6} className="p-1.5 border-r border-rose-200 text-center bg-emerald-100 text-emerald-950">
                        MIX PATTERN MARU 90 MTRS — RD + BK + BL + YL + GR
                      </th>
                      <th colSpan={6} className="p-1.5 text-center bg-amber-100 text-amber-950">
                        MIX PATTERN MARU 45 MTRS — RD + BK + BL + YL + GR
                      </th>
                    </tr>
                    <tr className="bg-slate-100 text-slate-800 font-extrabold text-[9.5px] uppercase border-b border-rose-200">
                      <th className="p-1 border-r border-slate-200 text-center text-red-700">RD</th>
                      <th className="p-1 border-r border-slate-200 text-center text-slate-900">BK</th>
                      <th className="p-1 border-r border-slate-200 text-center text-blue-700">BL</th>
                      <th className="p-1 border-r border-slate-200 text-center text-amber-600">YL</th>
                      <th className="p-1 border-r border-slate-200 text-center text-emerald-700">GR</th>
                      <th className="p-1 border-r border-rose-200 text-center bg-emerald-50">PATTERN</th>
                      <th className="p-1 border-r border-slate-200 text-center text-red-700">RD</th>
                      <th className="p-1 border-r border-slate-200 text-center text-slate-900">BK</th>
                      <th className="p-1 border-r border-slate-200 text-center text-blue-700">BL</th>
                      <th className="p-1 border-r border-slate-200 text-center text-amber-600">YL</th>
                      <th className="p-1 border-r border-slate-200 text-center text-emerald-700">GR</th>
                      <th className="p-1 text-center bg-amber-50">PATTERN</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {maruRules.map((r, idx) => {
                      const sum90 = sumMixBreakdown(r.mix90m);
                      const sum45 = sumMixBreakdown(r.mix45m);
                      return (
                        <tr key={`maru-mix-detail-${idx}`} className="hover:bg-rose-50/40">
                          <td className="p-1.5 border-r border-slate-200 font-black text-slate-900">{r.size}</td>
                          {(['RED', 'BLACK', 'BLUE', 'YELLOW', 'GREEN'] as const).map(col => (
                            <td key={`maru-b-90-${col}`} className="p-1 border-r border-slate-100 text-center">
                              <input
                                type="number"
                                min="0"
                                value={r.mix90m?.[col] || ''}
                                placeholder="0"
                                onChange={e => handleMaruMixChange(idx, 'mix90m', col, e.target.value)}
                                className="w-10 px-1 py-0.5 text-[11px] font-bold text-center border border-slate-300 rounded bg-white"
                              />
                            </td>
                          ))}
                          <td className="p-1.5 border-r border-rose-200 text-center font-mono font-black text-[10.5px] text-emerald-900 bg-emerald-50/50">
                            {sum90 > 0 ? formatMixFormulaNumbers(r.mix90m) : '-'}
                          </td>
                          {(['RED', 'BLACK', 'BLUE', 'YELLOW', 'GREEN'] as const).map(col => (
                            <td key={`maru-b-45-${col}`} className="p-1 border-r border-slate-100 text-center">
                              <input
                                type="number"
                                min="0"
                                value={r.mix45m?.[col] || ''}
                                placeholder="0"
                                onChange={e => handleMaruMixChange(idx, 'mix45m', col, e.target.value)}
                                className="w-10 px-1 py-0.5 text-[11px] font-bold text-center border border-slate-300 rounded bg-white"
                              />
                            </td>
                          ))}
                          <td className="p-1.5 text-center font-mono font-black text-[10.5px] text-amber-900 bg-amber-50/50">
                            {sum45 > 0 ? formatMixFormulaNumbers(r.mix45m) : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* MARU MIRACLE INFO TABLE */}
              <div className="mt-2.5 border border-blue-200 rounded bg-blue-50/50 p-2 text-xs">
                <div className="font-black text-blue-950 uppercase text-[10px] mb-1">
                  INFO — MARU MIRACLE IS:694 SPECIFICATION
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
                  <div className="bg-white px-2 py-1 rounded border border-blue-100">
                    <strong>Cond. Type:</strong> Cu (class 2 &amp; 5) COPPER COND.
                  </div>
                  <div className="bg-white px-2 py-1 rounded border border-blue-100">
                    <strong>Insulation type (KI-13):</strong> Type A, FR
                  </div>
                  <div className="sm:col-span-2 bg-white px-2 py-1 rounded border border-blue-100 font-mono font-bold text-slate-900">
                    MARU MIRACLE - FR 1.00 SQ MM 1100V (ISI LOGO) IS:694 CM/L 0003894486
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
