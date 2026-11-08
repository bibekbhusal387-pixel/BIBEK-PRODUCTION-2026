import { CableOrder, DensitySettings, Is694OperatorLogEntry, Is694ProductionLot, LadiDimensionRule } from '../types/cable';
import { computeRecordRow, getCoilMultiplierByOption, getIs694ColourCoilsBreakdown, parseSizeNum } from './calculations';
import { DEFAULT_COLOUR_MAP } from '../data/defaults';

export type Is694CartonStandardKey =
  | 'VIHAN_OPTO'
  | 'TRIGUARD_BOX'
  | 'TRIGUARD_STACK'
  | 'MARU_MIRACLE'
  | 'CUSTOM';

export type Is694CartonMode = 'INDIVIDUAL' | 'MIX';

export interface MixCartonBreakdown {
  RED: number;
  BLACK: number;
  BLUE: number;
  YELLOW: number;
  GREEN: number;
}

/**
 * Sheet 1: FOR VIHAN OPTO & TRIGUARD — MASTER CARTONS PACKAGING & MIX C/S DETAILS
 */
export interface VihanTriguardCartonRule {
  size: string; // e.g. "0.75 SQ MM"
  opto90m: number; // Coils per master carton (90 MTRS)
  opto45m: number; // Coils per master carton (45 MTR)
  opto180m: number; // Coils per master carton (180 MTR)
  triguardBox: number; // Coils per master carton (BOX)
  triguardStack: number; // Coils per master carton (STACK)
  // MIX C/S DETAILS (RD+BK+BL+YL+GR)
  mix90m: MixCartonBreakdown;
  mix45m: MixCartonBreakdown;
}

/**
 * Sheet 2: MARU MIRACLE DATA & PACKAGING + MIX PATTERN MARU 90 MTRS & 45 MTRS
 */
export interface MaruMiracleCartonRule {
  size: string; // e.g. "0.50 SQ MM"
  conductor: string; // e.g. "16/.176"
  insOd: number; // e.g. 1.90
  coils90m: number; // 90 MTRS coils per master carton
  coils45m: number; // 45 MTR coils per master carton
  coils180m: number; // 180 MTR coils per master carton
  // Mix pattern Maru 90 mtrs (Red, Black, Blue, Yellow, Green)
  mix90m: MixCartonBreakdown;
  // Mix pattern Maru 45 mtrs (Red, Black, Blue, Yellow, Green)
  mix45m: MixCartonBreakdown;
}

export const DEFAULT_VIHAN_TRIGUARD_CARTON_RULES: VihanTriguardCartonRule[] = [
  {
    size: '0.75 SQ MM',
    opto90m: 24,
    opto45m: 0,
    opto180m: 0,
    triguardBox: 24,
    triguardStack: 0,
    mix90m: { RED: 0, BLACK: 0, BLUE: 0, YELLOW: 0, GREEN: 0 },
    mix45m: { RED: 0, BLACK: 0, BLUE: 0, YELLOW: 0, GREEN: 0 },
  },
  {
    size: '1.00 SQ MM',
    opto90m: 20,
    opto45m: 40,
    opto180m: 12,
    triguardBox: 24,
    triguardStack: 24,
    // 90 MTRS (VIJ.): 6+6+3+3+2 = 20 | 45 MTRS: 15+15+5+5 = 40
    mix90m: { RED: 6, BLACK: 6, BLUE: 3, YELLOW: 3, GREEN: 2 },
    mix45m: { RED: 15, BLACK: 15, BLUE: 5, YELLOW: 5, GREEN: 0 },
  },
  {
    size: '1.50 SQ MM',
    opto90m: 16,
    opto45m: 32,
    opto180m: 10,
    triguardBox: 16,
    triguardStack: 16,
    // 90 MTRS (VIJ.): 1+1+4+4+6 = 16 | 45 MTRS: 2+2+8+8+12 = 32
    mix90m: { RED: 1, BLACK: 1, BLUE: 4, YELLOW: 4, GREEN: 6 },
    mix45m: { RED: 2, BLACK: 2, BLUE: 8, YELLOW: 8, GREEN: 12 },
  },
  {
    size: '2.00 SQ MM',
    opto90m: 16,
    opto45m: 0,
    opto180m: 0,
    triguardBox: 0,
    triguardStack: 0,
    mix90m: { RED: 0, BLACK: 0, BLUE: 0, YELLOW: 0, GREEN: 0 },
    mix45m: { RED: 0, BLACK: 0, BLUE: 0, YELLOW: 0, GREEN: 0 },
  },
  {
    size: '2.50 SQ MM',
    opto90m: 10,
    opto45m: 20,
    opto180m: 6,
    triguardBox: 10,
    triguardStack: 12,
    // 90 MTRS (VIJ.): 3+3+2+2 = 10 | 45 MTRS: 8+8+2+2 = 20
    mix90m: { RED: 3, BLACK: 3, BLUE: 2, YELLOW: 2, GREEN: 0 },
    mix45m: { RED: 8, BLACK: 8, BLUE: 2, YELLOW: 2, GREEN: 0 },
  },
  {
    size: '4.00 SQ MM',
    opto90m: 8,
    opto45m: 16,
    opto180m: 5,
    triguardBox: 8,
    triguardStack: 8,
    // 90 MTRS (VIJ.): 3+3+1+1 = 8 | 45 MTRS: 8+8 = 16
    mix90m: { RED: 3, BLACK: 3, BLUE: 1, YELLOW: 1, GREEN: 0 },
    mix45m: { RED: 8, BLACK: 8, BLUE: 0, YELLOW: 0, GREEN: 0 },
  },
  {
    size: '6.00 SQ MM',
    opto90m: 4,
    opto45m: 0,
    opto180m: 0,
    triguardBox: 4,
    triguardStack: 4,
    mix90m: { RED: 0, BLACK: 0, BLUE: 0, YELLOW: 0, GREEN: 0 },
    mix45m: { RED: 0, BLACK: 0, BLUE: 0, YELLOW: 0, GREEN: 0 },
  },
  {
    size: '10.00 SQ MM',
    opto90m: 3,
    opto45m: 0,
    opto180m: 0,
    triguardBox: 0,
    triguardStack: 0,
    mix90m: { RED: 0, BLACK: 0, BLUE: 0, YELLOW: 0, GREEN: 0 },
    mix45m: { RED: 0, BLACK: 0, BLUE: 0, YELLOW: 0, GREEN: 0 },
  },
];

export const DEFAULT_MARU_MIRACLE_CARTON_RULES: MaruMiracleCartonRule[] = [
  {
    size: '0.50 SQ MM',
    conductor: '16/.176',
    insOd: 1.9,
    coils90m: 36,
    coils45m: 0,
    coils180m: 0,
    mix90m: { RED: 0, BLACK: 0, BLUE: 0, YELLOW: 0, GREEN: 36 },
    mix45m: { RED: 0, BLACK: 0, BLUE: 0, YELLOW: 0, GREEN: 0 },
  },
  {
    size: '0.75 SQ MM',
    conductor: '11/0.265',
    insOd: 2.3,
    coils90m: 24,
    coils45m: 0,
    coils180m: 0,
    mix90m: { RED: 6, BLACK: 6, BLUE: 6, YELLOW: 6, GREEN: 0 },
    mix45m: { RED: 0, BLACK: 0, BLUE: 0, YELLOW: 0, GREEN: 0 },
  },
  {
    size: '1.00 SQ MM',
    conductor: '14/0.265',
    insOd: 2.6,
    coils90m: 24,
    coils45m: 40,
    coils180m: 12,
    // 90 MTRS: 6+6+6+6 = 24 | 45 MTRS: 10+10+10+10 = 40
    mix90m: { RED: 6, BLACK: 6, BLUE: 6, YELLOW: 6, GREEN: 0 },
    mix45m: { RED: 10, BLACK: 10, BLUE: 10, YELLOW: 10, GREEN: 0 },
  },
  {
    size: '1.50 SQ MM',
    conductor: '22/0.260',
    insOd: 2.9,
    coils90m: 18,
    coils45m: 32,
    coils180m: 10,
    // 90 MTRS: 5+5+4+4 = 18 | 45 MTRS: 10+10+6+6 = 32
    mix90m: { RED: 5, BLACK: 5, BLUE: 4, YELLOW: 4, GREEN: 0 },
    mix45m: { RED: 10, BLACK: 10, BLUE: 6, YELLOW: 6, GREEN: 0 },
  },
  {
    size: '2.50 SQ MM',
    conductor: '36/0.260',
    insOd: 3.6,
    coils90m: 12,
    coils45m: 20,
    coils180m: 6,
    // 90 MTRS: 3+3+3+3 = 12 | 45 MTRS: 5+5+5+5 = 20
    mix90m: { RED: 3, BLACK: 3, BLUE: 3, YELLOW: 3, GREEN: 0 },
    mix45m: { RED: 5, BLACK: 5, BLUE: 5, YELLOW: 5, GREEN: 0 },
  },
  {
    size: '4.00 SQ MM',
    conductor: '56/0.260',
    insOd: 4.1,
    coils90m: 8,
    coils45m: 16,
    coils180m: 5,
    // 90 MTRS: 2+2+1+1 = 6 | 45 MTRS: 5+5+3+3 = 16
    mix90m: { RED: 2, BLACK: 2, BLUE: 1, YELLOW: 1, GREEN: 0 },
    mix45m: { RED: 5, BLACK: 5, BLUE: 3, YELLOW: 3, GREEN: 0 },
  },
  {
    size: '6.00 SQ MM',
    conductor: '84/0.260',
    insOd: 4.6,
    coils90m: 6,
    coils45m: 0,
    coils180m: 3,
    mix90m: { RED: 1, BLACK: 1, BLUE: 1, YELLOW: 1, GREEN: 0 },
    mix45m: { RED: 0, BLACK: 0, BLUE: 0, YELLOW: 0, GREEN: 0 },
  },
  {
    size: '10.00 SQ MM',
    conductor: '140/0.260',
    insOd: 5.6,
    coils90m: 3,
    coils45m: 0,
    coils180m: 0,
    mix90m: { RED: 0, BLACK: 0, BLUE: 0, YELLOW: 0, GREEN: 0 },
    mix45m: { RED: 0, BLACK: 0, BLUE: 0, YELLOW: 0, GREEN: 0 },
  },
];

const VIHAN_STORAGE_KEY = 'plutus_is694_vihan_triguard_cartons_v1';
const MARU_STORAGE_KEY = 'plutus_is694_maru_miracle_cartons_v2';

export function normalizeMaruMiracleCartonRules(rawRules: any[]): MaruMiracleCartonRule[] {
  if (!Array.isArray(rawRules) || rawRules.length === 0) {
    return DEFAULT_MARU_MIRACLE_CARTON_RULES;
  }
  return rawRules.map(r => {
    const szNum = parseSizeNum(r?.size || '');
    const defMatch = DEFAULT_MARU_MIRACLE_CARTON_RULES.find(
      d => Math.abs(parseSizeNum(d.size) - szNum) < 0.01
    );
    const hasMix45 =
      r?.mix45m &&
      typeof r.mix45m === 'object' &&
      ((Number(r.mix45m.RED) || 0) +
        (Number(r.mix45m.BLACK) || 0) +
        (Number(r.mix45m.BLUE) || 0) +
        (Number(r.mix45m.YELLOW) || 0) +
        (Number(r.mix45m.GREEN) || 0) >
        0 ||
        !defMatch ||
        (defMatch.mix45m.RED +
          defMatch.mix45m.BLACK +
          defMatch.mix45m.BLUE +
          defMatch.mix45m.YELLOW +
          defMatch.mix45m.GREEN ===
          0));

    const resolvedMix45: MixCartonBreakdown = hasMix45
      ? {
          RED: Number(r.mix45m?.RED) || 0,
          BLACK: Number(r.mix45m?.BLACK) || 0,
          BLUE: Number(r.mix45m?.BLUE) || 0,
          YELLOW: Number(r.mix45m?.YELLOW) || 0,
          GREEN: Number(r.mix45m?.GREEN) || 0,
        }
      : {
          ...(defMatch?.mix45m || { RED: 0, BLACK: 0, BLUE: 0, YELLOW: 0, GREEN: 0 }),
        };

    const mix45Sum =
      resolvedMix45.RED +
      resolvedMix45.BLACK +
      resolvedMix45.BLUE +
      resolvedMix45.YELLOW +
      resolvedMix45.GREEN;

    const resolvedCoils45m =
      r?.coils45m !== undefined && Number(r.coils45m) > 0
        ? Number(r.coils45m)
        : defMatch?.coils45m || mix45Sum || 0;

    return {
      size: r?.size || defMatch?.size || '1.00 SQ MM',
      conductor: r?.conductor || defMatch?.conductor || '14/0.265',
      insOd: Number(r?.insOd) || defMatch?.insOd || 2.6,
      coils90m: Number(r?.coils90m ?? defMatch?.coils90m ?? 0),
      coils45m: resolvedCoils45m,
      coils180m: Number(r?.coils180m ?? defMatch?.coils180m ?? 0),
      mix90m: {
        RED: Number(r?.mix90m?.RED ?? defMatch?.mix90m.RED ?? 0),
        BLACK: Number(r?.mix90m?.BLACK ?? defMatch?.mix90m.BLACK ?? 0),
        BLUE: Number(r?.mix90m?.BLUE ?? defMatch?.mix90m.BLUE ?? 0),
        YELLOW: Number(r?.mix90m?.YELLOW ?? defMatch?.mix90m.YELLOW ?? 0),
        GREEN: Number(r?.mix90m?.GREEN ?? defMatch?.mix90m.GREEN ?? 0),
      },
      mix45m: resolvedMix45,
    };
  });
}

export function loadVihanTriguardCartonRules(): VihanTriguardCartonRule[] {
  try {
    const raw = localStorage.getItem(VIHAN_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  return DEFAULT_VIHAN_TRIGUARD_CARTON_RULES;
}

export function saveVihanTriguardCartonRules(rules: VihanTriguardCartonRule[]): void {
  try {
    localStorage.setItem(VIHAN_STORAGE_KEY, JSON.stringify(rules));
    window.dispatchEvent(new Event('plutus_is694_carton_rules_updated'));
  } catch (e) {}
}

export function loadMaruMiracleCartonRules(): MaruMiracleCartonRule[] {
  try {
    const raw =
      localStorage.getItem(MARU_STORAGE_KEY) ||
      localStorage.getItem('plutus_is694_maru_miracle_cartons_v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return normalizeMaruMiracleCartonRules(parsed);
      }
    }
  } catch (e) {}
  return DEFAULT_MARU_MIRACLE_CARTON_RULES;
}

export function saveMaruMiracleCartonRules(rules: MaruMiracleCartonRule[]): void {
  try {
    const normalized = normalizeMaruMiracleCartonRules(rules);
    localStorage.setItem(MARU_STORAGE_KEY, JSON.stringify(normalized));
    localStorage.setItem('plutus_is694_maru_miracle_cartons_v1', JSON.stringify(normalized));
    window.dispatchEvent(new Event('plutus_is694_carton_rules_updated'));
  } catch (e) {}
}

export function sumMixBreakdown(m?: Partial<MixCartonBreakdown>): number {
  if (!m) return 0;
  return (
    (Number(m.RED) || 0) +
    (Number(m.BLACK) || 0) +
    (Number(m.BLUE) || 0) +
    (Number(m.YELLOW) || 0) +
    (Number(m.GREEN) || 0)
  );
}

export function formatMixBreakdownLabel(m?: Partial<MixCartonBreakdown>): string {
  if (!m) return '-';
  const parts: string[] = [];
  if (Number(m.RED) > 0) parts.push(`RD:${m.RED}`);
  if (Number(m.BLACK) > 0) parts.push(`BK:${m.BLACK}`);
  if (Number(m.BLUE) > 0) parts.push(`BL:${m.BLUE}`);
  if (Number(m.YELLOW) > 0) parts.push(`YL:${m.YELLOW}`);
  if (Number(m.GREEN) > 0) parts.push(`GR:${m.GREEN}`);
  return parts.length > 0 ? parts.join(' + ') : '-';
}

export function formatMixFormulaNumbers(m?: Partial<MixCartonBreakdown>): string {
  if (!m) return '-';
  const vals = [
    Number(m.RED) || 0,
    Number(m.BLACK) || 0,
    Number(m.BLUE) || 0,
    Number(m.YELLOW) || 0,
    Number(m.GREEN) || 0,
  ];
  // Trim trailing zeros while keeping at least active items
  while (vals.length > 2 && vals[vals.length - 1] === 0) {
    vals.pop();
  }
  const sum = vals.reduce((a, b) => a + b, 0);
  if (sum === 0) return '-';
  return `${vals.join('+')} (${sum} Coils)`;
}

export function inferStandardFromBrand(brand?: string): Is694CartonStandardKey {
  const b = (brand || '').toUpperCase();
  if (b.includes('MARU')) return 'MARU_MIRACLE';
  if (b.includes('TRIGUARD') && b.includes('STACK')) return 'TRIGUARD_STACK';
  if (b.includes('TRIGUARD')) return 'TRIGUARD_BOX';
  return 'VIHAN_OPTO';
}

export function lookupIs694CartonSpec(
  size: string,
  standard: Is694CartonStandardKey,
  coilType: string,
  vihanRules: VihanTriguardCartonRule[],
  maruRules: MaruMiracleCartonRule[]
): {
  coilsPerCarton: number;
  mixPerCarton: MixCartonBreakdown;
  maruConductor?: string;
  maruInsOd?: number;
} {
  const targetNum = parseSizeNum(size);
  const ct = (coilType || '90 MTR').toUpperCase();
  const is45m = ct.includes('45') || ct.includes('50 YARD');
  const is180m = ct.includes('180') || ct.includes('200 YARD');

  if (standard === 'MARU_MIRACLE') {
    const mRule =
      maruRules.find(r => Math.abs(parseSizeNum(r.size) - targetNum) < 0.01) ||
      DEFAULT_MARU_MIRACLE_CARTON_RULES.find(r => Math.abs(parseSizeNum(r.size) - targetNum) < 0.01);

    if (mRule) {
      const mix45Total = sumMixBreakdown(mRule.mix45m);
      let cpc = mRule.coils90m;
      if (is45m && (mRule.coils45m > 0 || mix45Total > 0)) {
        cpc = mRule.coils45m > 0 ? mRule.coils45m : mix45Total;
      } else if (is180m && mRule.coils180m > 0) {
        cpc = mRule.coils180m;
      }
      const mix = is45m && mix45Total > 0 ? { ...mRule.mix45m } : { ...mRule.mix90m };
      return {
        coilsPerCarton: cpc || 1,
        mixPerCarton: mix,
        maruConductor: mRule.conductor,
        maruInsOd: mRule.insOd,
      };
    }
  }

  const vRule =
    vihanRules.find(r => Math.abs(parseSizeNum(r.size) - targetNum) < 0.01) ||
    DEFAULT_VIHAN_TRIGUARD_CARTON_RULES.find(r => Math.abs(parseSizeNum(r.size) - targetNum) < 0.01);

  if (vRule) {
    let cpc = vRule.opto90m;
    if (standard === 'TRIGUARD_BOX') {
      cpc = vRule.triguardBox || vRule.opto90m;
    } else if (standard === 'TRIGUARD_STACK') {
      cpc = vRule.triguardStack || vRule.triguardBox || vRule.opto90m;
    } else {
      if (is45m && vRule.opto45m > 0) cpc = vRule.opto45m;
      else if (is180m && vRule.opto180m > 0) cpc = vRule.opto180m;
      else cpc = vRule.opto90m;
    }

    const mix = is45m && sumMixBreakdown(vRule.mix45m) > 0 ? { ...vRule.mix45m } : { ...vRule.mix90m };
    return {
      coilsPerCarton: cpc || 1,
      mixPerCarton: mix,
    };
  }

  return {
    coilsPerCarton: 16,
    mixPerCarton: { RED: 4, BLACK: 4, BLUE: 4, YELLOW: 4, GREEN: 0 },
  };
}

export interface ComputedIs694CartonPackingRow {
  rowId: string;
  order: CableOrder;
  lot?: Is694ProductionLot;
  isPartialPlan: boolean;
  lotLabel?: string;
  totalOrderedCoils: number;
  plannedCoils: number;
  remainingCoilsOnOrderSheet: number;
  standard: Is694CartonStandardKey;
  mode: Is694CartonMode;
  coilType: string;
  coilMultiplier: number;
  coilsPerCarton: number;
  totalCoils: number;
  totalCartons: number;
  fullCartons: number;
  looseCoils: number;
  orderLengthM: number;
  cuWtKg: number;
  insWtKg: number;
  netWireWtKg: number;
  cartonTareKg: number;
  grossPackingWtKg: number;
  mixPerCarton: MixCartonBreakdown;
  colourDetails: {
    colour: string;
    coils: number;
    cartons: number;
    fullCartons: number;
    looseCoils: number;
    lengthM: number;
    inStockCartons: number;
  }[];
  isInsulationDone: boolean;
  isDispatched: boolean;
  inStockCartons: number;
  dispatchedCartons: number;
  availableCartonStock: number;
  packingSummaryText: string;
  operatorLogs: Is694OperatorLogEntry[];
  cartonIds: string[];
  cartonIdsLabel: string;
  operatorLoggedCoils: number;
  operatorLoggedCartons: number;
  operatorActualMeters: number;
  operatorActualPvcKg: number;
}

/**
 * Synchronizes an IS-694 order (or its active Parcel Production Plan Lot) with the
 * Operator Production Log entries recorded on the IS-694 Process Card:
 * - Aggregates actual output coils, colour counts, carton IDs, cartons packed, and actual wire length / PVC weight.
 * - Automatically updates the order's (or lot's) main IS-694 packing inventory (coils, carton_count, coil_colour_breakdown, carton_ids)
 *   and marks Stage B & Stage I completed when actual output is recorded so it immediately attaches to Stock!
 */
export function syncOrderWithOperatorProductionLogs(
  order: CableOrder,
  logs: Is694OperatorLogEntry[],
  vihanRules: VihanTriguardCartonRule[],
  maruRules: MaruMiracleCartonRule[],
  targetLotId?: string
): CableOrder {
  const coilType = order.coil_type || '90 MTR';
  const mult = getCoilMultiplierByOption(coilType);
  const standard: Is694CartonStandardKey =
    order.carton_standard || inferStandardFromBrand(order.brand);
  const spec = lookupIs694CartonSpec(order.size, standard, coilType, vihanRules, maruRules);
  const cpc =
    order.coils_per_carton && order.coils_per_carton > 0
      ? Number(order.coils_per_carton)
      : spec.coilsPerCarton || 16;

  // Normalize each log row's calculated fields
  const normalizedLogs: Is694OperatorLogEntry[] = logs.map(log => {
    const colSum = Object.values(log.colourCounts || {}).reduce(
      (s, v) => s + (Math.max(0, Number(v) || 0)),
      0
    );
    const coils = colSum > 0 ? colSum : Math.max(0, Number(log.actualCoils) || 0);
    const cartons =
      Number(log.cartonsPacked) > 0
        ? Number(log.cartonsPacked)
        : cpc > 0 && coils > 0
        ? Number((coils / cpc).toFixed(2))
        : 0;
    const lenM =
      Number(log.actualLengthM) > 0
        ? Number(log.actualLengthM)
        : Number((coils * mult).toFixed(1));
    return {
      ...log,
      actualCoils: coils,
      cartonsPacked: cartons,
      actualLengthM: lenM,
    };
  });

  const totalLoggedCoils = normalizedLogs.reduce((s, l) => s + (Number(l.actualCoils) || 0), 0);
  const totalLoggedCartons = normalizedLogs.reduce((s, l) => s + (Number(l.cartonsPacked) || 0), 0);
  const totalLoggedLenM = normalizedLogs.reduce((s, l) => s + (Number(l.actualLengthM) || 0), 0);
  const cartonIdsList = Array.from(
    new Set(
      normalizedLogs
        .map(l => (l.cartonId || '').trim())
        .filter(Boolean)
    )
  );
  const cartonIdsStr = cartonIdsList.join(', ');

  // Aggregate colour counts across all log rows
  const aggregatedColours: Record<string, number> = {};
  normalizedLogs.forEach(log => {
    const entries = Object.entries(log.colourCounts || {}).filter(([, cnt]) => Number(cnt) > 0);
    if (entries.length > 0) {
      entries.forEach(([col, cnt]) => {
        const key = col.trim().toUpperCase();
        aggregatedColours[key] = (aggregatedColours[key] || 0) + Number(cnt);
      });
    } else if (log.actualCoils > 0) {
      // Fallback to primary insulation colour if operator only typed total coils
      const fallbackCol =
        (order.ins_colour && !order.ins_colour.includes(':') ? order.ins_colour : 'RED')
          .trim()
          .toUpperCase();
      aggregatedColours[fallbackCol] = (aggregatedColours[fallbackCol] || 0) + Number(log.actualCoils);
    }
  });

  const hasColourBreakdown = Object.keys(aggregatedColours).length > 0;
  const formattedInsColour = hasColourBreakdown
    ? Object.keys(aggregatedColours).length === 1 && order.carton_mode !== 'MIX'
      ? Object.keys(aggregatedColours)[0]
      : Object.entries(aggregatedColours)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ')
    : order.ins_colour;

  const nowIso = new Date().toISOString();
  const nextPStatus =
    totalLoggedCoils > 0
      ? {
          b: true,
          c: Boolean(order.pStatus?.c),
          i: true,
          t: Boolean(order.pStatus?.t),
          s: Boolean(order.pStatus?.s),
        }
      : order.pStatus;

  const nextPTimestamps =
    totalLoggedCoils > 0
      ? {
          ...(order.pTimestamps || {}),
          b: order.pTimestamps?.b || nowIso,
          i: order.pTimestamps?.i || nowIso,
        }
      : order.pTimestamps;

  // If this order has parcel production_lots and targetLotId matches a lot
  const lots = order.production_lots || [];
  const activeLotIdToUse =
    targetLotId && targetLotId !== 'REMAINING' && targetLotId !== 'FULL_ORDER'
      ? targetLotId
      : order.active_plan_lot_id &&
        order.active_plan_lot_id !== 'REMAINING' &&
        order.active_plan_lot_id !== 'FULL_ORDER'
      ? order.active_plan_lot_id
      : undefined;

  if (lots.length > 0 && activeLotIdToUse && lots.some(l => l.id === activeLotIdToUse)) {
    const updatedLots = lots.map(l => {
      if (l.id !== activeLotIdToUse) return l;
      if (totalLoggedCoils <= 0) {
        return {
          ...l,
          operator_production_logs: normalizedLogs,
          carton_ids: cartonIdsStr || undefined,
        };
      }
      return {
        ...l,
        coils: totalLoggedCoils,
        order_length: totalLoggedLenM > 0 ? totalLoggedLenM : Number((totalLoggedCoils * mult).toFixed(1)),
        carton_count:
          totalLoggedCartons > 0
            ? Number(totalLoggedCartons.toFixed(2))
            : cpc > 0
            ? Number((totalLoggedCoils / cpc).toFixed(2))
            : l.carton_count,
        coil_colour_breakdown: hasColourBreakdown ? aggregatedColours : l.coil_colour_breakdown,
        ins_colour: formattedInsColour || l.ins_colour,
        carton_ids: cartonIdsStr || l.carton_ids,
        operator_production_logs: normalizedLogs,
      };
    });

    const newPlannedTotal = updatedLots.reduce((s, l) => s + (Number(l.coils) || 0), 0);
    const totalOrderCoils =
      Number(order.total_order_coils) ||
      newPlannedTotal + (Number(order.coils) || 0);
    const newRemainingCoils = Math.max(0, totalOrderCoils - newPlannedTotal);

    return {
      ...order,
      production_lots: updatedLots,
      planned_coils: newPlannedTotal,
      remaining_coils: newRemainingCoils,
      coils: newRemainingCoils,
      order_length: Number((newRemainingCoils * mult).toFixed(1)),
      operator_production_logs: normalizedLogs,
      carton_ids: cartonIdsStr || order.carton_ids,
      pStatus: nextPStatus,
      pTimestamps: nextPTimestamps,
    };
  }

  // Standard full order sync
  if (totalLoggedCoils <= 0) {
    return {
      ...order,
      operator_production_logs: normalizedLogs,
      carton_ids: cartonIdsStr || undefined,
    };
  }

  return {
    ...order,
    coils: totalLoggedCoils,
    order_length: totalLoggedLenM > 0 ? totalLoggedLenM : Number((totalLoggedCoils * mult).toFixed(1)),
    carton_count:
      totalLoggedCartons > 0
        ? Number(totalLoggedCartons.toFixed(2))
        : cpc > 0
        ? Number((totalLoggedCoils / cpc).toFixed(2))
        : order.carton_count,
    coil_colour_breakdown: hasColourBreakdown ? aggregatedColours : order.coil_colour_breakdown,
    ins_colour: formattedInsColour,
    carton_ids: cartonIdsStr || order.carton_ids,
    operator_production_logs: normalizedLogs,
    pStatus: nextPStatus,
    pTimestamps: nextPTimestamps,
  };
}

/**
 * Releases a partial production plan (e.g., 100 coils now out of 400 coils total)
 * from an order on the Active Orders Sheet:
 * - Creates a new lot in `production_lots` (e.g., Lot #1: 100 Coils) which immediately appears on the IS-694 Packing List & Process Card.
 * - Updates the order on the Active Orders Sheet so its active `coils` and `order_length` reflect the REMAINING coils (e.g., 300 Coils = 27,000 m) for next week!
 */
export function releasePartialProductionPlanForOrder(
  order: CableOrder,
  giveCoilsNow: number,
  vihanRules: VihanTriguardCartonRule[],
  maruRules: MaruMiracleCartonRule[],
  lotDate?: string,
  lotNotes?: string
): CableOrder {
  const coilType = order.coil_type || '90 MTR';
  const mult = getCoilMultiplierByOption(coilType);
  const currentAvailableCoils =
    order.coils !== undefined && order.coils !== '' && Number(order.coils) >= 0
      ? Number(order.coils)
      : mult > 0
      ? Math.round(order.order_length / mult)
      : 0;

  const existingLots = Array.isArray(order.production_lots) ? [...order.production_lots] : [];
  const previouslyPlannedCoils = existingLots.reduce((s, l) => s + (Number(l.coils) || 0), 0);

  const totalOrderCoils =
    order.total_order_coils && order.total_order_coils > 0
      ? Number(order.total_order_coils)
      : previouslyPlannedCoils + currentAvailableCoils;

  const clampedGive = Math.max(1, Math.min(giveCoilsNow, Math.max(1, currentAvailableCoils)));
  const nextRemainingCoils = Math.max(0, currentAvailableCoils - clampedGive);
  const nextPlannedCoils = previouslyPlannedCoils + clampedGive;

  const standard: Is694CartonStandardKey =
    order.carton_standard || inferStandardFromBrand(order.brand);
  const spec = lookupIs694CartonSpec(order.size, standard, coilType, vihanRules, maruRules);
  const mode: Is694CartonMode =
    order.carton_mode || (sumMixBreakdown(spec.mixPerCarton) > 0 && order.coil_colour_breakdown && Object.keys(order.coil_colour_breakdown).length > 1 ? 'MIX' : 'INDIVIDUAL');

  const cpc =
    order.coils_per_carton && order.coils_per_carton > 0
      ? Number(order.coils_per_carton)
      : mode === 'MIX' && sumMixBreakdown(spec.mixPerCarton) > 0
      ? sumMixBreakdown(spec.mixPerCarton)
      : spec.coilsPerCarton || 16;

  const lotCartons = cpc > 0 ? Number((clampedGive / cpc).toFixed(2)) : 0;
  const lotLenM = Number((clampedGive * mult).toFixed(1));

  // Preserve total colour breakdown and split colour breakdown proportionally for the lot and remaining
  const baseTotalColourBreakdown =
    order.total_coil_colour_breakdown ||
    (order.coil_colour_breakdown ? { ...order.coil_colour_breakdown } : undefined);

  let lotColourBreakdown: Record<string, number> | undefined = undefined;
  let remainingColourBreakdown: Record<string, number> | undefined = order.coil_colour_breakdown
    ? { ...order.coil_colour_breakdown }
    : undefined;

  if (mode === 'MIX' && sumMixBreakdown(spec.mixPerCarton) > 0 && lotCartons > 0) {
    lotColourBreakdown = {};
    (['RED', 'BLACK', 'BLUE', 'YELLOW', 'GREEN'] as const).forEach(col => {
      const perCtn = spec.mixPerCarton[col] || 0;
      if (perCtn > 0) {
        lotColourBreakdown![col] = Math.round(perCtn * lotCartons);
      }
    });
    if (remainingColourBreakdown) {
      const nextRemMap: Record<string, number> = {};
      Object.entries(remainingColourBreakdown).forEach(([col, cnt]) => {
        const used = lotColourBreakdown?.[col.toUpperCase()] || 0;
        const left = Math.max(0, Number(cnt) - used);
        if (left > 0) nextRemMap[col] = left;
      });
      remainingColourBreakdown = Object.keys(nextRemMap).length > 0 ? nextRemMap : undefined;
    }
  } else if (order.coil_colour_breakdown && currentAvailableCoils > 0) {
    const share = clampedGive / currentAvailableCoils;
    lotColourBreakdown = {};
    const nextRemMap: Record<string, number> = {};
    Object.entries(order.coil_colour_breakdown).forEach(([col, cnt]) => {
      const allocated = Math.round(Number(cnt) * share);
      if (allocated > 0) lotColourBreakdown![col] = allocated;
      const left = Math.max(0, Number(cnt) - allocated);
      if (left > 0) nextRemMap[col] = left;
    });
    remainingColourBreakdown = Object.keys(nextRemMap).length > 0 ? nextRemMap : undefined;
  }

  const newLotNo = existingLots.length + 1;
  const newLotId = `LOT-${order.id}-${newLotNo}-${Date.now()}`;
  const newLot: Is694ProductionLot = {
    id: newLotId,
    lotNo: newLotNo,
    date: lotDate || new Date().toISOString().split('T')[0],
    coils: clampedGive,
    coil_type: coilType,
    order_length: lotLenM,
    carton_count: lotCartons,
    coils_per_carton: cpc,
    carton_standard: standard,
    carton_mode: mode,
    coil_colour_breakdown: lotColourBreakdown,
    ins_colour:
      lotColourBreakdown && Object.keys(lotColourBreakdown).length > 0
        ? Object.entries(lotColourBreakdown)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ')
        : order.ins_colour,
    notes: lotNotes || `Parcel Production Plan Lot #${newLotNo} (${clampedGive} Coils of ${totalOrderCoils})`,
    dispatched: false,
  };

  const nextLots = [...existingLots, newLot];
  const nextRemainingLen = Number((nextRemainingCoils * mult).toFixed(1));
  const nextRemainingCartons = cpc > 0 ? Number((nextRemainingCoils / cpc).toFixed(2)) : 0;

  return {
    ...order,
    total_order_coils: totalOrderCoils,
    total_order_length: Number((totalOrderCoils * mult).toFixed(1)),
    total_coil_colour_breakdown: baseTotalColourBreakdown,
    planned_coils: nextPlannedCoils,
    remaining_coils: nextRemainingCoils,
    production_lots: nextLots,
    active_plan_lot_id: newLotId,
    // Keep remaining coils & length on the Active Orders Sheet!
    coils: nextRemainingCoils,
    coil_type: coilType,
    order_length: nextRemainingLen,
    carton_count: nextRemainingCartons,
    coils_per_carton: cpc,
    coil_colour_breakdown: remainingColourBreakdown,
  };
}

/**
 * Resets all partial production plans on an order back to the full total order coils on the Order Sheet.
 */
export function resetPartialProductionPlanForOrder(order: CableOrder): CableOrder {
  const coilType = order.coil_type || '90 MTR';
  const mult = getCoilMultiplierByOption(coilType);
  const fullCoils =
    order.total_order_coils && order.total_order_coils > 0
      ? Number(order.total_order_coils)
      : (Number(order.planned_coils) || 0) + (Number(order.coils) || 0);
  const cpc = Number(order.coils_per_carton) || 16;

  return {
    ...order,
    coils: fullCoils,
    order_length: Number((fullCoils * mult).toFixed(1)),
    carton_count: cpc > 0 ? Number((fullCoils / cpc).toFixed(2)) : undefined,
    coil_colour_breakdown: order.total_coil_colour_breakdown || order.coil_colour_breakdown,
    total_order_coils: undefined,
    total_order_length: undefined,
    total_coil_colour_breakdown: undefined,
    planned_coils: undefined,
    remaining_coils: undefined,
    production_lots: undefined,
    active_plan_lot_id: undefined,
  };
}

/**
 * Returns a projection of `order` scoped to its active Partial Production Plan Lot (e.g., 100 Coils)
 * for Process Cards (`TabRequisition`), so the factory floor gets exact copper, insulation, and coiling for the planned batch!
 */
export function getOrderForProcessCardView(
  order: CableOrder,
  selectedLotId?: string | 'REMAINING' | 'FULL_ORDER'
): CableOrder {
  const lots = order.production_lots || [];
  if (lots.length === 0) return order;

  const activeChoice = selectedLotId || order.active_plan_lot_id;
  if (activeChoice === 'REMAINING') {
    return order;
  }
  if (activeChoice === 'FULL_ORDER') {
    const mult = getCoilMultiplierByOption(order.coil_type || '90 MTR');
    const totalCoils =
      order.total_order_coils ||
      lots.reduce((s, l) => s + l.coils, 0) + (Number(order.coils) || 0);
    return {
      ...order,
      coils: totalCoils,
      order_length: Number((totalCoils * mult).toFixed(1)),
      coil_colour_breakdown: order.total_coil_colour_breakdown || order.coil_colour_breakdown,
    };
  }

  const targetLot =
    lots.find(l => l.id === activeChoice) ||
    lots[lots.length - 1];

  if (!targetLot) return order;

  return {
    ...order,
    coils: targetLot.coils,
    coil_type: targetLot.coil_type || order.coil_type,
    order_length: targetLot.order_length,
    carton_count: targetLot.carton_count,
    coils_per_carton: targetLot.coils_per_carton || order.coils_per_carton,
    carton_standard: targetLot.carton_standard || order.carton_standard,
    carton_mode: targetLot.carton_mode || order.carton_mode,
    coil_colour_breakdown: targetLot.coil_colour_breakdown || order.coil_colour_breakdown,
    ins_colour: targetLot.ins_colour || order.ins_colour,
    carton_ids: targetLot.carton_ids || order.carton_ids,
    operator_production_logs: targetLot.operator_production_logs || order.operator_production_logs,
  };
}

export function computeIs694CartonPackingForOrder(
  order: CableOrder,
  densities: DensitySettings,
  ladiDimensions: LadiDimensionRule[],
  vihanRules: VihanTriguardCartonRule[],
  maruRules: MaruMiracleCartonRule[],
  lotOverride?: Is694ProductionLot
): ComputedIs694CartonPackingRow {
  const effectiveOrder: CableOrder = lotOverride
    ? {
        ...order,
        coils: lotOverride.coils,
        coil_type: lotOverride.coil_type || order.coil_type,
        order_length: lotOverride.order_length,
        carton_count: lotOverride.carton_count,
        coils_per_carton: lotOverride.coils_per_carton || order.coils_per_carton,
        carton_standard: lotOverride.carton_standard || order.carton_standard,
        carton_mode: lotOverride.carton_mode || order.carton_mode,
        coil_colour_breakdown: lotOverride.coil_colour_breakdown || order.coil_colour_breakdown,
        ins_colour: lotOverride.ins_colour || order.ins_colour,
        carton_ids: lotOverride.carton_ids || order.carton_ids,
        operator_production_logs: lotOverride.operator_production_logs || order.operator_production_logs,
      }
    : order;

  const rec = computeRecordRow(effectiveOrder, densities, ladiDimensions);
  const standard: Is694CartonStandardKey =
    effectiveOrder.carton_standard || inferStandardFromBrand(effectiveOrder.brand);
  const coilType = effectiveOrder.coil_type || '90 MTR';
  const mult = getCoilMultiplierByOption(coilType);

  const spec = lookupIs694CartonSpec(effectiveOrder.size, standard, coilType, vihanRules, maruRules);

  const rawInsColUpper = (effectiveOrder.ins_colour || '').trim().toUpperCase();
  const isExplicitMix =
    effectiveOrder.carton_mode === 'MIX' ||
    rawInsColUpper === 'MIX' ||
    rawInsColUpper.startsWith('MIX ');

  const mixPerCarton: MixCartonBreakdown = effectiveOrder.mix_pattern_per_carton
    ? {
        RED: Number(effectiveOrder.mix_pattern_per_carton.RED) || 0,
        BLACK: Number(effectiveOrder.mix_pattern_per_carton.BLACK) || 0,
        BLUE: Number(effectiveOrder.mix_pattern_per_carton.BLUE) || 0,
        YELLOW: Number(effectiveOrder.mix_pattern_per_carton.YELLOW) || 0,
        GREEN: Number(effectiveOrder.mix_pattern_per_carton.GREEN) || 0,
      }
    : spec.mixPerCarton;

  const mixSum = sumMixBreakdown(mixPerCarton);

  let colourItems = getIs694ColourCoilsBreakdown(rec, DEFAULT_COLOUR_MAP);
  const defaultMode: Is694CartonMode = isExplicitMix
    ? 'MIX'
    : effectiveOrder.carton_mode ||
      (colourItems.length > 1 && mixSum > 0 ? 'MIX' : 'INDIVIDUAL');

  const coilsPerCarton =
    effectiveOrder.coils_per_carton && effectiveOrder.coils_per_carton > 0
      ? Number(effectiveOrder.coils_per_carton)
      : defaultMode === 'MIX' && mixSum > 0
      ? mixSum
      : spec.coilsPerCarton || 1;

  const totalCoils =
    effectiveOrder.coils !== undefined && effectiveOrder.coils !== '' && Number(effectiveOrder.coils) >= 0
      ? Number(effectiveOrder.coils)
      : colourItems.reduce((s, item) => s + item.coils, 0) ||
        (mult > 0 ? Math.round(rec.orderLen / mult) : 0);

  const fullCartons = coilsPerCarton > 0 ? Math.floor(totalCoils / coilsPerCarton) : 0;
  const looseCoils = coilsPerCarton > 0 ? totalCoils % coilsPerCarton : 0;
  const totalCartons =
    effectiveOrder.carton_count !== undefined && effectiveOrder.carton_count > 0 && !lotOverride
      ? Number(effectiveOrder.carton_count)
      : coilsPerCarton > 0
      ? Number((totalCoils / coilsPerCarton).toFixed(2))
      : 0;

  // If mode is MIX and colourItems only had 1 generic colour (e.g. "MIX" or "RED"), expand colourItems using mixPerCarton!
  if (defaultMode === 'MIX' && mixSum > 0 && colourItems.length <= 1) {
    const expanded: typeof colourItems = [];
    (['RED', 'BLACK', 'BLUE', 'YELLOW', 'GREEN'] as const).forEach(col => {
      const perCtn = mixPerCarton[col] || 0;
      if (perCtn > 0) {
        const cCoils = Math.round((perCtn / mixSum) * totalCoils);
        const cLen = Number((cCoils * mult).toFixed(1));
        expanded.push({
          colour: col,
          coils: cCoils,
          coilType,
          orderLenM: cLen,
          reqCoreLenM: Math.round(cLen * 1.02),
          reqInsKg: rec.orderLen > 0 ? rec.reqIns * (cLen / rec.orderLen) : 0,
        });
      }
    });
    if (expanded.length > 0) {
      colourItems = expanded;
    }
  }

  const isInsulationDone = Boolean(order.pStatus?.i);
  const isDispatched = Boolean(lotOverride ? lotOverride.dispatched : order.dispatched);
  const inStockCartons = isInsulationDone ? totalCartons : 0;
  const dispatchedCartons = isDispatched ? totalCartons : 0;
  const availableCartonStock = Math.max(0, Number((inStockCartons - dispatchedCartons).toFixed(2)));

  const colourDetails = colourItems.map(ci => {
    const cCoils = ci.coils;
    const cCartons =
      defaultMode === 'INDIVIDUAL' && coilsPerCarton > 0
        ? Number((cCoils / coilsPerCarton).toFixed(2))
        : totalCartons;
    const cFull =
      defaultMode === 'INDIVIDUAL' && coilsPerCarton > 0
        ? Math.floor(cCoils / coilsPerCarton)
        : fullCartons;
    const cLoose =
      defaultMode === 'INDIVIDUAL' && coilsPerCarton > 0 ? cCoils % coilsPerCarton : 0;
    const cInStockCartons =
      isInsulationDone && !isDispatched ? cCartons : 0;
    return {
      colour: ci.colour,
      coils: cCoils,
      cartons: cCartons,
      fullCartons: cFull,
      looseCoils: cLoose,
      lengthM: ci.orderLenM,
      inStockCartons: cInStockCartons,
    };
  });

  const netWireWtKg = rec.reqCu + rec.reqIns;
  const cartonTarePerBox =
    order.tare_weight !== undefined && order.tare_weight !== '' ? Number(order.tare_weight) : 1.2;
  const totalCartonTareKg = Math.ceil(totalCartons) * cartonTarePerBox;
  const grossPackingWtKg = netWireWtKg + totalCartonTareKg;

  const standardLabel =
    standard === 'VIHAN_OPTO'
      ? 'VIHAN OPTO'
      : standard === 'TRIGUARD_BOX'
      ? 'TRIGUARD BOX'
      : standard === 'TRIGUARD_STACK'
      ? 'TRIGUARD STACK'
      : standard === 'MARU_MIRACLE'
      ? 'MARU MIRACLE'
      : 'CUSTOM';

  const hasPartialLots = Boolean(order.production_lots && order.production_lots.length > 0);
  const totalOrderedCoils =
    order.total_order_coils && order.total_order_coils > 0
      ? Number(order.total_order_coils)
      : totalCoils;
  const remainingCoilsOnOrderSheet = hasPartialLots
    ? Number(order.coils) || 0
    : order.remaining_coils !== undefined
    ? Number(order.remaining_coils)
    : 0;
  const plannedCoils = lotOverride
    ? lotOverride.coils
    : order.planned_coils !== undefined
    ? Number(order.planned_coils)
    : totalCoils;

  const operatorLogs: Is694OperatorLogEntry[] =
    (lotOverride ? lotOverride.operator_production_logs : undefined) ||
    effectiveOrder.operator_production_logs ||
    [];
  const operatorLoggedCoils = operatorLogs.reduce((s, l) => s + (Number(l.actualCoils) || 0), 0);
  const operatorLoggedCartons = operatorLogs.reduce((s, l) => s + (Number(l.cartonsPacked) || 0), 0);
  const operatorActualMeters = operatorLogs.reduce((s, l) => s + (Number(l.actualLengthM) || 0), 0);
  const operatorActualPvcKg = operatorLogs.reduce((s, l) => s + (Number(l.actualPvcKg) || 0), 0);
  const cartonIds = Array.from(
    new Set([
      ...operatorLogs.map(l => (l.cartonId || '').trim()).filter(Boolean),
      ...((effectiveOrder.carton_ids || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)),
    ])
  );
  const cartonIdsLabel = cartonIds.join(', ');

  const packingSummaryText =
    defaultMode === 'MIX'
      ? `${totalCoils} Coils • ${totalCartons} Mix Cartons × ${coilsPerCarton} Coils/Ctn [${formatMixBreakdownLabel(mixPerCarton)}] (${standardLabel})${cartonIdsLabel ? ` • Carton IDs: ${cartonIdsLabel}` : ''}`
      : `${totalCoils} Coils • ${totalCartons} Individual Cartons × ${coilsPerCarton} Coils/Ctn (${standardLabel})${cartonIdsLabel ? ` • Carton IDs: ${cartonIdsLabel}` : ''}`;

  return {
    rowId: lotOverride ? `order-${order.id}-lot-${lotOverride.id}` : `order-${order.id}`,
    order,
    lot: lotOverride,
    isPartialPlan: Boolean(lotOverride || hasPartialLots),
    lotLabel: lotOverride ? `Lot #${lotOverride.lotNo} (${lotOverride.date})` : undefined,
    totalOrderedCoils,
    plannedCoils,
    remainingCoilsOnOrderSheet,
    standard,
    mode: defaultMode,
    coilType,
    coilMultiplier: mult,
    coilsPerCarton,
    totalCoils,
    totalCartons,
    fullCartons,
    looseCoils,
    orderLengthM: rec.orderLen,
    cuWtKg: rec.reqCu,
    insWtKg: operatorActualPvcKg > 0 ? operatorActualPvcKg : rec.reqIns,
    netWireWtKg,
    cartonTareKg: cartonTarePerBox,
    grossPackingWtKg,
    mixPerCarton,
    colourDetails,
    isInsulationDone: isInsulationDone || operatorLoggedCoils > 0,
    isDispatched,
    inStockCartons: isInsulationDone || operatorLoggedCoils > 0 ? totalCartons : 0,
    dispatchedCartons,
    availableCartonStock: Math.max(
      0,
      Number(((isInsulationDone || operatorLoggedCoils > 0 ? totalCartons : 0) - dispatchedCartons).toFixed(2))
    ),
    packingSummaryText,
    operatorLogs,
    cartonIds,
    cartonIdsLabel,
    operatorLoggedCoils,
    operatorLoggedCartons,
    operatorActualMeters,
    operatorActualPvcKg,
  };
}

/**
 * Generates the rows for the IS-694 Master Carton Packing List.
 * - If an IS-694 order has partial `production_lots` released (e.g., 100 coils out of 400 coils),
 *   only the released production plan lot(s) (e.g. 100 coils) are shown on the IS-694 Packing List,
 *   while the remaining 300 coils stay on the Active Orders Sheet!
 * - If an IS-694 order does not have partial lots, the order itself is shown.
 */
export function computeIs694PackingRowsForOrders(
  orders: CableOrder[],
  densities: DensitySettings,
  ladiDimensions: LadiDimensionRule[],
  vihanRules: VihanTriguardCartonRule[],
  maruRules: MaruMiracleCartonRule[]
): ComputedIs694CartonPackingRow[] {
  const rows: ComputedIs694CartonPackingRow[] = [];
  orders.forEach(o => {
    if (!(o.grade || '').toUpperCase().includes('IS-694')) return;
    if (o.production_lots && o.production_lots.length > 0) {
      o.production_lots.forEach(lot => {
        rows.push(
          computeIs694CartonPackingForOrder(o, densities, ladiDimensions, vihanRules, maruRules, lot)
        );
      });
    } else {
      rows.push(
        computeIs694CartonPackingForOrder(o, densities, ladiDimensions, vihanRules, maruRules)
      );
    }
  });
  return rows;
}

/**
 * Generates and downloads/prints an individual standalone HTML Packing List exclusively for IS-694 Master Cartons.
 */
export function downloadIndividualIs694PackingHtml(
  rows: ComputedIs694CartonPackingRow[],
  customTitle: string = 'IS-694 GRADE — INDIVIDUAL PACKING LIST (COLOUR-WISE COILS & CARTONS + MIX CARTON STOCK)'
): void {
  const totalCartons = rows
    .reduce((s, r) => s + r.totalCartons, 0)
    .toFixed(2)
    .replace(/\.00$/, '');
  const totalCoils = rows.reduce((s, r) => s + r.totalCoils, 0);
  const totalLen = rows.reduce((s, r) => s + r.orderLengthM, 0);
  const totalNet = rows.reduce((s, r) => s + r.netWireWtKg, 0);
  const totalGross = rows.reduce((s, r) => s + r.grossPackingWtKg, 0);
  const mixRows = rows.filter(r => r.mode === 'MIX');
  const indRows = rows.filter(r => r.mode === 'INDIVIDUAL');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${customTitle}</title>
  <style>
    @page { size: A4 landscape; margin: 8mm; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #0f172a; background: #fff; margin: 0; padding: 16px; }
    .header { background: #881337; color: #fff; padding: 14px 18px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
    h3 { font-size: 13px; text-transform: uppercase; color: #881337; margin: 16px 0 6px 0; border-bottom: 2px solid #fda4af; padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 12px; }
    th, td { border: 1.5px solid #334155; padding: 6px 8px; text-align: left; }
    th { background: #9f1239; color: #fff; font-weight: 800; text-transform: uppercase; font-size: 10px; }
    tfoot td { background: #ffe4e6; font-weight: 900; font-size: 11.5px; }
    .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-weight: 800; font-size: 10px; border: 1px solid #fda4af; background: #fff1f2; color: #881337; margin: 1px; }
    .mix-badge { background: #fef3c7; border-color: #f59e0b; color: #78350f; }
    .stock-badge { background: #d1fae5; border-color: #10b981; color: #065f46; }
    @media print { .no-print { display: none !important; } body { padding: 0; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div style="font-size:15px;font-weight:900;letter-spacing:0.03em;">📦 PLUTUS CABLE — ${customTitle}</div>
      <div style="font-size:11px;color:#fecdd3;margin-top:2px;">IS-694 Individual Packing List Only (Drum Size: N/A) • Colour-Wise Coils &amp; Cartons List + Mix Carton Stock • Generated: ${new Date().toLocaleString('en-GB')}</div>
    </div>
    <button class="no-print" onclick="window.print()" style="background:#fbbf24;color:#0f172a;border:none;padding:8px 16px;border-radius:6px;font-weight:900;cursor:pointer;">🖨️ Print IS-694 Individual Packing List</button>
  </div>

  <h3>1. IS-694 Individual Packing List (Colour-Wise Coils &amp; Cartons + Mix Carton Stock)</h3>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Job No / Batch</th>
        <th>Parcel / Plan Lot</th>
        <th>Brand &amp; Size (1C)</th>
        <th>Cond. / Core OD</th>
        <th>Packing Standard</th>
        <th>Mode (Colour-Wise / Mix)</th>
        <th style="text-align:center;">Coil Option</th>
        <th style="text-align:center;">Coils / Carton</th>
        <th style="text-align:center;">No. of Coils</th>
        <th style="text-align:center;">Total Cartons</th>
        <th>Colour-Wise Coils &amp; Cartons List / Mix Details</th>
        <th style="text-align:center;">Carton Stock (Ready / Avail.)</th>
        <th style="text-align:right;">Total Length (m)</th>
        <th style="text-align:right;">Net / Gross Wt (kg)</th>
      </tr>
    </thead>
    <tbody>
      ${rows
        .map(
          (r, i) => `<tr>
        <td style="text-align:center;font-weight:bold;">${i + 1}</td>
        <td><strong>${r.order.batch}</strong></td>
        <td>${
          r.isPartialPlan
            ? `<span class="badge mix-badge">${r.lotLabel || 'Parcel Lot'} (${r.totalCoils} of ${r.totalOrderedCoils} Coils)</span>`
            : `<span class="badge">Full Order (${r.totalCoils} Coils)</span>`
        }</td>
        <td><strong>${r.order.brand} • 1C × ${r.order.size}</strong><br/><span style="font-size:9.5px;color:#881337;">Grade: IS-694 • Drum: N/A</span></td>
        <td>${r.order.conductor}<br/><span style="font-size:9.5px;color:#0f766e;">OD: ${r.order.core_od} mm (${r.order.ins_compound})</span></td>
        <td><strong>${r.standard.replace(/_/g, ' ')}</strong></td>
        <td><strong>${r.mode === 'MIX' ? 'MIX COLOUR CARTON' : 'INDIVIDUAL COLOUR-WISE'}</strong></td>
        <td style="text-align:center;font-weight:bold;">${r.coilType}</td>
        <td style="text-align:center;font-weight:900;">${r.coilsPerCarton}</td>
        <td style="text-align:center;font-weight:900;">${r.totalCoils} Coils</td>
        <td style="text-align:center;font-weight:900;background:#fef3c7;">
          ${r.totalCartons} Cartons
          ${r.cartonIdsLabel ? `<div style="font-size:9.5px;color:#78350f;margin-top:2px;">IDs: ${r.cartonIdsLabel}</div>` : ''}
        </td>
        <td>
          ${
            r.operatorLogs.length > 0
              ? `<div style="margin-bottom:3px;"><span class="badge stock-badge">⚡ Operator Log Synced (${r.operatorLoggedCoils} Coils / ${r.operatorLoggedCartons} Ctns)</span></div>`
              : ''
          }
          ${
            r.mode === 'MIX'
              ? `<div style="margin-bottom:3px;"><span class="badge mix-badge">Mix/Carton: ${formatMixBreakdownLabel(r.mixPerCarton)} (${r.coilsPerCarton} Coils)</span></div>` +
                `<div><strong>No. of Coils: ${r.totalCoils} Coils</strong> (${r.colourDetails.map(cd => `${cd.colour}: ${cd.coils} Coils`).join(', ')})</div>`
              : r.colourDetails
                  .map(cd => `<div style="margin-bottom:2px;"><span class="badge">🎨 ${cd.colour}: <strong>${cd.coils} Coils</strong> → <strong>${cd.cartons} Cartons</strong> (${r.coilsPerCarton}/Ctn)</span></div>`)
                  .join('')
          }
        </td>
        <td style="text-align:center;">
          ${
            r.mode === 'MIX'
              ? `<span class="badge stock-badge">Mix Carton Stock: <strong>${r.availableCartonStock} Mix Ctns</strong> (${r.totalCoils} Coils)</span>`
              : `<span class="badge stock-badge">Carton Stock: <strong>${r.availableCartonStock} Ctns</strong></span>`
          }
          <div style="font-size:9px;color:#475569;margin-top:2px;">${
            r.isDispatched
              ? 'Dispatched'
              : r.isInsulationDone
              ? '✅ In Finished Carton Stock'
              : '⏳ Pending IS-694 Insulation'
          }</div>
        </td>
        <td style="text-align:right;font-weight:900;">${r.orderLengthM.toLocaleString()} m</td>
        <td style="text-align:right;">Net: ${r.netWireWtKg.toFixed(2)} kg<br/><strong>Gross: ${r.grossPackingWtKg.toFixed(2)} kg</strong></td>
      </tr>`
        )
        .join('')}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="9" style="text-align:right;">TOTAL IS-694 INDIVIDUAL PACKING SUMMARY:</td>
        <td style="text-align:center;">${totalCoils} Coils</td>
        <td style="text-align:center;">${totalCartons} Cartons</td>
        <td colspan="2"></td>
        <td style="text-align:right;">${totalLen.toLocaleString()} m</td>
        <td style="text-align:right;">Net: ${totalNet.toFixed(2)} kg / Gross: ${totalGross.toFixed(2)} kg</td>
      </tr>
    </tfoot>
  </table>

  ${
    indRows.length > 0
      ? `<h3>2. Colour-Wise Coils &amp; Individual Cartons List</h3>
  <table>
    <thead>
      <tr>
        <th>Job No</th>
        <th>Brand &amp; Size (1C)</th>
        <th>Insulation Colour</th>
        <th style="text-align:center;">Coil Option</th>
        <th style="text-align:center;">Coils / Carton</th>
        <th style="text-align:center;">Colour-Wise Coils</th>
        <th style="text-align:center;">Colour-Wise Cartons</th>
        <th style="text-align:right;">Wire Length (m)</th>
        <th style="text-align:center;">Colour Carton Stock Status</th>
      </tr>
    </thead>
    <tbody>
      ${indRows
        .flatMap(r =>
          r.colourDetails.map(
            cd => `<tr>
        <td><strong>${r.order.batch}</strong></td>
        <td><strong>${r.order.brand} • 1C × ${r.order.size}</strong></td>
        <td><span class="badge">🎨 ${cd.colour}</span></td>
        <td style="text-align:center;">${r.coilType}</td>
        <td style="text-align:center;font-weight:bold;">${r.coilsPerCarton}</td>
        <td style="text-align:center;font-weight:900;">${cd.coils} Coils</td>
        <td style="text-align:center;font-weight:900;background:#fff1f2;">${cd.cartons} Cartons</td>
        <td style="text-align:right;font-weight:bold;">${cd.lengthM.toLocaleString()} m</td>
        <td style="text-align:center;">${
          r.isDispatched
            ? 'Dispatched'
            : r.isInsulationDone
            ? `✅ In Stock (${cd.cartons} Ctns)`
            : '⏳ Pending Insulation'
        }</td>
      </tr>`
          )
        )
        .join('')}
    </tbody>
  </table>`
      : ''
  }

  ${
    mixRows.length > 0
      ? `<h3>3. IS-694 Mix Colour Coils &amp; Mix Carton Stock List</h3>
  <table>
    <thead>
      <tr>
        <th>Job No</th>
        <th>Brand &amp; Size (1C)</th>
        <th>Mix Pattern / Carton</th>
        <th style="text-align:center;">Coils / Mix Carton</th>
        <th style="text-align:center;">Total No. of Coils</th>
        <th>Colour-Wise Coils Inside Mix</th>
        <th style="text-align:center;">Total Mix Cartons</th>
        <th style="text-align:center;">Mix Carton Stock (Available)</th>
      </tr>
    </thead>
    <tbody>
      ${mixRows
        .map(
          r => `<tr>
        <td><strong>${r.order.batch}</strong></td>
        <td><strong>${r.order.brand} • 1C × ${r.order.size}</strong></td>
        <td><span class="badge mix-badge">${formatMixBreakdownLabel(r.mixPerCarton)}</span></td>
        <td style="text-align:center;font-weight:bold;">${r.coilsPerCarton}</td>
        <td style="text-align:center;font-weight:900;">${r.totalCoils} Coils</td>
        <td>${r.colourDetails.map(cd => `<span class="badge">${cd.colour}: ${cd.coils} Coils</span>`).join(' ')}</td>
        <td style="text-align:center;font-weight:900;background:#fef3c7;">${r.totalCartons} Mix Cartons</td>
        <td style="text-align:center;font-weight:900;background:#d1fae5;color:#065f46;">${
          r.isInsulationDone && !r.isDispatched
            ? `${r.availableCartonStock} Mix Cartons in Stock (${r.totalCoils} Coils)`
            : r.isDispatched
            ? '0 Mix Cartons (Dispatched)'
            : `Pending Insulation (${r.totalCartons} Mix Cartons Planned)`
        }</td>
      </tr>`
        )
        .join('')}
    </tbody>
  </table>`
      : ''
  }
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `IS694_INDIVIDUAL_PACKING_LIST_${new Date().toISOString().split('T')[0]}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


