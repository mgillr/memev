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
  & node $bin init @InitArgs
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
