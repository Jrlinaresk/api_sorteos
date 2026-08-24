export const DEFAULT_ORDER_MAX_ALLOCATED_TITLES = 2_000;
export const ABSOLUTE_ORDER_MAX_ALLOCATED_TITLES = 10_000;

/**
 * Límite defensivo de documentos de cuota creados o mutados por checkout.
 * Incluye siempre las cuotas promocionales/bonus, no solo las pagadas.
 */
export function orderMaxAllocatedTitles(): number {
  const raw = process.env.ORDER_MAX_ALLOCATED_TITLES?.trim();
  const configured = raw ? Number(raw) : Number.NaN;
  return Number.isSafeInteger(configured)
    ? Math.min(ABSOLUTE_ORDER_MAX_ALLOCATED_TITLES, Math.max(1, configured))
    : DEFAULT_ORDER_MAX_ALLOCATED_TITLES;
}

export function maxSelectedTitles(
  configuredCampaignMaximum: number,
  allocationMultiplier: number,
): number {
  const safeCampaignMaximum = Number.isSafeInteger(configuredCampaignMaximum)
    ? Math.max(0, configuredCampaignMaximum)
    : 0;
  const safeMultiplier =
    Number.isSafeInteger(allocationMultiplier) && allocationMultiplier > 0
      ? allocationMultiplier
      : 1;
  return Math.min(
    safeCampaignMaximum,
    Math.floor(orderMaxAllocatedTitles() / safeMultiplier),
  );
}
