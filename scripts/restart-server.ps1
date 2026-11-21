Get-CimInstance Win32_Process -Filter "Name='vyora-tv.exe'" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Milliseconds 800
Start-Process -FilePath 'E:\Vyora TV\server-go\vyora-tv.exe' -ArgumentList '-port','8787','-data','server/data','-web','web/dist' -WorkingDirectory 'E:\Vyora TV' -RedirectStandardOutput 'E:\Vyora TV\server-go\server.out.log' -RedirectStandardError 'E:\Vyora TV\server-go\server.err.log' -WindowStyle Hidden
Start-Sleep -Seconds 2
Get-Process vyora-tv | Select-Object Id, ProcessName, StartTime
