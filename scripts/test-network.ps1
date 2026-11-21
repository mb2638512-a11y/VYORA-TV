$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8787'

function B64([string]$s) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s)).TrimEnd('=').Replace('+','-').Replace('/','_') }

$top = Invoke-RestMethod "$base/api/top?limit=6"
$ch = $top.channels | Select-Object -First 1
Write-Host "channel: $($ch.id)"

# warm it
curl.exe -s -o NUL "$base/api/prefetch?u=$(B64 $ch.streams[0].url)&cid=$($ch.id)"
Start-Sleep -Seconds 3

Write-Host "`n--- before any playback ---"
curl.exe -s "$base/api/network"

# simulate playback: pull the manifest + segments for a few seconds
Write-Host "`n--- pulling live segments (simulated playback) ---"
$u = B64 $ch.streams[0].url
for ($i = 0; $i -lt 8; $i++) {
  curl.exe -s -o "$env:TEMP\v-m.m3u8" "$base/api/proxy?u=$u&cid=$($ch.id)"
  $seg = Get-Content "$env:TEMP\v-m.m3u8" | Where-Object { $_ -like '/api/proxy*' } | Select-Object -First 1
  if ($seg) { curl.exe -s -o NUL "$base$seg" }
  Start-Sleep -Milliseconds 700
}

Write-Host "`n--- after playback ---"
curl.exe -s "$base/api/network"
Write-Host ""
