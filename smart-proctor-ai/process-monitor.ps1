# SmartProctor AI - Native Windows Background Process Auditor (PowerShell)
# Monitors active running applications for cheating/unauthorized utilities and reports to Admin

param (
    [string]$ServerUrl = "http://localhost:3000",
    [string]$SessionId = "sess-stu-101",
    [int]$IntervalSeconds = 3
)

$Blacklist = @(
    @{ Name = "discord"; DisplayName = "Discord Communication App"; Severity = "HIGH" },
    @{ Name = "telegram"; DisplayName = "Telegram Messenger"; Severity = "HIGH" },
    @{ Name = "whatsapp"; DisplayName = "WhatsApp Desktop"; Severity = "HIGH" },
    @{ Name = "slack"; DisplayName = "Slack Workspace Client"; Severity = "MEDIUM" },
    @{ Name = "zoom"; DisplayName = "Zoom Video Conferencing"; Severity = "HIGH" },
    @{ Name = "teamviewer"; DisplayName = "TeamViewer Remote Desktop"; Severity = "CRITICAL" },
    @{ Name = "anydesk"; DisplayName = "AnyDesk Remote Control"; Severity = "CRITICAL" },
    @{ Name = "mstsc"; DisplayName = "Windows Remote Desktop"; Severity = "CRITICAL" },
    @{ Name = "obs64"; DisplayName = "OBS Studio Recording Software"; Severity = "HIGH" },
    @{ Name = "cheatengine"; DisplayName = "Cheat Engine"; Severity = "CRITICAL" },
    @{ Name = "chatgpt"; DisplayName = "ChatGPT Desktop Client"; Severity = "HIGH" }
)

Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "🛡️ SMARTPROCTOR AI - NATIVE OS BACKGROUND PROCESS MONITOR" -ForegroundColor Green
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "Target Server: $ServerUrl" -ForegroundColor Gray
Write-Host "Candidate Session: $SessionId" -ForegroundColor Gray
Write-Host "Scanning process table every $IntervalSeconds seconds...`n" -ForegroundColor Gray

$ReportedPids = @{}

while ($true) {
    $AllProcesses = Get-Process -ErrorAction SilentlyContinue
    $Detected = @()

    foreach ($Rule in $Blacklist) {
        $Matches = $AllProcesses | Where-Object { $_.ProcessName -like "*$($Rule.Name)*" }
        foreach ($Proc in $Matches) {
            if (-not $ReportedPids.ContainsKey($Proc.Id)) {
                $Detected += @{
                    name = $Rule.DisplayName
                    exe = "$($Proc.ProcessName).exe"
                    pid = $Proc.Id
                    risk = $Rule.Severity
                }
                $ReportedPids[$Proc.Id] = $true
            }
        }
    }

    if ($Detected.Count -gt 0) {
        Write-Host "`n🚨 [SECURITY BREACH] Detected $($Detected.Count) Unauthorized Application(s)!" -ForegroundColor Red
        foreach ($Item in $Detected) {
            Write-Host "   ⚠️ Found: $($Item.name) (PID: $($Item.pid)) - Severity: $($Item.risk)" -ForegroundColor Yellow
        }

        # Send alert to Proctor server
        $Payload = @{
            sessionId = $SessionId
            unauthorizedProcesses = $Detected
        } | ConvertTo-Json -Depth 3

        try {
            $Response = Invoke-RestMethod -Uri "$ServerUrl/api/proctor/processes" -Method Post -Body $Payload -ContentType "application/json"
            Write-Host "   📡 Alert transmitted to Proctor Admin Dashboard successfully." -ForegroundColor Green
        } catch {
            Write-Host "   ❌ Failed to notify Proctor Server: $_" -ForegroundColor Red
        }
    } else {
        Write-Host -NoNewline "`r[$((Get-Date).ToString('HH:mm:ss'))] ✅ All running processes compliant. Clean test environment. "
    }

    Start-Sleep -Seconds $IntervalSeconds
}
