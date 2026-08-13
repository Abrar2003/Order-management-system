[CmdletBinding()]
param(
  [ValidateSet("list", "download")]
  [string]$Action = "list",
  [ValidateSet("local", "wasabi")]
  [string]$Source = "wasabi",
  [string]$BackupName,
  [string]$HostName = "66.116.211.52",
  [int]$Port = 2222,
  [string]$UserName = "abrar",
  [string]$Destination = (Join-Path ([Environment]::GetFolderPath("UserProfile")) "Downloads\OMS-Backups")
)

$ErrorActionPreference = "Stop"
$backupNamePattern = '^oms-\d{4}-\d{2}-\d{2}(-latest|-\d{2}-\d{2})\.archive\.gz$'
$remote = "$UserName@$HostName"

function Invoke-BackupSsh([string]$Command) {
  & ssh.exe "-p" $Port $remote $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Remote backup command failed."
  }
}

if ($Action -eq "list") {
  Invoke-BackupSsh "sudo /usr/local/bin/oms-backup-export list"
  exit 0
}

if (-not $BackupName -or $BackupName -notmatch $backupNamePattern) {
  throw "Provide a backup name returned by -Action list."
}

New-Item -ItemType Directory -Path $Destination -Force | Out-Null
Invoke-BackupSsh "sudo /usr/local/bin/oms-backup-export stage $Source $BackupName"

try {
  $remoteFile = "${remote}:oms-backup-downloads/$BackupName"
  & scp.exe "-P" $Port $remoteFile (Join-Path $Destination $BackupName)
  if ($LASTEXITCODE -ne 0) {
    throw "Backup download failed."
  }
} finally {
  Invoke-BackupSsh "sudo /usr/local/bin/oms-backup-export cleanup $BackupName"
}

Write-Host "Downloaded: $(Join-Path $Destination $BackupName)"
