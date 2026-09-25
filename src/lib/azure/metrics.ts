import "server-only";
import { armFetch } from "./arm";
import type { AzureResource } from "../types";

interface MetricsResponse {
  value: { timeseries: { data: { average?: number }[] }[] }[];
}

/**
 * Reads the latest UsedCapacity metric for each storage account and stores it
 * as `properties.__capacityGB`, so the pricing engine can price actual storage.
 * Failures are ignored: the account then shows as usage-based.
 */
export async function attachStorageCapacity(token: string, resources: AzureResource[]) {
  const accounts = resources.filter((r) => r.type === "microsoft.storage/storageaccounts");
  await Promise.all(
    accounts.map(async (r) => {
      try {
        const res = await armFetch<MetricsResponse>(
          token,
          `${r.id}/providers/Microsoft.Insights/metrics?api-version=2023-10-01&metricnames=UsedCapacity&aggregation=Average&interval=PT1H&timespan=PT24H`,
        );
        const points = res.value[0]?.timeseries[0]?.data ?? [];
        const latest = [...points].reverse().find((p) => typeof p.average === "number");
        if (latest?.average != null) r.properties.__capacityGB = latest.average / 1024 ** 3;
      } catch {
        /* metric unavailable */
      }
    }),
  );
}
