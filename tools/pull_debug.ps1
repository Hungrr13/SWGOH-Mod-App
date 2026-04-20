param(
  [switch]$Png,    # include PNG artifacts (classifier masks, overlays, crops)
  [switch]$All     # also pull per-scan focused/stats/shape/icon/set PNGs
)

$ErrorActionPreference = 'Continue'
$adb = 'C:\Users\Chad\AppData\Local\Android\Sdk\platform-tools\adb.exe'
$serial = 'R5CX10W4LJY'
$outDir = 'C:\Users\Chad\my-app\tools\debug_out'
$extBase = '/sdcard/Android/data/com.hungrr13.modhelper/files/overlay-debug'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# PNG files must be at least this many bytes AND start with the PNG magic
# number, otherwise we refuse to write them. Tiny stubs from failed `run-as`
# or aborted pulls have repeatedly broken Claude sessions on replay.
$MinPngBytes = 500
$PngMagic = [byte[]](0x89, 0x50, 0x4E, 0x47)

function Pull-SafePng {
  param([string]$RemotePath, [string]$LocalPath)
  $tmp = "$LocalPath.tmp"
  & $adb -s $serial pull $RemotePath $tmp 2>$null | Out-Null
  if (-not (Test-Path $tmp)) { return 'missing' }
  $info = Get-Item $tmp
  if ($info.Length -lt $MinPngBytes) {
    Remove-Item $tmp -Force
    return "skip(small:$($info.Length))"
  }
  $head = [byte[]]::new(4)
  $fs = [System.IO.File]::OpenRead($tmp)
  try { [void]$fs.Read($head, 0, 4) } finally { $fs.Close() }
  $isPng = $true
  for ($i = 0; $i -lt 4; $i++) { if ($head[$i] -ne $PngMagic[$i]) { $isPng = $false; break } }
  if (-not $isPng) {
    Remove-Item $tmp -Force
    return 'skip(badmagic)'
  }
  Move-Item -Force $tmp $LocalPath
  return "ok($($info.Length)b)"
}

# Always pull the text debug first. This is the cheap, safe view.
$textName = 'shape-classifier-observed-debug.txt'
$textDest = Join-Path $outDir $textName
& $adb -s $serial pull "$extBase/$textName" $textDest 2>$null | Out-Null
if (Test-Path $textDest) {
  Write-Host "Pulled $textName ($((Get-Item $textDest).Length) bytes)"
} else {
  Write-Host "WARNING: $textName not present on device"
}

if ($Png -or $All) {
  $fixed = @(
    'shape-classifier-observed-crop.png',
    'shape-classifier-observed-mask.png',
    'shape-classifier-observed-outline.png',
    'shape-classifier-observed-round-seed.png',
    'shape-classifier-observed-round-smoothed.png',
    'shape-classifier-observed-circle-boundary.png',
    'shape-classifier-observed-contour-overlay.png'
  )
  foreach ($name in $fixed) {
    $status = Pull-SafePng "$extBase/$name" (Join-Path $outDir $name)
    Write-Host ("{0,-60} {1}" -f $name, $status)
  }
  $listing = & $adb -s $serial shell "ls $extBase" 2>$null
  $candidates = $listing | Select-String '^shape-classifier-candidate-.*\.png$' | ForEach-Object { $_.Matches[0].Value }
  foreach ($name in $candidates) {
    $status = Pull-SafePng "$extBase/$name" (Join-Path $outDir $name)
    Write-Host ("{0,-60} {1}" -f $name, $status)
  }
}

if ($All) {
  $listing = & $adb -s $serial shell "ls $extBase" 2>$null
  $latestPrefix = ($listing | Select-String '^(\d+)-focused\.png$' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Sort-Object | Select-Object -Last 1)
  if ($latestPrefix) {
    foreach ($suffix in @('focused.png','stats.png','shape.png','icon.png','set.png')) {
      $name = "$latestPrefix-$suffix"
      $status = Pull-SafePng "$extBase/$name" (Join-Path $outDir $name)
      Write-Host ("{0,-60} {1}" -f $name, $status)
    }
  }
}

Write-Host ''
Write-Host '--- newest files in debug_out ---'
Get-ChildItem $outDir | Sort-Object LastWriteTime -Descending | Select-Object -First 10 Name, Length, LastWriteTime
