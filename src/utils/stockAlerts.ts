import { PurchaseItem, StockThresholdSettings } from '../types/cable';

export const DEFAULT_STOCK_THRESHOLDS: StockThresholdSettings = {
  copperThreshold: 500, // 500 kg default threshold for Copper
  pvcThreshold: 300,    // 300 kg default threshold for PVC / Compounds
};

export type RawMaterialCategory = 'copper' | 'pvc' | 'drums' | 'other';

/**
 * Classifies a purchase entry into raw material categories
 * Specifically identifying Copper (drawn, bunched, rod, wire) vs PVC / Compounds
 */
export function classifyPurchaseItem(item: PurchaseItem): RawMaterialCategory {
  if (item.stage === 'drums') return 'drums';
  if (item.stage === 'compound') return 'pvc';
  if (item.stage === 'bunch' || item.stage === 'raw') return 'copper';

  const desc = (item.description || '').toLowerCase();
  const party = (item.party || '').toLowerCase();
  const combined = `${desc} ${party}`;

  // PVC & Compound indicators
  if (/pvc|compound|etp|sheath|insulation|xlpe|fr\b|frls|masterbatch|a80|hd\s*black|poly|pe\b/.test(combined)) {
    return 'pvc';
  }

  // Copper indicators
  if (
    /copper|cu\b|drawn|strand|rod|wire|bunch|bitzer|mahalaxmi|hindalco|vedanta|conductor/.test(combined) ||
    Boolean(item.conductor && item.conductor.trim() !== '')
  ) {
    return 'copper';
  }

  // Drums / packaging
  if (/drum|wooden|packaging|pallet|spool/.test(combined)) {
    return 'drums';
  }

  return 'other';
}

export interface LowStockItemDetail {
  item: PurchaseItem;
  materialCategory: 'copper' | 'pvc';
  available: number;
  threshold: number;
  deficit: number;
}

export interface StockEvaluationResult {
  hasLowStock: boolean;
  lowItems: LowStockItemDetail[];
  copperLowCount: number;
  pvcLowCount: number;
  totalCopperAvailable: number;
  totalPvcAvailable: number;
  totalCopperPurchased: number;
  totalPvcPurchased: number;
  isTotalCopperLow: boolean;
  isTotalPvcLow: boolean;
}

/**
 * Evaluates purchase sheet items against user-defined thresholds
 */
export function evaluateStockLevels(
  items: PurchaseItem[],
  thresholds: StockThresholdSettings
): StockEvaluationResult {
  const lowItems: LowStockItemDetail[] = [];
  let copperLowCount = 0;
  let pvcLowCount = 0;
  let totalCopperAvailable = 0;
  let totalPvcAvailable = 0;
  let totalCopperPurchased = 0;
  let totalPvcPurchased = 0;

  items.forEach(item => {
    // Only check active or received items (skip purely cancelled if any)
    const category = classifyPurchaseItem(item);
    const used = item.usedQty || 0;
    const available = Math.max(0, (item.qty || 0) - used);

    if (category === 'copper') {
      totalCopperPurchased += item.qty || 0;
      totalCopperAvailable += available;
      if (available < thresholds.copperThreshold) {
        copperLowCount++;
        lowItems.push({
          item,
          materialCategory: 'copper',
          available,
          threshold: thresholds.copperThreshold,
          deficit: Math.max(0, thresholds.copperThreshold - available),
        });
      }
    } else if (category === 'pvc') {
      totalPvcPurchased += item.qty || 0;
      totalPvcAvailable += available;
      if (available < thresholds.pvcThreshold) {
        pvcLowCount++;
        lowItems.push({
          item,
          materialCategory: 'pvc',
          available,
          threshold: thresholds.pvcThreshold,
          deficit: Math.max(0, thresholds.pvcThreshold - available),
        });
      }
    }
  });

  const isTotalCopperLow = totalCopperAvailable < thresholds.copperThreshold;
  const isTotalPvcLow = totalPvcAvailable < thresholds.pvcThreshold;
  const hasLowStock = lowItems.length > 0 || isTotalCopperLow || isTotalPvcLow;

  return {
    hasLowStock,
    lowItems,
    copperLowCount,
    pvcLowCount,
    totalCopperAvailable,
    totalPvcAvailable,
    totalCopperPurchased,
    totalPvcPurchased,
    isTotalCopperLow,
    isTotalPvcLow,
  };
}
