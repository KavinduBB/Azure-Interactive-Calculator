/** Friendly names and categories for resource types. Safe to import in the browser. */

export type Category = "compute" | "web" | "data" | "storage" | "network" | "containers" | "ai" | "monitoring" | "security" | "integration" | "other";

interface TypeInfo {
  label: string;
  category: Category;
}

const TYPES: Record<string, TypeInfo> = {
  "microsoft.compute/virtualmachines": { label: "Virtual machine", category: "compute" },
  "microsoft.compute/virtualmachinescalesets": { label: "VM scale set", category: "compute" },
  "microsoft.compute/disks": { label: "Managed disk", category: "storage" },
  "microsoft.compute/snapshots": { label: "Disk snapshot", category: "storage" },
  "microsoft.compute/availabilitysets": { label: "Availability set", category: "compute" },
  "microsoft.web/serverfarms": { label: "App Service plan", category: "web" },
  "microsoft.web/sites": { label: "App Service", category: "web" },
  "microsoft.web/staticsites": { label: "Static Web App", category: "web" },
  "microsoft.web/connections": { label: "API connection", category: "integration" },
  "microsoft.sql/servers": { label: "SQL server", category: "data" },
  "microsoft.sql/servers/databases": { label: "SQL database", category: "data" },
  "microsoft.sql/servers/elasticpools": { label: "SQL elastic pool", category: "data" },
  "microsoft.dbforpostgresql/flexibleservers": { label: "PostgreSQL flexible server", category: "data" },
  "microsoft.dbformysql/flexibleservers": { label: "MySQL flexible server", category: "data" },
  "microsoft.documentdb/databaseaccounts": { label: "Cosmos DB", category: "data" },
  "microsoft.cache/redis": { label: "Redis cache", category: "data" },
  "microsoft.storage/storageaccounts": { label: "Storage account", category: "storage" },
  "microsoft.network/virtualnetworks": { label: "Virtual network", category: "network" },
  "microsoft.network/networkinterfaces": { label: "Network interface", category: "network" },
  "microsoft.network/networksecuritygroups": { label: "Network security group", category: "network" },
  "microsoft.network/publicipaddresses": { label: "Public IP", category: "network" },
  "microsoft.network/privateendpoints": { label: "Private endpoint", category: "network" },
  "microsoft.network/privatednszones": { label: "Private DNS zone", category: "network" },
  "microsoft.network/privatednszones/virtualnetworklinks": { label: "DNS VNet link", category: "network" },
  "microsoft.network/loadbalancers": { label: "Load balancer", category: "network" },
  "microsoft.network/applicationgateways": { label: "Application gateway", category: "network" },
  "microsoft.network/natgateways": { label: "NAT gateway", category: "network" },
  "microsoft.network/bastionhosts": { label: "Bastion", category: "network" },
  "microsoft.network/routetables": { label: "Route table", category: "network" },
  "microsoft.network/frontdoors": { label: "Front Door", category: "network" },
  "microsoft.cdn/profiles": { label: "CDN / Front Door profile", category: "network" },
  "microsoft.containerservice/managedclusters": { label: "AKS cluster", category: "containers" },
  "microsoft.containerregistry/registries": { label: "Container registry", category: "containers" },
  "microsoft.app/containerapps": { label: "Container App", category: "containers" },
  "microsoft.app/managedenvironments": { label: "Container Apps environment", category: "containers" },
  "microsoft.cognitiveservices/accounts": { label: "Azure AI service", category: "ai" },
  "microsoft.insights/components": { label: "Application Insights", category: "monitoring" },
  "microsoft.operationalinsights/workspaces": { label: "Log Analytics workspace", category: "monitoring" },
  "microsoft.insights/activitylogalerts": { label: "Activity log alert", category: "monitoring" },
  "microsoft.insights/metricalerts": { label: "Metric alert", category: "monitoring" },
  "microsoft.keyvault/vaults": { label: "Key Vault", category: "security" },
  "microsoft.managedidentity/userassignedidentities": { label: "Managed identity", category: "security" },
  "microsoft.servicebus/namespaces": { label: "Service Bus", category: "integration" },
  "microsoft.eventhub/namespaces": { label: "Event Hubs", category: "integration" },
  "microsoft.logic/workflows": { label: "Logic App", category: "integration" },
  "microsoft.signalrservice/signalr": { label: "SignalR", category: "integration" },
};

export function typeInfo(type: string): TypeInfo {
  const t = TYPES[type.toLowerCase()];
  if (t) return t;
  const last = type.split("/").pop() ?? type;
  return { label: last.replace(/([a-z])([A-Z])/g, "$1 $2"), category: "other" };
}

/** Types that are free and structural; the diagram can hide them to reduce clutter. */
export const MINOR_TYPES = new Set([
  "microsoft.network/networkinterfaces",
  "microsoft.network/networksecuritygroups",
  "microsoft.network/privatednszones/virtualnetworklinks",
  "microsoft.insights/activitylogalerts",
  "microsoft.insights/metricalerts",
  "microsoft.managedidentity/userassignedidentities",
]);

export const REGIONS: { name: string; label: string }[] = [
  { name: "centralindia", label: "Central India (Pune)" },
  { name: "southindia", label: "South India (Chennai)" },
  { name: "southeastasia", label: "Southeast Asia (Singapore)" },
  { name: "eastasia", label: "East Asia (Hong Kong)" },
  { name: "eastus", label: "East US" },
  { name: "eastus2", label: "East US 2" },
  { name: "westus2", label: "West US 2" },
  { name: "centralus", label: "Central US" },
  { name: "canadacentral", label: "Canada Central" },
  { name: "uksouth", label: "UK South" },
  { name: "westeurope", label: "West Europe" },
  { name: "northeurope", label: "North Europe" },
  { name: "germanywestcentral", label: "Germany West Central" },
  { name: "uaenorth", label: "UAE North" },
  { name: "australiaeast", label: "Australia East" },
  { name: "japaneast", label: "Japan East" },
];

export function portalUrl(id: string) {
  return `https://portal.azure.com/#@/resource${id}`;
}
