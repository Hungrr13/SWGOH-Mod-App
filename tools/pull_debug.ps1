$ErrorActionPreference = 'Stop'
$adb = 'C:\Users\Chad\AppData\Local\Android\Sdk\platform-tools\adb.exe'
$serial = 'R5CX10W4LJY'
$outDir = 'C:\Users\Chad\my-app\tools\debug_out'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$files = @(
  'shape-classifier-observed-debug.txt',
  'shape-classifier-observed-crop.png',
  'shape-classifier-observed-mask.png',
  'shape-classifier-observed-outline.png',
  'shape-classifier-observed-round-seed.png',
  'shape-classifier-observed-round-smoothed.png',
  'shape-classifier-observed-circle-boundary.png'
)

$extBase = "/sdcard/Android/data/com.hungrr13.modhelper/files/overlay-debug"
foreach ($name in $files) {
  $dest = Join-Path $outDir $name
  & $adb -s $serial pull "$extBase/$name" $dest 2>$null | Out-Null
}
# Also pull all candidate overlay/mask/outline PNGs
$extList = & $adb -s $serial shell "ls $extBase" 2>$null
$candidates = $extList | Select-String '^shape-classifier-candidate-.*\.png$' | ForEach-Object { $_.Matches[0].Value }
foreach ($name in $candidates) {
  $dest = Join-Path $outDir $name
  & $adb -s $serial pull "$extBase/$name" $dest 2>$null | Out-Null
}

$listing = & $adb -s $serial shell run-as com.hungrr13.modhelper ls cache/overlay-debug 2>$null
$latestPrefix = ($listing | Select-String '^(\d+)-focused\.png$' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Sort-Object | Select-Object -Last 1)
if ($latestPrefix) {
  foreach ($suffix in @('focused.png','stats.png','shape.png','icon.png','set.png')) {
    $dest = Join-Path $outDir "$latestPrefix-$suffix"
    $remote = "cache/overlay-debug/$latestPrefix-$suffix"
    & $adb -s $serial exec-out run-as com.hungrr13.modhelper cat $remote > $dest
  }
}

Get-ChildItem $outDir | Sort-Object LastWriteTime -Descending | Select-Object -First 20 FullName, LastWriteTime
