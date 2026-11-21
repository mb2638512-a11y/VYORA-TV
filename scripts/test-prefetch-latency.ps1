$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8787'
$top = Invoke-RestMethod "$base/api/top?limit=2"
$ch = $top.channels[0]
$u = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($ch.streams[0].url)).TrimEnd('=').Replace('+','-').Replace('/','_')

Write-Host "--- /api/prefetch response time (5 calls) ---"
1..5 | ForEach-Object {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  curl.exe -s -o NUL -w "  prefetch: %{http_code} %{time_total}s`n" "$base/api/prefetch?u=$u&cid=$($ch.id)"
  $sw.Stop()
}

Write-Host "`n--- /api/status while prefetches run ---"
$jobs = @()
1..8 | ForEach-Object {
  $jobs += Start-Job -ScriptBlock {
    param($u, $cid)
    curl.exe -s -o NUL -w "  prefetch(bg): %{http_code} %{time_total}s`n" "http://127.0.0.1:8787/api/prefetch?u=$u&cid=$cid"
  } -ArgumentList $u, $ch.id
}
$sw = [Diagnostics.Stopwatch]::StartNew()
curl.exe -s -o NUL -w "  status(during load): %{http_code} %{time_total}s`n" "$base/api/status?ids=$($ch.id)"
$sw.Stop()
$jobs | Wait-Job | Receive-Job | Out-Null
$jobs | Remove-Job -Force -ErrorAction SilentlyContinue

Write-Host "`n--- server log tail ---"
Get-Content 'E:\Vyora TV\server-go\server.err.log' -Tail 5 -ErrorAction SilentlyContinue
Get-Content 'E:\Vyora TV\server-go\server.out.log' -Tail 12 -ErrorAction SilentlyContinue
