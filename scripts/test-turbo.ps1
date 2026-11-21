$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8787'

$top = Invoke-RestMethod "$base/api/top?limit=6"
$ids = @($top.channels | ForEach-Object { $_.id })
Write-Host "Testing channels: $($ids -join ', ')"

# 1) warm the visible channels (server pulls manifest + segments into RAM)
$sw = [Diagnostics.Stopwatch]::StartNew()
$warm = Invoke-RestMethod "$base/api/warm?ids=$([uri]::EscapeDataString(($ids -join ',')))&depth=2"
$sw.Stop()
Write-Host ("warm  -> ok={0} warmed={1} in {2}ms" -f $warm.ok, $warm.warmed, $sw.ElapsedMilliseconds)

# 2) resolve (server races all sources in parallel)
foreach ($id in $ids[0..3]) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $r = Invoke-RestMethod "$base/api/resolve/$([uri]::EscapeDataString($id))"
    $sw.Stop()
    Write-Host ("resolve {0} -> stream #{1} ({2}) in {3}ms" -f $id, $r.streamIndex, $r.stream.label, $sw.ElapsedMilliseconds)
  } catch {
    $sw.Stop()
    Write-Host ("resolve {0} -> FAILED in {1}ms" -f $id, $sw.ElapsedMilliseconds)
  }
}

# 3) /api/play -> 302 to the winning source
$sw = [Diagnostics.Stopwatch]::StartNew()
try {
  $resp = Invoke-WebRequest "$base/api/play?cid=$([uri]::EscapeDataString($ids[0]))" -MaximumRedirection 0 -ErrorAction SilentlyContinue
  $sw.Stop()
  Write-Host ("play  -> status={0} stream={1} ms={2} in {3}ms" -f $resp.StatusCode, $resp.Headers['X-Vyora-Stream'], $resp.Headers['X-Vyora-Ms'], $sw.ElapsedMilliseconds)
  Write-Host ("       location={0}" -f ($resp.Headers['Location'] -replace 'u=[^&]+','u=<b64>'))
} catch {
  $sw.Stop()
  Write-Host ("play  -> {0} in {1}ms" -f $_.Exception.Message, $sw.ElapsedMilliseconds)
}

# 4) proxy manifest -> should be a RAM cache HIT
$ch = $top.channels[0]
$u = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($ch.streams[0].url)).TrimEnd('=').Replace('+','-').Replace('/','_')
$sw = [Diagnostics.Stopwatch]::StartNew()
$resp2 = Invoke-WebRequest "$base/api/proxy?u=$u" -ErrorAction SilentlyContinue
$sw.Stop()
Write-Host ("proxy -> status={0} cache={1} bytes={2} in {3}ms" -f $resp2.StatusCode, $resp2.Headers['X-Vyora-Cache'], $resp2.RawContentLength, $sw.ElapsedMilliseconds)
