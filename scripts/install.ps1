# Install Memev from a release tarball. The URL is an argument. No address is built in.
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Url,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)
$ErrorActionPreference = 'Stop'
$ChecksumUrl = $null
$InitArgs = @()
if ($Rest -and $Rest.Count -gt 0) {
  if ($Rest[0].StartsWith('-')) {
    $InitArgs = $Rest
  } else {
    $ChecksumUrl = $Rest[0]
    if ($Rest.Count -gt 1) { $InitArgs = $Rest[1..($Rest.Count - 1)] }
  }
}
if (-not $ChecksumUrl) { $ChecksumUrl = "$Url.sha256" }
$work = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Path $work | Out-Null
function Fetch([string]$From, [string]$Dest) {
  if ($From.StartsWith('file://', [System.StringComparison]::OrdinalIgnoreCase)) {
    Copy-Item -LiteralPath ([uri]$From).LocalPath -Destination $Dest
  } elseif ($From.StartsWith('https://', [System.StringComparison]::OrdinalIgnoreCase)) {
    Invoke-WebRequest -Uri $From -OutFile $Dest
  } else {
    Write-Error 'URL must be https or a file URL'
    exit 1
  }
}
try {
  Fetch $Url (Join-Path $work 'pkg.tgz')
  Fetch $ChecksumUrl (Join-Path $work 'pkg.sha256')
  $expected = ((Get-Content -LiteralPath (Join-Path $work 'pkg.sha256') -TotalCount 1) -split '\s+')[0].ToLower()
  $actual = (Get-FileHash -LiteralPath (Join-Path $work 'pkg.tgz') -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $expected) {
    Write-Error 'SHA-256 does not match'
    exit 1
  }
  $src = Join-Path $work 'src'
  New-Item -ItemType Directory -Path $src | Out-Null
  tar -xzf (Join-Path $work 'pkg.tgz') -C $src
  $bin = Join-Path $src 'package/bin/memev.mjs'
  if (-not (Test-Path -LiteralPath $bin)) { $bin = Join-Path $src 'bin/memev.mjs' }
  if (-not (Test-Path -LiteralPath $bin)) {
    Write-Error 'tarball has no bin/memev.mjs'
    exit 1
  }
  $node = $null
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) {
    $ver = & node --version 2>$null
    if ($ver -match '^v(\d+)' -and [int]$Matches[1] -ge 22) { $node = $cmd.Source }
  }
  if (-not $node) {
    $specPath = if ($env:MEMEV_NODE_SPEC) { $env:MEMEV_NODE_SPEC } else { Join-Path $PSScriptRoot 'node-runtime.json' }
    if (-not (Test-Path -LiteralPath $specPath)) { Write-Error 'pinned Node runtime spec is missing'; exit 1 }
    $spec = Get-Content -LiteralPath $specPath -Raw | ConvertFrom-Json
    $pin = $spec.platforms.'win-x64'
    if (-not $pin) { Write-Error 'pinned Node runtime has no entry for win-x64'; exit 1 }
    $archive = Join-Path $work 'node.pkg'
    Fetch $pin.url $archive
    $expectNode = $pin.sha256.ToLower()
    $actualNode = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLower()
    if ($actualNode -ne $expectNode) { Write-Error 'SHA-256 does not match'; exit 1 }
    $ndir = Join-Path $work 'node-src'
    New-Item -ItemType Directory -Path $ndir | Out-Null
    Expand-Archive -LiteralPath $archive -DestinationPath $ndir
    $exe = Get-ChildItem -LiteralPath $ndir -Recurse -Filter node.exe | Select-Object -First 1
    if (-not $exe) { Write-Error 'runtime archive has no node.exe'; exit 1 }
    $top = $exe.Directory
    if ((Split-Path -Leaf $top) -eq 'bin') { $top = $top.Parent }
    if ($env:MEMEV_CONFIG_DIR) { $nodeCfg = $env:MEMEV_CONFIG_DIR }
    elseif ($env:XDG_CONFIG_HOME) { $nodeCfg = Join-Path $env:XDG_CONFIG_HOME 'memev' }
    elseif ($env:APPDATA) { $nodeCfg = Join-Path $env:APPDATA 'memev' }
    else { $nodeCfg = Join-Path $env:USERPROFILE '.config\memev' }
    $pinned = Join-Path $nodeCfg 'node\pinned'
    if (Test-Path -LiteralPath $pinned) { Remove-Item -LiteralPath $pinned -Recurse -Force }
    New-Item -ItemType Directory -Path (Split-Path $pinned) -Force | Out-Null
    Move-Item -LiteralPath $top.FullName -Destination $pinned
    $node = Join-Path $pinned 'node.exe'
    if (-not (Test-Path -LiteralPath $node)) { $node = Join-Path $pinned 'bin\node.exe' }
  }
  & $node $bin init @InitArgs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  if ($env:MEMEV_CONFIG_DIR) {
    $cfg = $env:MEMEV_CONFIG_DIR
  } elseif ($env:XDG_CONFIG_HOME) {
    $cfg = Join-Path $env:XDG_CONFIG_HOME 'memev'
  } elseif ($env:APPDATA) {
    $cfg = Join-Path $env:APPDATA 'memev'
  } else {
    $cfg = Join-Path $env:USERPROFILE '.config\memev'
  }
  $launcher = Join-Path $cfg 'bin\memev.cmd'
  if (-not (Test-Path -LiteralPath $launcher)) {
    Write-Error 'installed launcher is missing'
    exit 1
  }
  & $launcher restart
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
