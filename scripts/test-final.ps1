$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8787'

Write-Host "=== 1. HEALTH ===" -ForegroundColor Cyan
$h = Invoke-RestMethod "$base/api/health"
Write-Host ("  engine={0} uptime={1}s dataset={2}" -f $h.engine, $h.uptime, ($h.dataset | ConvertTo-Json -Compress))
Write-Host ("  health online={0} offline={1} total={2}" -f $h.health.online, $h.health.offline, $h.health.total)

Write-Host "`n=== 2. RACE on a cold channel (worst case) ===" -ForegroundColor Cyan
$top = Invoke-RestMethod "$base/api/top?limit=40"
$cands = $top.channels | Where-Object { $_.streams.Count -ge 2 } | Select-Object -First 5
foreach ($c in $cands) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $r = Invoke-RestMethod "$base/api/resolve/$([uri]::EscapeDataString($c.id))"
    $sw.Stop()
    Write-Host ("  {0,-24} winner=#{1} {2,-14} {3}ms" -f $c.id, $r.streamIndex, $r.stream.label, $sw.ElapsedMilliseconds)
  } catch {
    $sw.Stop()
    Write-Host ("  {0,-24} FAILED {1}ms" -f $c.id, $sw.ElapsedMilliseconds)
  }
}

Write-Host "`n=== 3. WARM -> PLAY (instant path) ===" -ForegroundColor Cyan
$ids = ($top.channels | Select-Object -First 15 | ForEach-Object { $_.id }) -join ','
$sw = [Diagnostics.Stopwatch]::StartNew()
$w = Invoke-RestMethod "$base/api/warm?ids=$([uri]::EscapeDataString($ids))&depth=2"
$sw.Stop()
Write-Host ("  batch warm: {0} sources queued in {1}ms" -f $w.warmed, $sw.ElapsedMilliseconds)
Start-Sleep -Seconds 4

$sw = [Diagnostics.Stopwatch]::StartNew()
curl.exe -s -o NUL -D - "$base/api/play?cid=$([uri]::EscapeDataString($top.channels[0].id))" | Select-String -Pattern 'X-Vyora-Ms|HTTP/'
$sw.Stop()
Write-Host ("  /api/play total: {0}ms" -f $sw.ElapsedMilliseconds)

$u = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($top.channels[0].streams[0].url)).TrimEnd('=').Replace('+','-').Replace('/','_')
1..5 | ForEach-Object {
  curl.exe -s -o NUL -w "  manifest: %{http_code} %{time_total}s " "$base/api/proxy?u=$u&cid=$($top.channels[0].id)"
  curl.exe -s -D - -o NUL "$base/api/proxy?u=$u&cid=$($top.channels[0].id)" | Select-String -Pattern 'X-Vyora-Cache' | ForEach-Object { $_.ToString().Trim() }
}

Write-Host "`n=== 4. UI LATENCY under warm load ===" -ForegroundColor Cyan
1..5 | ForEach-Object {
  curl.exe -s -o NUL -w "  /api/status: %{time_total}s  " "$base/api/status?ids=$($top.channels[0].id)"
  curl.exe -s -o NUL -w "/api/network: %{time_total}s`n" "$base/api/network"
}

Write-Host "`n=== 5. SERVER ERRORS ===" -ForegroundColor Cyan
$errs = Get-Content 'E:\Vyora TV\server-go\server.err.log' -ErrorAction SilentlyContinue | Where-Object { $_ -match 'panic|goroutine' }
if ($errs) { $errs | Select-Object -First 10 } else { Write-Host "  no panics - clean" }
