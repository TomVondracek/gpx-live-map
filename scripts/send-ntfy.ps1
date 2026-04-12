[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Topic,

  [Parameter(Mandatory = $true)]
  [string]$Message,

  [string]$Title = "UltraLog deploy finished",

  [ValidateSet("min", "low", "default", "high", "max")]
  [string]$Priority = "default",

  [string[]]$Tags = @(),

  [switch]$IgnoreErrors
)

$ErrorActionPreference = "Stop"

$uri = "https://ntfy.sh/$Topic"
$headers = @{}

if ($Title) {
  $headers["Title"] = $Title
}

if ($Priority) {
  $headers["Priority"] = $Priority
}

if ($Tags.Count -gt 0) {
  $headers["Tags"] = ($Tags -join ",")
}

try {
  Invoke-RestMethod `
    -Method Post `
    -Uri $uri `
    -Headers $headers `
    -Body $Message `
    -ContentType "text/plain; charset=utf-8" | Out-Null

  Write-Host "Notifikace odeslána na $uri"
} catch {
  if ($IgnoreErrors) {
    Write-Warning "Odeslání notifikace selhalo: $($_.Exception.Message)"
    return
  }

  throw
}
