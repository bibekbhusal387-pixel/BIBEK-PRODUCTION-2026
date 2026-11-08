import React, { useState } from 'react';
import { ContainerPlan, ContainerLoadItem, PackagingRule } from '../types/cable';
import {
  computeContainerStuffingPlan,
  getDefaultLoadableLengthFt,
  parseSpoolDimensions,
  computePalletHeightBreakdown,
} from '../utils/containerStuffing';
import {
  Layers,
  Trash2,
  RotateCcw,
  Sparkles,
  Info,
  CheckCircle2,
  Plus,
  Box,
  Sliders,
  ArrowRight,
  Eye,
  Wand2,
} from 'lucide-react';

interface ContainerStuffingDiagramProps {
  container: ContainerPlan;
  packagingRules: PackagingRule[];
  isPrintView?: boolean;
  onUpdateContainerDimensions?: (updates: Partial<ContainerPlan>) => void;
  onApplyAutoStowagePositions?: (itemStowageMap: Record<string, string>) => void;
  onClearContainerItems?: () => void;
  onSetContainerItems?: (items: ContainerLoadItem[]) => void;
}

export const ContainerStuffingDiagram: React.FC<ContainerStuffingDiagramProps> = ({
  container,
  packagingRules,
  isPrintView = false,
  onUpdateContainerDimensions,
  onApplyAutoStowagePositions,
  onClearContainerItems,
  onSetContainerItems,
}) => {
  const plan = computeContainerStuffingPlan(container, packagingRules);
  const defaultLenFt = getDefaultLoadableLengthFt(container.containerType);

  // State: whether the user explicitly cleared the diagram
  const [isDiagramCleared, setIsDiagramCleared] = useState<boolean>(false);
  const isEffectivelyCleared = isDiagramCleared || container.items.length === 0;

  // Active blueprint variant: 'uniform' (42x12x16 * 2) vs 'mixed' (42x12x20 + 42x12x30)
  const [activeBlueprintVariant, setActiveBlueprintVariant] = useState<'both' | 'uniform' | 'mixed'>('both');

  // Handle Clear Diagram action
  const handleClearDiagram = () => {
    setIsDiagramCleared(true);
    if (onClearContainerItems) {
      onClearContainerItems();
    }
  };

  // Preset A: 42x12x16 on Top and 42x12x16 on Bottom (User sketch left side)
  const handleLoadBlueprintA = () => {
    setIsDiagramCleared(false);
    setActiveBlueprintVariant('uniform');
    if (onSetContainerItems) {
      const blueprintAItems: ContainerLoadItem[] = [
        {
          id: `BP-1-${Date.now()}`,
          batch: 'BLUEPRINT A',
          brandGrade: 'Standard Cable Export',
          sizeCores: '4C × 16.0 SQ MM',
          spool: '42 X 12 X 16',
          drumNo: 'DRUM-42X12X16-D1..D10',
          drumCount: 10,
          drumsPerPallet: 2,
          lengthPerDrum: 500,
          totalLength: 5000,
          netCableWt: 2450,
          grossWt: 2850,
          volumeCbm: 4.8,
          palletSize: '42X42x5.5',
          stowagePosition: 'Layer 1..5 (Top & Bottom Pallets)',
          remarks: '42x12x16 x 2 Drum (Height 16+16+6+5.5 = 43.5″)',
        },
      ];
      onSetContainerItems(blueprintAItems);
    }
  };

  // Preset B: 42x12x20 on Top and 42x12x30 on Bottom (User sketch right side)
  const handleLoadBlueprintB = () => {
    setIsDiagramCleared(false);
    setActiveBlueprintVariant('mixed');
    if (onSetContainerItems) {
      const blueprintBItems: ContainerLoadItem[] = [
        {
          id: `BP-2A-${Date.now()}`,
          batch: 'BLUEPRINT B (TOP)',
          brandGrade: 'Heavy Power Cable',
          sizeCores: '4C × 25.0 SQ MM',
          spool: '42 X 12 X 20',
          drumNo: 'DRUM-42X12X20-D1..D6',
          drumCount: 6,
          drumsPerPallet: 2,
          lengthPerDrum: 500,
          totalLength: 3000,
          netCableWt: 2100,
          grossWt: 2420,
          volumeCbm: 3.6,
          palletSize: '42X42x5.5',
          stowagePosition: 'Top Pallet (First)',
          remarks: '42x12x20 x 2 Drum (Height 20+20+6+5.5 = 51.5″)',
        },
        {
          id: `BP-2B-${Date.now()}`,
          batch: 'BLUEPRINT B (BOTTOM)',
          brandGrade: 'Heavy Power Cable',
          sizeCores: '4C × 50.0 SQ MM',
          spool: '42 X 12 X 30',
          drumNo: 'DRUM-42X12X30-D1..D3',
          drumCount: 3,
          drumsPerPallet: 1,
          lengthPerDrum: 500,
          totalLength: 1500,
          netCableWt: 1850,
          grossWt: 2120,
          volumeCbm: 2.8,
          palletSize: '42X42x5.5',
          stowagePosition: 'Bottom Pallet (Second)',
          remarks: '42x12x30 x 1 Drum (Height 30+6+5.5 = 41.5″)',
        },
      ];
      onSetContainerItems(blueprintBItems);
    }
  };

  // Render visual drum circles
  const renderDrumCircles = (count: number, printMode: boolean) => {
    const clamped = Math.min(Math.max(1, count), 4);
    const gridClass = clamped === 1 ? 'grid-cols-1' : 'grid-cols-2';

    return (
      <div className={`grid ${gridClass} gap-1.5 place-items-center`}>
        {Array.from({ length: clamped }).map((_, i) => (
          <div
            key={i}
            className={`rounded-full flex items-center justify-center font-mono font-bold ${
              clamped === 1 ? 'w-8 h-8 text-[11px]' : 'w-6 h-6 text-[9.5px]'
            } ${
              printMode
                ? 'border-2 border-black bg-slate-100 text-black'
                : 'border-2 border-slate-700 bg-slate-100 text-slate-800 shadow-2xs'
            }`}
          >
            D{i + 1}
          </div>
        ))}
      </div>
    );
  };

  // Reusable Single Pallet Box component with clear engineering drafting layout
  const renderClearPalletBox = (props: {
    label: string;
    subLabel?: string;
    spool: string;
    drumCount: number;
    palletWidthIn: number;
    palletLengthIn: number;
    formula: string;
    formulaResult: number;
    formulaDetails: string;
    isTop: boolean;
    printMode?: boolean;
  }) => {
    const {
      label,
      subLabel,
      spool,
      drumCount,
      palletWidthIn,
      palletLengthIn,
      formula,
      formulaResult,
      isTop,
      printMode = false,
    } = props;

    return (
      <div
        className={`relative border-2 rounded-xl p-3.5 flex flex-col justify-between transition-all ${
          printMode
            ? 'border-black bg-white text-black'
            : isTop
            ? 'border-slate-800 bg-white text-slate-900 shadow-sm'
            : 'border-slate-800 bg-white text-slate-900 shadow-sm'
        }`}
      >
        {/* Top Header with Pallet Label & Vertical Dimension (↕ 42") */}
        <div className="flex items-center justify-between pb-1.5 border-b border-slate-300 print:border-black">
          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-0.5 rounded text-xs font-black uppercase tracking-wider ${
                printMode
                  ? 'bg-black text-white'
                  : isTop
                  ? 'bg-blue-700 text-white'
                  : 'bg-emerald-700 text-white'
              }`}
            >
              {label}
            </span>
            {subLabel && (
              <span className="text-[11px] font-bold text-slate-600 print:text-black">
                ({subLabel})
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 font-mono text-xs font-black text-slate-800 print:text-black">
            <span>↕ {palletLengthIn}″</span>
          </div>
        </div>

        {/* Central Drum Box Area (As sketched: 42 x 12 x 16 x 2 Drum) */}
        <div className="my-2.5 flex flex-col items-center justify-center p-3 rounded-lg border-2 border-dashed border-slate-400 print:border-black bg-slate-50">
          <div className="text-base sm:text-lg font-black tracking-wide text-slate-900 print:text-black font-mono">
            {spool}
          </div>
          <div className="text-sm font-extrabold text-blue-800 print:text-black mt-0.5">
            × {drumCount} Drum{drumCount > 1 ? 's' : ''}
          </div>

          <div className="mt-2">{renderDrumCircles(drumCount, printMode)}</div>
        </div>

        {/* Bottom horizontal dimension arrow (◄─── 42" ───►) */}
        <div className="flex items-center justify-center gap-2 font-mono text-xs font-black text-slate-800 print:text-black pt-1 border-t border-slate-300 print:border-black">
          <span>◄─────── {palletWidthIn}″ ───────►</span>
        </div>

        {/* Height calculation callout (As sketched: Height 16 + 16 + 6 + 5.5) */}
        <div className="mt-2.5 p-2 rounded-lg text-xs font-mono font-bold flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 bg-amber-50 border border-amber-300 text-amber-950 print:bg-slate-100 print:border-black print:text-black">
          <div>
            <span className="text-slate-600 print:text-black uppercase text-[10px] block sm:inline mr-1">
              Height:
            </span>
            <strong className="text-amber-900 print:text-black text-xs font-black">
              {formula}
            </strong>
          </div>
          <div className="text-right">
            <span className="text-slate-900 print:text-black font-black">
              = {formulaResult}″ Stack Height
            </span>
            <span className="text-[10px] text-slate-500 print:text-black block font-normal">
              Clearance: {(89 - formulaResult).toFixed(1)}″ free of 89″
            </span>
          </div>
        </div>
      </div>
    );
  };

  // --------------------------------------------------------------------------
  // PRINT VIEW: OFFICIAL CLEAN HIGH-CONTRAST MONOCHROME BLUEPRINT
  // --------------------------------------------------------------------------
  if (isPrintView) {
    if (container.items.length === 0) {
      return (
        <div className="mt-3 border border-black rounded p-3 bg-white text-black break-inside-avoid font-sans text-center text-xs font-bold">
          📐 AUTOMATIC CONTAINER STUFFING &amp; PALLET ROW DIAGRAM: No cargo drums loaded in this container.
        </div>
      );
    }
    return (
      <div className="mt-3 border-2 border-black rounded p-3.5 bg-white text-black break-inside-avoid font-sans space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-black pb-2">
          <div>
            <div className="text-sm font-black uppercase tracking-wider">
              📐 AUTOMATIC CONTAINER STUFFING &amp; PALLET ROW DIAGRAM
            </div>
            <div className="text-[10.5px] font-semibold mt-0.5">
              Container Specs: <strong>{plan.loadableWidthIn}″ Loadable Width</strong> ×{' '}
              <strong>{plan.loadableHeightIn}″ Loadable Height</strong> ×{' '}
              <strong>{plan.loadableLengthFt} ft ({plan.loadableLengthIn}″) Length</strong> | Standard Pallet: 42″ × 42″ × 5.5″
            </div>
          </div>
          <div className="text-right text-[10.5px] font-bold">
            <div>Total: 10 Pallets in 5 Layers (20ft Container)</div>
            <div>Width: 90″ (Top 42″ + Bottom 42″ = 84″ Used, 6″ Free)</div>
          </div>
        </div>

        {/* SECTION 1: BOTH DIAGRAMS SIDE BY SIDE */}
        <div className="grid grid-cols-2 gap-4 border border-black p-2.5 rounded bg-slate-50">
          {/* Panel 1 */}
          <div className="border border-black p-2 rounded bg-white space-y-2">
            <div className="text-[11px] font-black uppercase border-b border-black pb-0.5">
              Diagram 1: Uniform 42×12×16 Drums
            </div>
            {renderClearPalletBox({
              label: 'Top',
              spool: '42 x 12 x 16',
              drumCount: 2,
              palletWidthIn: 42,
              palletLengthIn: 42,
              formula: '16 + 16 + 6 + 5.5',
              formulaResult: 43.5,
              formulaDetails: 'Traverse 16 + Traverse 16 + Flange Rim 6 + Base 5.5',
              isTop: true,
              printMode: true,
            })}
            {renderClearPalletBox({
              label: 'Bottom',
              spool: '42 x 12 x 16',
              drumCount: 2,
              palletWidthIn: 42,
              palletLengthIn: 42,
              formula: '16 + 16 + 6 + 5.5',
              formulaResult: 43.5,
              formulaDetails: 'Traverse 16 + Traverse 16 + Flange Rim 6 + Base 5.5',
              isTop: false,
              printMode: true,
            })}
            <div className="text-[9.5px] font-bold border-t border-black pt-1">
              📌 Where 6 is outer Flange Dia., 5.5 is Pallet Base Height.
            </div>
          </div>

          {/* Panel 2 */}
          <div className="border border-black p-2 rounded bg-white space-y-2">
            <div className="text-[11px] font-black uppercase border-b border-black pb-0.5">
              Diagram 2: Mixed 42×12×20 &amp; 42×12×30 Drums
            </div>
            {renderClearPalletBox({
              label: 'Top',
              subLabel: 'First',
              spool: '42 x 12 x 20',
              drumCount: 2,
              palletWidthIn: 42,
              palletLengthIn: 42,
              formula: '20 + 20 + 6 + 5.5',
              formulaResult: 51.5,
              formulaDetails: 'Traverse 20 + Traverse 20 + Flange Rim 6 + Base 5.5',
              isTop: true,
              printMode: true,
            })}
            {renderClearPalletBox({
              label: 'Bottom',
              subLabel: 'Second',
              spool: '42 x 12 x 30',
              drumCount: 1,
              palletWidthIn: 42,
              palletLengthIn: 42,
              formula: '30 + 6 + 5.5',
              formulaResult: 41.5,
              formulaDetails: 'Traverse 30 + Flange Rim 6 + Base 5.5',
              isTop: false,
              printMode: true,
            })}
            <div className="text-[9.5px] font-bold border-t border-black pt-1">
              📌 Where 6 is outer Flange Dia., 5.5 is Pallet Base Height.
            </div>
          </div>
        </div>

        {/* Stacking callout */}
        <div className="p-2 border-2 border-black rounded bg-slate-100 text-[11px] font-black uppercase text-center">
          First layer will complete like this other 4 layers also be placed (Total 5 Layers = 210″ in 20ft container).
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // INTERACTIVE SCREEN VIEW: CLEAN, MINIMALIST, HIGH-LEGIBILITY DRAFTING SHEET
  // --------------------------------------------------------------------------
  return (
    <div className="bg-white text-slate-900 rounded-xl border border-slate-300 p-4 sm:p-6 space-y-5 shadow-sm font-sans">
      {/* Top Header & Clear / Reset Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div className="flex items-center gap-2.5">
          <span className="p-2 rounded-lg bg-blue-50 text-blue-700 border border-blue-200">
            <Layers className="w-5 h-5" />
          </span>
          <div>
            <h4 className="text-base font-black text-slate-900 flex items-center gap-2 flex-wrap">
              <span>📐 Automatic Container Stuffing &amp; Pallet Row Diagram</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                Cross-Section Blueprint
              </span>
            </h4>
            <p className="text-xs text-slate-600 mt-0.5">
              Clear engineering layout: Two <strong className="text-slate-900">42″ × 42″</strong> pallets side-by-side across <strong className="text-slate-900">90″ width</strong>, stacked up to <strong className="text-slate-900">89″ height</strong>.
            </p>
          </div>
        </div>

        {/* Toolbar: CLEAR DIAGRAM, PRESET BUTTONS */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* CLEAR THIS DATA BUTTON */}
          <button
            type="button"
            onClick={handleClearDiagram}
            className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 rounded-lg font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
            title="Clear all container cargo items and reset the diagram"
          >
            <Trash2 className="w-3.5 h-3.5" /> Clear This Data
          </button>

          {/* Quick Preset Buttons */}
          <button
            type="button"
            onClick={handleLoadBlueprintA}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition-colors cursor-pointer border ${
              !isEffectivelyCleared && activeBlueprintVariant === 'uniform'
                ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-300'
            }`}
            title="Load 42×12×16 (2 Drums) Blueprint (Left Drawing)"
          >
            ✍️ Load Blueprint A (42×12×16)
          </button>

          <button
            type="button"
            onClick={handleLoadBlueprintB}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition-colors cursor-pointer border ${
              !isEffectivelyCleared && activeBlueprintVariant === 'mixed'
                ? 'bg-purple-600 text-white border-purple-600 shadow-2xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-300'
            }`}
            title="Load 42×12×20 & 42×12×30 Blueprint (Right Drawing)"
          >
            ✍️ Load Blueprint B (Mixed)
          </button>

          {onApplyAutoStowagePositions && plan.rows.length > 0 && !isEffectivelyCleared && (
            <button
              type="button"
              onClick={() => onApplyAutoStowagePositions(plan.itemStowageMap)}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold flex items-center gap-1 shadow-2xs cursor-pointer"
            >
              <Wand2 className="w-3.5 h-3.5" /> Auto-Assign Rows
            </button>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------------------- */}
      {/* CLEARED STATE (When User clicks "Clear This Data" or container is empty) */}
      {/* ---------------------------------------------------------------------- */}
      {isEffectivelyCleared ? (
        <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center bg-slate-50 space-y-4">
          <div className="w-12 h-12 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center mx-auto">
            <Trash2 className="w-6 h-6" />
          </div>
          <div>
            <h5 className="text-sm font-extrabold text-slate-800">
              Automatic Container Stuffing &amp; Pallet Row Diagram Cleared
            </h5>
            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
              All diagram and container cargo data have been cleared. The workspace is now completely empty and ready for your fresh inputs or order sheet loading.
            </p>
          </div>

          <div className="flex items-center justify-center gap-3 flex-wrap pt-2">
            <button
              type="button"
              onClick={handleLoadBlueprintA}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              ✍️ Load Blueprint A (42×12×16 × 2 Drums)
            </button>

            <button
              type="button"
              onClick={handleLoadBlueprintB}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              ✍️ Load Blueprint B (42×12×20 &amp; 42×12×30)
            </button>
          </div>
        </div>
      ) : (
        /* ---------------------------------------------------------------------- */
        /* ACTIVE CLEAN BLUEPRINT VIEW (MATCHING USER HANDWRITTEN SHEET)          */
        /* ---------------------------------------------------------------------- */
        <div className="space-y-5">
          {/* Container Cross Section Width Ruler */}
          <div className="bg-slate-100 border border-slate-300 rounded-lg px-3 py-1.5 flex items-center justify-between text-xs font-mono font-bold text-slate-700">
            <span>
              ◄──────────────── CONTAINER INTERNAL WIDTH: {plan.loadableWidthIn} INCHES ────────────────►
            </span>
            <span className="text-emerald-700">
              Top 42″ + Bottom 42″ = 84″ Used (6″ Free Side Clearance)
            </span>
          </div>

          {/* THE TWO BLUEPRINT PANELS (SIDE BY SIDE ON ONE SHEET) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* PANEL 1: UNIFORM 42×12×16 DRUMS (LEFT OF DRAWING) */}
            <div className="border-2 border-slate-300 rounded-xl p-4 bg-slate-50/70 space-y-3 shadow-xs">
              <div className="border-b border-slate-300 pb-2 flex items-center justify-between">
                <div>
                  <span className="text-xs font-black text-slate-900 uppercase tracking-wide">
                    Diagram 1: Uniform 42×12×16 Drums (Left Drawing)
                  </span>
                  <span className="text-[11px] text-slate-500 block">
                    Top &amp; Bottom both have two 16″ traverse drums
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-900 border border-blue-200">
                  Height: 43.5″ Stack
                </span>
              </div>

              {/* Top Pallet Box */}
              {renderClearPalletBox({
                label: 'Top',
                spool: '42 x 12 x 16',
                drumCount: 2,
                palletWidthIn: 42,
                palletLengthIn: 42,
                formula: '16 + 16 + 6 + 5.5',
                formulaResult: 43.5,
                formulaDetails: 'Traverse 16 + Traverse 16 + Flange Rim 6 + Base 5.5',
                isTop: true,
                printMode: false,
              })}

              {/* Bottom Pallet Box */}
              {renderClearPalletBox({
                label: 'Bottom',
                spool: '42 x 12 x 16',
                drumCount: 2,
                palletWidthIn: 42,
                palletLengthIn: 42,
                formula: '16 + 16 + 6 + 5.5',
                formulaResult: 43.5,
                formulaDetails: 'Traverse 16 + Traverse 16 + Flange Rim 6 + Base 5.5',
                isTop: false,
                printMode: false,
              })}

              {/* Note matching user drawing */}
              <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-950 text-xs font-mono font-bold flex items-center justify-between">
                <span>📌 Where 6 is outer Flange Dia., 5.5 is Pallet Base Height.</span>
                <span className="text-[10.5px] text-slate-600">Clearance: 45.5″ Free of 89″</span>
              </div>
            </div>

            {/* PANEL 2: MIXED 42×12×20 & 42×12×30 DRUMS (RIGHT OF DRAWING) */}
            <div className="border-2 border-slate-300 rounded-xl p-4 bg-slate-50/70 space-y-3 shadow-xs">
              <div className="border-b border-slate-300 pb-2 flex items-center justify-between">
                <div>
                  <span className="text-xs font-black text-slate-900 uppercase tracking-wide">
                    Diagram 2: Mixed 42×12×20 &amp; 42×12×30 Drums (Right Drawing)
                  </span>
                  <span className="text-[11px] text-slate-500 block">
                    Top has two 20″ drums (First) • Bottom has one 30″ drum (Second)
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-900 border border-purple-200">
                  Height: 51.5″ &amp; 41.5″
                </span>
              </div>

              {/* Top Pallet Box (First) */}
              {renderClearPalletBox({
                label: 'Top',
                subLabel: 'First',
                spool: '42 x 12 x 20',
                drumCount: 2,
                palletWidthIn: 42,
                palletLengthIn: 42,
                formula: '20 + 20 + 6 + 5.5',
                formulaResult: 51.5,
                formulaDetails: 'Traverse 20 + Traverse 20 + Flange Rim 6 + Base 5.5',
                isTop: true,
                printMode: false,
              })}

              {/* Bottom Pallet Box (Second) */}
              {renderClearPalletBox({
                label: 'Bottom',
                subLabel: 'Second',
                spool: '42 x 12 x 30',
                drumCount: 1,
                palletWidthIn: 42,
                palletLengthIn: 42,
                formula: '30 + 6 + 5.5',
                formulaResult: 41.5,
                formulaDetails: 'Traverse 30 + Flange Rim 6 + Base 5.5',
                isTop: false,
                printMode: false,
              })}

              {/* Note matching user drawing */}
              <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-950 text-xs font-mono font-bold flex items-center justify-between">
                <span>📌 Where 6 is outer Flange Dia., 5.5 is Pallet Base Height.</span>
                <span className="text-[10.5px] text-slate-600">Clearance: 37.5″ Free of 89″</span>
              </div>
            </div>
          </div>

          {/* Stacking / Layer Progression Banner (As handwritten by user) */}
          <div className="bg-blue-50 border-2 border-blue-400 rounded-xl p-3.5 text-center space-y-1">
            <div className="text-sm sm:text-base font-black text-blue-950 uppercase tracking-wide flex items-center justify-center gap-2">
              <Sparkles className="w-5 h-5 text-blue-600" />
              <span>&ldquo;First layer will complete like this other 4 layers also be placed.&rdquo;</span>
            </div>
            <div className="text-xs text-blue-900 font-medium max-w-2xl mx-auto">
              Each layer takes <strong>42″ length</strong>. In a 20FT container (<strong>19.2 ft / 230″ loadable length</strong>), all 5 layers total take <strong>210″</strong>, leaving <strong>20″ (1.7 ft)</strong> free door clearance.
            </div>
          </div>

        </div>
      )}
    </div>
  );
};
