$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8787'
$top = Invoke-RestMethod "$base/api/top?limit=4"
$id = $top.channels[0].id
Write-Host "channel: $id"

Write-Host "`n--- /api/play (race -> 302) ---"
curl.exe -s -o NUL -D - -w "time: %{time_total}s`n" "$base/api/play?cid=$([uri]::EscapeDataString($id))" | Select-String -Pattern 'HTTP/|Location|X-Vyora|time:'

Write-Host "`n--- /api/proxy manifest (RAM cache) ---"
$u = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($top.channels[0].streams[0].url)).TrimEnd('=').Replace('+','-').Replace('/','_')
curl.exe -s -o NUL -D - -w "time: %{time_total}s bytes: %{size_download}`n" "$base/api/proxy?u=$u" | Select-String -Pattern 'HTTP/|X-Vyora-Cache|time:'

Write-Host "`n--- warm then resolve timing (cold vs warm) ---"
$ids = @($top.channels | ForEach-Object { $_.id })
$sw = [Diagnostics.Stopwatch]::StartNew()
Invoke-RestMethod "$base/api/warm?ids=$([uri]::EscapeDataString(($ids -join ',')))&depth=2" | Out-Null
$sw.Stop()
Write-Host ("batch warm of {0} channels: {1}ms" -f $ids.Count, $sw.ElapsedMilliseconds)

foreach ($c in $ids) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $r = Invoke-RestMethod "$base/api/resolve/$([uri]::EscapeDataString($c))"
  $sw.Stop()
  Write-Host ("  resolve {0,-22} -> #{1} {2} ({3}ms)" -f $c, $r.streamIndex, $r.stream.label, $sw.ElapsedMilliseconds)
}
