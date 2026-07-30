# 파이가 핫스팟에 재연결되어 IP/링크로컬 주소가 바뀐 뒤,
# ssh config의 "Host dudeoji-pi" 항목 HostName을 현재 주소로 자동 갱신합니다.
#
# 사용법: .\update_pi_ssh_host.ps1
# 갱신 후 확인: ssh dudeoji-pi

param(
    [string]$SshConfigPath = (Join-Path $HOME ".ssh\config"),
    [string]$HostAlias = "dudeoji-pi"
)

$ErrorActionPreference = "Stop"

function Resolve-DudeojiPiAddress {
    param([string]$Name)

    foreach ($ipFlag in @("-4", "-6")) {
        $output = & ping $ipFlag -n 2 $Name 2>$null
        $match = ($output -join "`n") | Select-String -Pattern "\[(.+?)\]"
        if ($match) {
            return $match.Matches[0].Groups[1].Value
        }
    }

    return $null
}

$address = Resolve-DudeojiPiAddress -Name $HostAlias
if (-not $address) {
    $address = Resolve-DudeojiPiAddress -Name "$HostAlias.local"
}

if (-not $address) {
    Write-Host "주소를 찾지 못했습니다. 폰 핫스팟의 연결된 기기 목록에서 IP를 직접 확인하세요." -ForegroundColor Yellow
    exit 1
}

Write-Host "찾은 주소: $address"

if (-not (Test-Path $SshConfigPath)) {
    throw "ssh config를 찾을 수 없습니다: $SshConfigPath"
}

# ssh_config 문법에서 %는 %%로 이스케이프 필요 (IPv6 zone id, 예: fe80::...%15)
$escapedAddress = $address -replace "%", "%%"

$lines = Get-Content -Path $SshConfigPath
$backupPath = "$SshConfigPath.bak"
Copy-Item -Path $SshConfigPath -Destination $backupPath -Force

$newLines = New-Object System.Collections.Generic.List[string]
$inTargetBlock = $false
$hostNameReplaced = $false
$blockFound = $false
$hostPattern = "^Host\s+$([regex]::Escape($HostAlias))(\s|$)"

foreach ($line in $lines) {
    $trimmed = $line.Trim()

    if ($trimmed -match "^Host\s+") {
        if ($inTargetBlock -and -not $hostNameReplaced) {
            $newLines.Add("    HostName $escapedAddress")
            $hostNameReplaced = $true
        }
        $inTargetBlock = $trimmed -match $hostPattern
        if ($inTargetBlock) { $blockFound = $true }
    }

    if ($inTargetBlock -and $trimmed -match "^HostName\s+") {
        $newLines.Add("    HostName $escapedAddress")
        $hostNameReplaced = $true
        continue
    }

    $newLines.Add($line)
}

if ($inTargetBlock -and -not $hostNameReplaced) {
    $newLines.Add("    HostName $escapedAddress")
    $hostNameReplaced = $true
}

if (-not $blockFound) {
    throw "ssh config에서 'Host $HostAlias' 항목을 찾지 못했습니다. 먼저 수동으로 한 번 추가하세요."
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($SshConfigPath, $newLines, $utf8NoBom)

Write-Host "ssh config 갱신 완료 (백업: $backupPath)" -ForegroundColor Green
Write-Host "확인: ssh $HostAlias"
