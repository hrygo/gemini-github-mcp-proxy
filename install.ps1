$ErrorActionPreference = "Stop"

$repo = "hrygo/gemini-github-mcp-proxy"
$baseUrl = "https://github.com/$repo/releases/latest/download"
$archive = "gemini-github-mcp-proxy.tgz"
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("gemini-github-mcp-" + [guid]::NewGuid())

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or
    -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "未找到 npm。请先安装 Node.js 22 或更高版本：https://nodejs.org/"
}
$nodeMajor = [int](((node --version).TrimStart("v") -split "\.")[0])
if ($nodeMajor -lt 22) {
    throw "当前 Node.js 版本过低（$(node --version)）。请升级到 Node.js 22 或更高版本：https://nodejs.org/"
}

New-Item -ItemType Directory -Path $tempDir | Out-Null
try {
    $archivePath = Join-Path $tempDir $archive
    $checksumsPath = Join-Path $tempDir "SHA256SUMS"

    Write-Host "正在下载 $archive..."
    Invoke-WebRequest -UseBasicParsing "$baseUrl/$archive" -OutFile $archivePath
    Invoke-WebRequest -UseBasicParsing "$baseUrl/SHA256SUMS" -OutFile $checksumsPath

    $expected = ((Get-Content $checksumsPath -First 1) -split "\s+")[0].ToLowerInvariant()
    $actual = (Get-FileHash -Algorithm SHA256 $archivePath).Hash.ToLowerInvariant()
    if ($expected -ne $actual) {
        throw "SHA-256 校验失败。"
    }

    Write-Host "正在安装 Gemini GitHub MCP..."
    $npmMajor = [int](((npm --version) -split "\.")[0])
    if ($npmMajor -ge 12) {
        npm install --global --allow-scripts=esbuild,fsevents,workerd $archivePath
    }
    else {
        npm install --global $archivePath
    }

    if (Get-Command gemini-github-mcp -ErrorAction SilentlyContinue) {
        gemini-github-mcp --version
        Write-Host ""
        Write-Host "安装完成。下一步只需运行："
        Write-Host "  gemini-github-mcp setup"
    }
    else {
        $npmPrefix = (npm prefix -g).Trim()
        Write-Host ""
        Write-Host "安装完成，但当前 PATH 中未找到 gemini-github-mcp。"
        Write-Host "请将以下目录加入 PATH（或重新打开 PowerShell）："
        Write-Host "  $npmPrefix"
        Write-Host ""
        Write-Host "然后运行："
        Write-Host "  gemini-github-mcp setup"
    }

    Write-Host ""
    Write-Host "（未登录 Cloudflare 时会自动打开浏览器引导登录；每个使用者请使用自己的 Cloudflare 账号和 GitHub PAT。）"
}
finally {
    Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
}
