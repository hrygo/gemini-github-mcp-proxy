$ErrorActionPreference = "Stop"

# Ensure TLS 1.2 is enabled on Windows PowerShell 5.1
try {
    [Net.ServicePointManager]::SecurityProtocol =
        [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
}
catch {
    # Ignore on platforms/runtimes where SecurityProtocol is managed automatically
}

$repo = "hrygo/gemini-github-mcp-proxy"
$baseUrl = "https://github.com/$repo/releases/latest/download"
$archive = "gemini-github-mcp-proxy.tgz"
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("gemini-github-mcp-" + [guid]::NewGuid())

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
# Prefer npm.cmd so installation still works when PowerShell ExecutionPolicy is Restricted
$npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCmd) {
    $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
}
if (-not $nodeCmd -or -not $npmCmd) {
    throw "Node.js / npm not found. Please install Node.js 22 or newer: https://nodejs.org/"
}

$nodeVersion = (& $nodeCmd.Source --version).Trim()
$nodeMajor = [int](($nodeVersion.TrimStart("v") -split "\.")[0])
if ($nodeMajor -lt 22) {
    throw "Node.js version is too old ($nodeVersion). Please upgrade to Node.js 22+: https://nodejs.org/"
}

New-Item -ItemType Directory -Path $tempDir | Out-Null
try {
    $archivePath = Join-Path $tempDir $archive
    $checksumsPath = Join-Path $tempDir "SHA256SUMS"

    Write-Host "Downloading $archive..."
    Invoke-WebRequest -UseBasicParsing "$baseUrl/$archive" -OutFile $archivePath
    Invoke-WebRequest -UseBasicParsing "$baseUrl/SHA256SUMS" -OutFile $checksumsPath

    $checksumLine = Get-Content $checksumsPath | Where-Object { $_ -match "(^|\s)$([regex]::Escape($archive))$" } | Select-Object -First 1
    if (-not $checksumLine) {
        $checksumLine = Get-Content $checksumsPath -First 1
    }
    $expected = ($checksumLine.Trim() -split "\s+")[0].ToLowerInvariant()
    $actual = (Get-FileHash -Algorithm SHA256 $archivePath).Hash.ToLowerInvariant()
    if ($expected -ne $actual) {
        throw "SHA-256 verification failed."
    }

    Write-Host "Installing Gemini GitHub MCP..."
    $npmVersion = (& $npmCmd.Source --version).Trim()
    $npmMajor = [int](($npmVersion -split "\.")[0])
    if ($npmMajor -ge 12) {
        & $npmCmd.Source install --global --allow-scripts=esbuild,fsevents,workerd $archivePath
    }
    else {
        & $npmCmd.Source install --global $archivePath
    }
    if ($LASTEXITCODE -ne 0) {
        throw "npm install failed with exit code $LASTEXITCODE."
    }

    $policy = "Undefined"
    try {
        $policy = (Get-ExecutionPolicy).ToString()
    }
    catch {
        $policy = "Undefined"
    }
    $policyBlocksPs1 = ($policy -eq "Restricted" -or $policy -eq "AllSigned")

    $cliCmd = Get-Command gemini-github-mcp.cmd -ErrorAction SilentlyContinue
    if (-not $cliCmd) {
        $cliCmd = Get-Command gemini-github-mcp -ErrorAction SilentlyContinue
    }

    if ($cliCmd) {
        $installedVersion = (& $cliCmd.Source --version).Trim()
        Write-Host "Installed gemini-github-mcp $installedVersion"
        Write-Host ""
        if ($policyBlocksPs1) {
            Write-Host "Note: PowerShell ExecutionPolicy is '$policy', which blocks 'gemini-github-mcp.ps1'."
            Write-Host "Next step (run the .cmd wrapper directly):"
            Write-Host "  gemini-github-mcp.cmd setup"
        }
        else {
            Write-Host "Installation complete. Next step:"
            Write-Host "  gemini-github-mcp setup"
        }
    }
    else {
        $npmPrefix = (& $npmCmd.Source prefix -g).Trim()
        Write-Host ""
        Write-Host "Installation complete, but gemini-github-mcp is not on PATH yet."
        Write-Host "Add it to this session (or restart PowerShell):"
        Write-Host "  `$env:PATH = `"$npmPrefix;`$env:PATH`""
        Write-Host ""
        if ($policyBlocksPs1) {
            Write-Host "Then run:"
            Write-Host "  gemini-github-mcp.cmd setup"
        }
        else {
            Write-Host "Then run:"
            Write-Host "  gemini-github-mcp setup"
        }
    }

    Write-Host ""
    Write-Host "(Cloudflare browser login will open automatically if needed. Each user should use their own Cloudflare account and GitHub PAT.)"
}
finally {
    Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
}
