[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("codex", "opencode")]
  [string]$Agent,

  [string]$CommitMessage,

  [switch]$StageAllWorktreeChanges,

  [switch]$SkipCommit,

  [switch]$SkipReadmeUpdate
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$androidDir = Join-Path $repoRoot "android"
$apkPath = Join-Path $repoRoot "android\\app\\build\\outputs\\apk\\debug\\app-debug.apk"
$voskModelDir = Join-Path $repoRoot "android\\app\\src\\main\\assets\\models\\vosk-model-small-cs"
$oauthClientPath = Join-Path $repoRoot "gdrive-oauth-client.json"
$serviceAccountPath = Join-Path $repoRoot "gdrive-service-account.json"
$readmePath = Join-Path $repoRoot "README.md"
$driveFolderUrl = "https://drive.google.com/drive/folders/1UYT3vfMNvShxLhRcozh5kjMF1nEd9swj"
$notificationTopic = if ($Agent -eq "codex") { "Codex_done" } else { "OpenCode_done" }
$agentLabel = if ($Agent -eq "codex") { "Codex" } else { "OpenCode" }

if (-not $CommitMessage) {
  $CommitMessage = "chore: deploy android app via $Agent"
}

$stepStatus = [ordered]@{
  build = "pending"
  sync = "pending"
  gradle = "pending"
  upload = "pending"
  readme = if ($SkipReadmeUpdate) { "skipped" } else { "pending" }
  commit = if ($SkipCommit) { "skipped" } else { "pending" }
}

$buildMode = "not completed"
$failureMessage = $null
$notificationError = $null
$currentStep = "startup"

function Invoke-StepCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [string[]]$Arguments = @(),

    [Parameter(Mandatory = $true)]
    [string]$WorkingDirectory
  )

  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Příkaz selhal s exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }
  } finally {
    Pop-Location
  }
}

function Get-GitStatusLines {
  $output = & git -C $repoRoot status --porcelain
  if ($LASTEXITCODE -ne 0) {
    throw "Nepodařilo se načíst git status."
  }

  return @($output | Where-Object { $_ -and $_.Trim() })
}

function Test-HasUnstagedChanges {
  $lines = Get-GitStatusLines
  foreach ($line in $lines) {
    if ($line.StartsWith("??")) {
      return $true
    }

    if ($line.Length -ge 2 -and $line[1] -ne " ") {
      return $true
    }
  }

  return $false
}

function Test-HasStagedChanges {
  & git -C $repoRoot diff --cached --quiet
  return ($LASTEXITCODE -ne 0)
}

function Invoke-GitCommit {
  if ($StageAllWorktreeChanges) {
    & git -C $repoRoot add -A
    if ($LASTEXITCODE -ne 0) {
      throw "Nepodařilo se stageovat změny pomocí git add -A."
    }
  } else {
    & git -C $repoRoot add $readmePath
    if ($LASTEXITCODE -ne 0) {
      throw "Nepodařilo se stageovat README."
    }
  }

  if (-not (Test-HasStagedChanges)) {
    Write-Host "Žádné staged změny pro commit."
    $script:stepStatus.commit = "skipped"
    return
  }

  & git -C $repoRoot commit -m $CommitMessage
  if ($LASTEXITCODE -ne 0) {
    throw "Git commit selhal."
  }

  $script:stepStatus.commit = "ok"
}

function Send-FinalNotification {
  $statusLabel = if ($failureMessage) { "FAILED" } else { "SUCCESS" }
  $title = if ($failureMessage) {
    "UltraLog deploy failed ($agentLabel)"
  } else {
    "UltraLog deploy done ($agentLabel)"
  }
  $priority = if ($failureMessage) { "high" } else { "default" }
  $tags = if ($failureMessage) { @("x", "warning") } else { @("white_check_mark", "package") }

  $messageLines = @(
    "UltraLog deploy $statusLabel via $agentLabel",
    "Build: $($stepStatus.build)",
    "Cap sync: $($stepStatus.sync)",
    "Gradle rebuild: $($stepStatus.gradle)",
    "Upload: $($stepStatus.upload)",
    "README: $($stepStatus.readme)",
    "Commit: $($stepStatus.commit)"
  )

  if (-not $failureMessage) {
    $messageLines += "APK build: $buildMode"
    $messageLines += "Drive: $driveFolderUrl"
  } else {
    $messageLines += "Chyba: $failureMessage"
  }

  & (Join-Path $PSScriptRoot "send-ntfy.ps1") `
    -Topic $notificationTopic `
    -Title $title `
    -Message ($messageLines -join "`n") `
    -Priority $priority `
    -Tags $tags
}

try {
  $currentStep = "prerequisites"
  if (-not (Test-Path $voskModelDir)) {
    throw "Chybí Vosk model: $voskModelDir"
  }

  if (-not (Test-Path $oauthClientPath) -and -not (Test-Path $serviceAccountPath)) {
    throw "Chybí Google Drive credentials (gdrive-oauth-client.json nebo gdrive-service-account.json)."
  }

  if (-not $SkipCommit -and -not $StageAllWorktreeChanges -and (Test-HasUnstagedChanges)) {
    throw "Repo obsahuje unstaged nebo untracked změny. Nejprve je zkontroluj a stageuj, nebo spusť deploy s -StageAllWorktreeChanges."
  }

  $currentStep = "build"
  Invoke-StepCommand -FilePath "npm" -Arguments @("run", "build") -WorkingDirectory $repoRoot
  $stepStatus.build = "ok"

  $currentStep = "sync"
  Invoke-StepCommand -FilePath "npx" -Arguments @("cap", "sync", "android") -WorkingDirectory $repoRoot
  $stepStatus.sync = "ok"

  $currentStep = "gradle"
  Invoke-StepCommand -FilePath ".\\gradlew" -Arguments @("assembleDebug", "--no-daemon") -WorkingDirectory $androidDir
  $stepStatus.gradle = "ok"
  $buildMode = "fresh Gradle debug rebuild"

  if (-not (Test-Path $apkPath)) {
    throw "Gradle build doběhl, ale APK neexistuje: $apkPath"
  }

  $currentStep = "upload"
  Invoke-StepCommand -FilePath "npm" -Arguments @("run", "upload-apk") -WorkingDirectory $repoRoot
  $stepStatus.upload = "ok"

  if (-not $SkipReadmeUpdate) {
    $currentStep = "readme"
    & (Join-Path $PSScriptRoot "update-readme-deploy.ps1") `
      -Agent $Agent `
      -ApkPath $apkPath `
      -DriveUrl $driveFolderUrl `
      -BuildMode $buildMode
    $stepStatus.readme = "ok"
  }

  if (-not $SkipCommit) {
    $currentStep = "commit"
    Invoke-GitCommit
  }
} catch {
  $failureMessage = $_.Exception.Message

  switch ($currentStep) {
    "build" {
      $stepStatus.build = "failed"
      $stepStatus.sync = "skipped"
      $stepStatus.gradle = "skipped"
      $stepStatus.upload = "skipped"
      if (-not $SkipReadmeUpdate) { $stepStatus.readme = "skipped" }
      if (-not $SkipCommit) { $stepStatus.commit = "skipped" }
    }
    "sync" {
      $stepStatus.sync = "failed"
      $stepStatus.gradle = "skipped"
      $stepStatus.upload = "skipped"
      if (-not $SkipReadmeUpdate) { $stepStatus.readme = "skipped" }
      if (-not $SkipCommit) { $stepStatus.commit = "skipped" }
    }
    "gradle" {
      $stepStatus.gradle = "failed"
      $stepStatus.upload = "skipped"
      if (-not $SkipReadmeUpdate) { $stepStatus.readme = "skipped" }
      if (-not $SkipCommit) { $stepStatus.commit = "skipped" }
    }
    "upload" {
      $stepStatus.upload = "failed"
      if (-not $SkipReadmeUpdate) { $stepStatus.readme = "skipped" }
      if (-not $SkipCommit) { $stepStatus.commit = "skipped" }
    }
    "readme" {
      $stepStatus.readme = "failed"
      if (-not $SkipCommit) { $stepStatus.commit = "skipped" }
    }
    "commit" {
      $stepStatus.commit = "failed"
    }
    default {
      if ($stepStatus.build -eq "pending") {
        $stepStatus.build = "failed"
      }
    }
  }
} finally {
  try {
    Send-FinalNotification
  } catch {
    $notificationError = $_.Exception.Message
  }
}

if ($failureMessage) {
  Write-Error $failureMessage
}

if ($notificationError) {
  Write-Error "Odeslání ntfy notifikace selhalo: $notificationError"
}

if ($failureMessage -or $notificationError) {
  exit 1
}

Write-Host "Deploy workflow dokončen úspěšně."
