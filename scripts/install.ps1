$ErrorActionPreference = "Stop"

$RepoUrl = if ($env:SHEEP_REPO_URL) { $env:SHEEP_REPO_URL } else { "https://github.com/Amitdvl/sheep.git" }
$Branch = if ($env:SHEEP_GIT_BRANCH) { $env:SHEEP_GIT_BRANCH } else { "main" }
$Distro = if ($env:SHEEP_WSL_DISTRO) { $env:SHEEP_WSL_DISTRO } else { "Ubuntu" }
$WrapperDir = if ($env:SHEEP_BIN_DIR) { $env:SHEEP_BIN_DIR } else { Join-Path $HOME ".local\bin" }
$RawBaseUrl = "https://raw.githubusercontent.com/Amitdvl/sheep/$Branch"

function Log($Message) {
  Write-Host "[sheep-install] $Message"
}

function Warn($Message) {
  Write-Warning $Message
}

function Fail($Message) {
  throw "[sheep-install] $Message"
}

function Test-Command($Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Ensure-Windows {
  if ($env:OS -ne "Windows_NT") {
    Fail "This installer is for Windows only."
  }
}

function Ensure-Winget {
  if (-not (Test-Command winget)) {
    Fail "winget is required. Install App Installer from Microsoft Store, then rerun."
  }
}

function Ensure-WingetPackage($Id, $DisplayName) {
  $installed = winget list --id $Id --exact --accept-source-agreements 2>$null | Out-String
  if ($installed -match [regex]::Escape($Id)) {
    return
  }

  Log "Installing $DisplayName..."
  winget install --id $Id --exact --accept-package-agreements --accept-source-agreements
}

function Ensure-WslInstalled {
  if (-not (Test-Command wsl.exe)) {
    Log "Installing WSL..."
    winget install --id Microsoft.WSL --exact --accept-package-agreements --accept-source-agreements
  }
}

function Ensure-Distro {
  $distros = & wsl.exe -l -q 2>$null
  if ($LASTEXITCODE -ne 0) {
    $distros = @()
  }

  if (-not ($distros -contains $Distro)) {
    Log "Installing WSL distro $Distro..."
    & wsl.exe --install -d $Distro
    throw "[sheep-install] WSL installed $Distro. Launch it once to finish first-run setup, then rerun this installer."
  }

  try {
    & wsl.exe -d $Distro -- bash -lc "printf ready"
  } catch {
    throw "[sheep-install] Launch $Distro once and complete the Linux user setup, then rerun this installer."
  }
}

function Start-DockerDesktop {
  $paths = @(
    "$Env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
    "$Env:ProgramFiles(x86)\Docker\Docker\Docker Desktop.exe"
  )

  foreach ($path in $paths) {
    if (Test-Path $path) {
      Start-Process -FilePath $path | Out-Null
      return
    }
  }

  Warn "Docker Desktop executable was not found after install."
}

function Wait-ForDockerInWsl {
  Log "Waiting for Docker Desktop + WSL integration..."
  for ($i = 0; $i -lt 120; $i++) {
    & wsl.exe -d $Distro -- bash -lc "docker info >/dev/null 2>&1"
    if ($LASTEXITCODE -eq 0) {
      return
    }
    Start-Sleep -Seconds 2
  }

  throw "[sheep-install] Docker is not available inside $Distro. Open Docker Desktop, enable WSL integration for $Distro, then rerun this installer."
}

function Invoke-WslInstaller {
  $escapedRepoUrl = $RepoUrl.Replace("'", "'\"'\"'")
  $escapedBranch = $Branch.Replace("'", "'\"'\"'")
  $command = "export SHEEP_REPO_URL='$escapedRepoUrl' SHEEP_GIT_BRANCH='$escapedBranch'; curl -fsSL '$RawBaseUrl/scripts/install.sh' | bash"

  Log "Running Sheep installer inside WSL..."
  & wsl.exe -d $Distro -- bash -lc $command
  if ($LASTEXITCODE -ne 0) {
    Fail "WSL installer failed."
  }
}

function Write-WindowsWrapper {
  New-Item -ItemType Directory -Force -Path $WrapperDir | Out-Null
  $wrapperPath = Join-Path $WrapperDir "sheep.cmd"
  $remoteInstall = "powershell -NoProfile -ExecutionPolicy Bypass -Command `"irm $RawBaseUrl/scripts/install.ps1 | iex`""

  $wrapper = @"
@echo off
setlocal
if "%~1"=="install" (
  $remoteInstall
  exit /b %errorlevel%
)
wsl.exe -d "$Distro" -- bash -lc "~/.local/bin/sheep %*"
"@

  Set-Content -Path $wrapperPath -Value $wrapper -Encoding ASCII
  Log "Created Windows wrapper at $wrapperPath"

  if (($Env:Path -split ';') -notcontains $WrapperDir) {
    Warn "$WrapperDir is not on PATH yet. Add it in Windows Environment Variables if you want to run 'sheep' from any terminal."
  }
}

Ensure-Windows
Ensure-Winget
Ensure-WingetPackage -Id "Docker.DockerDesktop" -DisplayName "Docker Desktop"
Ensure-WslInstalled
Ensure-Distro
Start-DockerDesktop
Wait-ForDockerInWsl
Invoke-WslInstaller
Write-WindowsWrapper
Log "Install complete. Next: edit ~/.local/share/sheep/.env inside WSL, then run 'sheep'."
