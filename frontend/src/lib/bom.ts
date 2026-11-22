// Phase 4 product lifecycle: cost build-up from the bill of materials, and supplier/shipment traceability.
export interface ProductRec { id: string; sku: string; name: string; kind: string; unit_cost: number; unit_price: number | null; conversion_cost: number | null; primary_supplier_id: string | null }
export interface BomRec { id: string; parent_product_id: string; component_product_id: string; quantity_per_unit: number }
export interface SupplierRec { id: string; name: string; country: string; on_time_delivery_rate: number | null; risk_exposure_score: number | null }

export function costBuildUp(fg: ProductRec, bom: BomRec[], products: ProductRec[]) {
  const byId = new Map(products.map((p) => [p.id, p]))
  const lines = bom.filter((b) => b.parent_product_id === fg.id).map((b) => {
    const c = byId.get(b.component_product_id)
    return { id: b.id, sku: c?.sku ?? '?', name: c?.name ?? 'Unknown', qty: b.quantity_per_unit, unitCost: c?.unit_cost ?? 0, cost: b.quantity_per_unit * (c?.unit_cost ?? 0), supplierId: c?.primary_supplier_id ?? null, componentId: b.component_product_id }
  }).sort((a, b) => b.cost - a.cost)
  const material = lines.reduce((a, l) => a + l.cost, 0)
  const conversion = fg.conversion_cost ?? 0
  const builtCost = material + conversion
  const margin = fg.unit_price != null ? fg.unit_price - builtCost : null
  return {
    lines, material, conversion, builtCost,
    recordedCost: fg.unit_cost, variance: builtCost - fg.unit_cost,
    margin, marginPct: fg.unit_price ? ((margin ?? 0) / fg.unit_price) * 100 : null,
    materialSharePct: builtCost ? (material / builtCost) * 100 : null,
  }
}

/** Which suppliers a finished good depends on, weighted by their share of material cost. */
export function supplierExposure(lines: ReturnType<typeof costBuildUp>['lines'], suppliers: SupplierRec[]) {
  const total = lines.reduce((a, l) => a + l.cost, 0)
  const byId = new Map(suppliers.map((s) => [s.id, s]))
  const agg = new Map<string, { supplier: SupplierRec | null; cost: number; skus: string[] }>()
  for (const l of lines) {
    const k = l.supplierId ?? 'none'
    const e = agg.get(k) ?? { supplier: l.supplierId ? byId.get(l.supplierId) ?? null : null, cost: 0, skus: [] }
    e.cost += l.cost; e.skus.push(l.sku); agg.set(k, e)
  }
  return [...agg.values()].map((e) => ({ ...e, sharePct: total ? (e.cost / total) * 100 : 0 })).sort((a, b) => b.cost - a.cost)
}
