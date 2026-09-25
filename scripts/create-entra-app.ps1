<#
Creates the multi-tenant Entra app registration used for "Sign in with Microsoft".

  .\scripts\create-entra-app.ps1 -Origins "http://localhost:3100","https://your-domain.com"

Requires the Azure CLI signed in to the tenant that will own the app (az login).
Prints the client ID to put in NEXT_PUBLIC_ENTRA_CLIENT_ID.
#>
param(
  [string]$Name = "Azure Cost Canvas",
  [string[]]$Origins = @("http://localhost:3100")
)

$ErrorActionPreference = "Stop"
$redirects = $Origins | ForEach-Object { "$($_.TrimEnd('/'))/auth/redirect" }
# Where a customer's admin lands after approving the app for their whole organization.
$consentRedirects = $Origins | ForEach-Object { "$($_.TrimEnd('/'))/auth/admin-consent" }

# Azure Service Management API and its delegated user_impersonation permission.
$armApi = "797f4846-ba00-4fd7-ba43-dac1f8f63013"
$userImpersonation = "41094075-9dad-400e-a0bd-54e686782033"

$app = az ad app create `
  --display-name $Name `
  --sign-in-audience AzureADMultipleOrgs `
  --query "{appId:appId, id:id}" -o json | ConvertFrom-Json

$spa = @{ spa = @{ redirectUris = $redirects }; web = @{ redirectUris = $consentRedirects } } | ConvertTo-Json -Depth 5 -Compress
$spaFile = New-TemporaryFile
# Write without a byte-order mark; Windows PowerShell's utf8 encoding adds one, which Graph rejects.
[System.IO.File]::WriteAllText($spaFile.FullName, $spa, (New-Object System.Text.UTF8Encoding $false))
az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$($app.id)" --headers "Content-Type=application/json" --body "@$spaFile" | Out-Null
Remove-Item $spaFile

az ad app permission add --id $app.appId --api $armApi --api-permissions "$userImpersonation=Scope" | Out-Null

Write-Host ""
Write-Host "Created app registration '$Name'."
Write-Host "Redirect URIs: $($redirects -join ', ')"
Write-Host ""
Write-Host "Add this to .env.local:"
Write-Host "NEXT_PUBLIC_ENTRA_CLIENT_ID=$($app.appId)"
