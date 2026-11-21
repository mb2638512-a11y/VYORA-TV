$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8787'

function B64([string]$s) {
  [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s)).TrimEnd('=').Replace('+','-').Replace('/','_')
}

# pick a channel that is currently online
$top = Invoke-RestMethod "$base/api/top?limit=12"
$ch = $top.channels | Where-Object { $_.streams.Count -ge 1 } | Select-Object -First 1
Write-Host "channel: $($ch.id) ($($ch.name)) streams=$($ch.streams.Count)"

# 1) warm it (like a hover does)
$u = B64 $ch.streams[0].url
curl.exe -s -o NUL "$base/api/prefetch?u=$u&cid=$($ch.id)"
Start-Sleep -Seconds 3

# 2) manifest request -> should be a RAM cache HIT
$sw = [Diagnostics.Stopwatch]::StartNew()
$out = curl.exe -s -D - -o "$env:TEMP\vyora-manifest.m3u8" "$base/api/proxy?u=$u&cid=$($ch.id)"
$sw.Stop()
$cache = ($out | Select-String -Pattern 'X-Vyora-Cache').ToString()
Write-Host ("manifest: {0} bytes in {1}ms" -f (Get-Item "$env:TEMP\vyora-manifest.m3u8").Length, $sw.ElapsedMilliseconds)
Write-Host "         $cache"

# 3) first segment request -> should also be cached
$segLine = Get-Content "$env:TEMP\vyora-manifest.m3u8" | Where-Object { $_ -like '/api/proxy*' } | Select-Object -First 1
if ($segLine) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $out2 = curl.exe -s -D - -o "$env:TEMP\vyora-seg.ts" "$base$segLine"
  $sw.Stop()
  $cache2 = ($out2 | Select-String -Pattern 'X-Vyora-Cache').ToString()
  Write-Host ("segment : {0} bytes in {1}ms" -f (Get-Item "$env:TEMP\vyora-seg.ts").Length, $sw.ElapsedMilliseconds)
  Write-Host "         $cache2"
} else {
  Write-Host "segment : (no segment url in manifest)"
}

# 4) race endpoint -> redirect latency
$sw = [Diagnostics.Stopwatch]::StartNew()
curl.exe -s -o NUL -D - "$base/api/play?cid=$([uri]::EscapeDataString($ch.id))" | Select-String -Pattern 'X-Vyora-Ms|X-Vyora-Stream|HTTP/'
$sw.Stop()
Write-Host ("play    : redirect in {0}ms" -f $sw.ElapsedMilliseconds)
