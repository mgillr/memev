# Install Memev from a release tarball. The URL is an argument. No address is built in.
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [string]$ChecksumUrl
)
$ErrorActionPreference = 'Stop'
if (-not $ChecksumUrl) { $ChecksumUrl = "$Url.sha256" }
$work = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Path $work | Out-Null
function Fetch([string]$From, [string]$Dest) {
  if ($From.StartsWith('file://')) {
    Copy-Item -LiteralPath $From.Substring(7) -Destination $Dest
  } else {
    Invoke-WebRequest -Uri $From -OutFile $Dest
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
  & node $bin init
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
