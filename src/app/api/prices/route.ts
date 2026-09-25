import { retailPrices, odata } from "@/lib/pricing/retail";
import { CURRENCIES } from "@/lib/types";

/**
 * Search the public price list for the estimate builder.
 * The OData filter is assembled here from known fields only, never passed through from the browser.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const currency = CURRENCIES.includes(q.get("currency") as never) ? q.get("currency")! : "USD";
  const clauses = ["priceType eq 'Consumption'"];
  const service = q.get("service");
  const region = q.get("region");
  const armSku = q.get("armSku");
  const sku = q.get("sku");
  const product = q.get("product");
  const search = q.get("search");
  if (service) clauses.push(`serviceName eq ${odata(service)}`);
  if (region) clauses.push(`armRegionName eq ${odata(region.toLowerCase())}`);
  if (armSku) clauses.push(`armSkuName eq ${odata(armSku)}`);
  if (sku) clauses.push(`skuName eq ${odata(sku)}`);
  if (product) clauses.push(`contains(productName, ${odata(product)})`);
  if (search) {
    const s = odata(search);
    clauses.push(`(contains(productName, ${s}) or contains(skuName, ${s}) or contains(meterName, ${s}))`);
  }
  if (clauses.length < 3 && !service) {
    return Response.json({ error: "Add a service or region to narrow the search." }, { status: 400 });
  }
  try {
    const items = await retailPrices(clauses.join(" and "), currency, Number(q.get("pages") ?? 3));
    const cleaned = items
      .filter((i) => !/spot|low priority/i.test(i.meterName) && Number(i.tierMinimumUnits ?? 0) === 0)
      .slice(0, 500);
    return Response.json({ currency, count: cleaned.length, items: cleaned });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
