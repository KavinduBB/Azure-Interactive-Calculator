# Azure Cost Canvas

Estimate Azure costs on a canvas, or connect a subscription to see your live architecture as a diagram with a monthly cost on every resource.

- **Estimate** (`/estimate`): add VMs, App Service plans, SQL, PostgreSQL, MySQL, storage, disks and more; change sizes and regions and the total updates. Saved in the browser. Export to CSV.
- **Live subscription** (`/live`): pick subscriptions and resource groups. Resources are grouped by resource group and linked by the IDs they reference (VM → disk, NIC → VNet, web app → plan, database → server). Each one is priced from its real SKU, region and power state. Auto-refresh shows created, deleted, started and stopped resources. What-if pricing compares other sizes. "Copy to estimate" takes the architecture into the estimate builder.

## Run it

```bash
npm install
az login          # local development reads your Azure CLI session
npm run dev -- --port 3100
```

Open http://localhost:3100.

## How costs are worked out

| Source | Used for | Notes |
|---|---|---|
| [Azure Retail Prices API](https://learn.microsoft.com/rest/api/cost-management/retail-prices/azure-retail-prices) | Every estimate | Public, no sign-in. Pay-as-you-go list prices, cached 12 hours on the server. |
| Azure Resource Graph | Resources and their SKUs | Needs Reader on the subscription. |
| Cost Management query API | Actual spend this month | Needs Cost Management Reader. Not available for Sponsorship subscriptions and some other offers; the app says so and shows estimates. |
| Azure Monitor metrics | Storage account used capacity | So storage is priced on what's actually stored. |

Pricing rules live in `src/lib/pricing/rules.ts`, one function per resource type. Types without a rule are shown as "Not priced"; usage-billed services (Functions consumption, Log Analytics, Key Vault) are shown as usage-based rather than guessed.

Priced today: virtual machines and scale sets (Windows and Linux, Azure Hybrid Benefit, deallocated), managed disks, public IPs, private endpoints, private DNS zones, App Service plans, Static Web Apps, SQL Database (DTU and vCore, including the SQL licence meter), PostgreSQL and MySQL flexible servers, container registries, storage accounts (from used capacity).

## Letting other people connect their Azure

Local development uses your `az login`. For anyone else, turn on Microsoft sign-in:

1. Create the app registration (multi-tenant SPA, delegated `Azure Service Management / user_impersonation`):
   ```powershell
   .\scripts\create-entra-app.ps1 -Origins "http://localhost:3100","https://your-domain.com"
   ```
2. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_ENTRA_CLIENT_ID`.
3. Deploy with `AZURE_AUTH_MODE` unset or `bearer`. **Never set `AZURE_AUTH_MODE=cli` on a public deployment**: it would let visitors read the host's Azure account.

Users sign in with a popup; the browser gets an ARM token and sends it to the API routes, which call Azure on the user's behalf. Nothing is stored on the server.

## Project layout

```
src/lib/azure/      ARM client, auth, Resource Graph, Cost Management, metrics (server only)
src/lib/pricing/    Retail Prices client and per-type pricing rules (server only)
src/lib/graph.ts    Diagram links and layout (dagre per resource group)
src/lib/templates.ts  Estimate builder services
src/app/api/        Route handlers: status, subscriptions, resource-groups, snapshot, estimate, prices
src/app/live/       Live subscription view
src/app/estimate/   Estimate builder
```
