/** Shared between server routes and the browser. */

export interface AzureResource {
  id: string; // original casing
  key: string; // lowercased id, used for joins
  name: string;
  type: string; // lowercased, e.g. microsoft.web/sites
  kind?: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  sku?: { name?: string; tier?: string; size?: string; family?: string; capacity?: number } | null;
  tags?: Record<string, string> | null;
  properties: Record<string, unknown>;
}

export type EstimateStatus = "priced" | "free" | "usage" | "unknown" | "stopped";

export interface PriceLine {
  label: string;
  unitPrice: number;
  unit: string;
  quantity: number; // units per month
  monthly: number;
  meter?: string;
}

export interface ResourceEstimate {
  key: string;
  status: EstimateStatus;
  monthly: number; // 0 unless priced
  currency: string;
  lines: PriceLine[];
  note?: string;
}

export interface ActualCost {
  key: string;
  cost: number;
  currency: string;
}

export interface CostResult {
  available: boolean;
  reason?: string;
  currency?: string;
  from?: string;
  to?: string;
  total: number;
  byResource: ActualCost[];
}

export interface Subscription {
  subscriptionId: string;
  displayName: string;
  state: string;
  tenantId?: string;
  quotaId?: string;
}

export interface Tenant {
  tenantId: string;
  displayName: string;
  defaultDomain?: string;
}

export interface RetailPrice {
  currencyCode: string;
  retailPrice: number;
  unitPrice: number;
  armRegionName: string;
  location: string;
  meterName: string;
  productName: string;
  skuName: string;
  armSkuName: string;
  serviceName: string;
  serviceFamily: string;
  unitOfMeasure: string;
  type: string;
  meterId: string;
  isPrimaryMeterRegion?: boolean;
  tierMinimumUnits?: number;
}

export const CURRENCIES = ["USD", "EUR", "GBP", "AUD", "CAD", "INR", "JPY", "SGD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const HOURS_PER_MONTH = 730;
