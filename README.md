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

## Two ways to connect

- **Live subscription** (`/live`): sign in with a Microsoft account. This is what other people use.
- **This PC (Azure CLI)** (`/local`): uses the `az login` session on the machine running the app. Only works locally (the server refuses it in production unless `AZURE_AUTH_MODE=cli`), and the tab is hidden in production builds.

Each tab remembers its own subscription and resource group choices.

## Letting other people connect their Azure

For anyone other than you, turn on Microsoft sign-in:

1. Create the app registration (multi-tenant SPA, delegated `Azure Service Management / user_impersonation`):
   ```powershell
   .\scripts\create-entra-app.ps1 -Origins "http://localhost:3100","https://your-domain.com"
   ```
2. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_ENTRA_CLIENT_ID`.
3. Deploy with `AZURE_AUTH_MODE` unset or `bearer`. **Never set `AZURE_AUTH_MODE=cli` on a public deployment**: it would let visitors read the host's Azure account.

Users sign in with a popup; the browser gets an ARM token and sends it to the API routes, which call Azure on the user's behalf. Nothing is stored on the server.

### "Approval required" and making it public

Whether a user can approve the app themselves is set by **their** organization, not by this app:

- Organizations that let users consent: users approve on first sign-in.
- Organizations that don't (common, and the case for many companies): the sign-in page shows an **admin approval link**. An admin opens it once, approves the app for the whole directory, and lands on `/auth/admin-consent`. After that everyone there can sign in and sees only what their own Azure role allows.

To make approval smoother for the public:

1. **Verify the publisher** so the consent screen stops saying "unverified": join the free Microsoft AI Cloud Partner Program, add a verified domain to the app registration, then run publisher verification (Entra ID → App registrations → Branding & properties).
2. **Deploy to a real domain** and add `https://your-domain/auth/redirect` (SPA) and `https://your-domain/auth/admin-consent` (Web) to the app registration, or re-run the script with that origin.
3. Add a privacy statement and terms of service URL to the app registration; admins look for these before approving.

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
