[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("codex", "opencode")]
  [string]$Agent,

  [Parameter(Mandatory = $true)]
  [string]$ApkPath,

  [Parameter(Mandatory = $true)]
  [string]$DriveUrl,

  [Parameter(Mandatory = $true)]
  [string]$BuildMode,

  [string]$ReadmePath = (Join-Path $PSScriptRoot "..\\README.md"),

  [string]$Note = ""
)

$ErrorActionPreference = "Stop"

$startMarker = "<!-- DEPLOY_STATUS:START -->"
$endMarker = "<!-- DEPLOY_STATUS:END -->"

function Get-RelativePathCompat {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FromDirectory,

    [Parameter(Mandatory = $true)]
    [string]$ToPath
  )

  try {
    return [System.IO.Path]::GetRelativePath($FromDirectory, $ToPath)
  } catch {
    $fromUri = New-Object System.Uri(($FromDirectory.TrimEnd("\/") + [System.IO.Path]::DirectorySeparatorChar))
    $toUri = New-Object System.Uri($ToPath)
    $relativeUri = $fromUri.MakeRelativeUri($toUri)
    return [System.Uri]::UnescapeDataString($relativeUri.ToString()).Replace("/", [System.IO.Path]::DirectorySeparatorChar)
  }
}

$resolvedReadmePath = (Resolve-Path $ReadmePath).Path
$content = Get-Content -Raw $resolvedReadmePath

$timestamp = Get-Date
$timestampText = $timestamp.ToString("yyyy-MM-dd HH:mm:ss")
$agentLabel = if ($Agent -eq "codex") { "Codex (GPT-5.4)" } else { "OpenCode (Claude Sonnet 4.6)" }
$relativeApkPath = Get-RelativePathCompat -FromDirectory (Split-Path $resolvedReadmePath -Parent) -ToPath ((Resolve-Path $ApkPath).Path)

$lines = @(
  "- Poslední úspěšný deploy: $timestampText"
  "- Agent: $agentLabel"
  "- APK build: $BuildMode"
  "- APK cesta: ``$relativeApkPath``"
  "- Google Drive: $DriveUrl"
)

if ($Note) {
  $lines += "- Poznámka: $Note"
}

$replacementBlock = @(
  $startMarker
  $lines
  $endMarker
) -join "`r`n"

if ($content.Contains($startMarker) -and $content.Contains($endMarker)) {
  $pattern = [regex]::Escape($startMarker) + "[\s\S]*?" + [regex]::Escape($endMarker)
  $updated = [regex]::Replace($content, $pattern, $replacementBlock, 1)
} else {
  $appendBlock = @(
    ""
    "## Deploy Status"
    ""
    $replacementBlock
    ""
  ) -join "`r`n"
  $updated = $content.TrimEnd() + "`r`n" + $appendBlock
}

Set-Content -Path $resolvedReadmePath -Value $updated -NoNewline
Write-Host "README deploy status aktualizován: $resolvedReadmePath"
