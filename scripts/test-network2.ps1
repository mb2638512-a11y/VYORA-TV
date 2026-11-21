$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8787'
function B64([string]$s) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s)).TrimEnd('=').Replace('+','-').Replace('/','_') }

# pick channels from the Pakistan list (not in the standby top-36)
$list = Invoke-RestMethod "$base/api/channels?country=PK&limit=40"
$ch = $list.channels | Where-Object { $_.streams.Count -ge 1 } | Select-Object -First 3

foreach ($c in $ch) {
  $u = B64 $c.streams[0].url
  Write-Host ("`n=== {0} ({1}) ===" -f $c.name, $c.id)
  curl.exe -s -o NUL "$base/api/prefetch?u=$u&cid=$($c.id)"
  Start-Sleep -Seconds 4

  # pull the manifest and look at its type
  curl.exe -s -o "$env:TEMP\v-m.m3u8" "$base/api/proxy?u=$u&cid=$($c.id)"
  $body = Get-Content "$env:TEMP\v-m.m3u8" -Raw
  $isMaster = $body -match '#EXT-X-STREAM-INF'
  $isMedia  = $body -match '#EXTINF'
  Write-Host ("  manifest: {0} bytes | master={1} media={2}" -f $body.Length, $isMaster, $isMedia)

  # pull every segment the manifest points to (simulates real playback)
  $segs = Get-Content "$env:TEMP\v-m.m3u8" | Where-Object { $_ -like '/api/proxy*' }
  Write-Host ("  segment urls found: {0}" -f @($segs).Count)
  foreach ($s in ($segs | Select-Object -First 4)) {
    curl.exe -s -o NUL -w "    seg: %{http_code} %{size_download}b %{time_total}s`n" "$base$s"
  }
  Start-Sleep -Seconds 1
  $n = Invoke-RestMethod "$base/api/network"
  Write-Host ("  network: kbps={0} quality={1} maxLevel={2} samples={3} measured={4}" -f $n.kbps, $n.quality, $n.maxLevel, $n.samples, $n.measured)
}
