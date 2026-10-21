param(
  [string]$Destination = (Join-Path (Split-Path $PSScriptRoot -Parent) 'VanshComputer-project.zip')
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$destinationPath = [System.IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $destinationPath) { throw 'Destination already exists; choose a new ZIP path.' }
if (-not (Test-Path -LiteralPath (Split-Path $destinationPath -Parent))) { throw 'Destination folder does not exist.' }

$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$stagePath = Join-Path $tempRoot ('vansh-project-export-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stagePath | Out-Null
try {
  $pendingDirectories = [System.Collections.Generic.Stack[string]]::new()
  $pendingDirectories.Push($projectRoot)
  while ($pendingDirectories.Count -gt 0) {
    $currentDirectory = $pendingDirectories.Pop()
    foreach ($directory in Get-ChildItem -LiteralPath $currentDirectory -Directory -Force) {
      if ($directory.Name -in @('.git', 'node_modules', 'dist', 'build', 'coverage', 'secrets', '.aws', '.ssh', '.credentials')) { continue }
      if (($directory.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
      $pendingDirectories.Push($directory.FullName)
    }
    foreach ($file in Get-ChildItem -LiteralPath $currentDirectory -File -Force) {
      $name = $file.Name.ToLowerInvariant()
      $isEnvironmentFile = $name -eq '.env' -or ($name.StartsWith('.env.') -and $name -ne '.env.example')
      $isCredentialFile = $name -in @('login.json', 'cookies.txt') -or $name -match 'credential|secret|token' -or $name -match '\.(pem|key|p12|pfx|cert|crt|cred)$'
      $isArchive = $name -match '\.(zip|7z|rar)$'
      if ($isEnvironmentFile -or $isCredentialFile -or $isArchive) { continue }

      $relative = [System.IO.Path]::GetRelativePath($projectRoot, $file.FullName)
      $target = Join-Path $stagePath $relative
      $targetDirectory = Split-Path $target -Parent
      New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
      Copy-Item -LiteralPath $file.FullName -Destination $target
    }
  }
  Compress-Archive -Path (Join-Path $stagePath '*') -DestinationPath $destinationPath -CompressionLevel Optimal
  Write-Output "Safe project ZIP created at: $destinationPath"
}
finally {
  $resolvedStage = [System.IO.Path]::GetFullPath($stagePath)
  if (-not $resolvedStage.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to remove a path outside the temporary export directory.' }
  Remove-Item -LiteralPath $resolvedStage -Recurse -Force
}
