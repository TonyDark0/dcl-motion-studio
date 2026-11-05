param([switch]$ModelsOnly)
$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
& node (Join-Path $PSScriptRoot 'setup-video.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Video preparation requires FFmpeg and FFprobe.' }
$RuntimeRoot = Join-Path $ProjectRoot 'data\runtime\vision'
$VendorRoot = Join-Path $RuntimeRoot 'vendor'
$VenvRoot = Join-Path $RuntimeRoot '.venv'
$PythonExe = Join-Path $VenvRoot 'Scripts\python.exe'
function Invoke-Checked {
  param([string]$Program, [string[]]$Arguments)
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}

function Download-Models {
  $Downloader = Join-Path $PSScriptRoot 'download-pro-models.py'
  & $PythonExe $Downloader $ProjectRoot --check-sam
  if ($LASTEXITCODE -notin @(0, 1)) { throw 'Could not verify the installed SAM files.' }
  $SamReady = $LASTEXITCODE -eq 0
  $enteredHere = $false
  if (-not $SamReady -and $env:HF_TOKEN -notmatch '^hf_[A-Za-z0-9]{20,}$') {
    Write-Host 'Paste the complete Hugging Face token when prompted. The stars hide its characters.'
    $secureToken = Read-Host 'Hugging Face token' -AsSecureString
    $env:HF_TOKEN = [System.Net.NetworkCredential]::new('', $secureToken).Password
    $enteredHere = $true
  }
  try {
    if (-not $SamReady -and $env:HF_TOKEN -notmatch '^hf_[A-Za-z0-9]{20,}$') {
      throw 'The token is incomplete. Copy the full token from Hugging Face and paste it at the prompt. It begins with hf_ and is much longer than one character.'
    }
    Invoke-Checked -Program $PythonExe -Arguments @($Downloader, $ProjectRoot)
  } finally {
    if ($enteredHere) { Remove-Item Env:HF_TOKEN -ErrorAction SilentlyContinue }
  }
}

function Ensure-Source {
  param([string]$Url, [string]$Destination, [string]$Revision)
  if (-not (Test-Path (Join-Path $Destination '.git'))) {
    New-Item -ItemType Directory -Force (Split-Path $Destination) | Out-Null
    Invoke-Checked -Program 'git' -Arguments @('-c', 'http.sslBackend=openssl', 'clone', $Url, $Destination)
  }
  Invoke-Checked -Program 'git' -Arguments @('-c', "safe.directory=$($Destination.Replace('\','/'))", '-C', $Destination, 'fetch', '--depth=1', 'origin', $Revision)
  Invoke-Checked -Program 'git' -Arguments @('-c', "safe.directory=$($Destination.Replace('\','/'))", '-C', $Destination, 'checkout', '--detach', 'FETCH_HEAD')
}

New-Item -ItemType Directory -Force $RuntimeRoot, $VendorRoot | Out-Null

if ($ModelsOnly) {
  if (-not (Test-Path $PythonExe)) { throw 'The Pro runtime is missing. Run npm run setup:pro once.' }
  Download-Models
  Write-Host 'Pro model download completed. Restart the app to refresh its status.'
  exit 0
}

if (-not (Test-Path $PythonExe)) {
  $PyLauncher = Get-Command py -ErrorAction SilentlyContinue
  $HasPython311 = $false
  if ($PyLauncher) {
    try {
      & $PyLauncher.Source -3.11 -c 'import sys; assert sys.version_info[:2] == (3, 11)' 2>$null
      $HasPython311 = $LASTEXITCODE -eq 0
    } catch { $HasPython311 = $false }
  }
  if (-not $HasPython311) {
    Write-Host 'Installing Python 3.11 locally…'
    Invoke-Checked -Program 'winget' -Arguments @('install', '--id', 'Python.Python.3.11', '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements')
    throw 'Python 3.11 installation finished. Close this terminal, open a new one in the project folder, and rerun npm run setup:pro.'
  }
  Invoke-Checked -Program 'py' -Arguments @('-3.11', '-m', 'venv', $VenvRoot)
}

Write-Host 'Installing the isolated CUDA vision runtime…'
Invoke-Checked -Program $PythonExe -Arguments @('-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel')
Invoke-Checked -Program $PythonExe -Arguments @('-m', 'pip', 'install', 'torch==2.7.1+cu128', 'torchvision==0.22.1+cu128', '--index-url', 'https://download.pytorch.org/whl/cu128')
Invoke-Checked -Program $PythonExe -Arguments @('-m', 'pip', 'install',
  'numpy>=2,<3', 'opencv-python-headless', 'scipy', 'pillow', 'huggingface_hub',
  'pytorch-lightning', 'yacs', 'scikit-image', 'einops', 'timm', 'dill', 'pandas',
  'rich', 'hydra-core', 'hydra-submitit-launcher', 'hydra-colorlog', 'pyrootutils',
  'webdataset', 'chump', 'networkx==3.2.1', 'roma', 'joblib', 'ffmpeg', 'cython',
  'jsonlines', 'xtcocotools', 'loguru', 'optree', 'fvcore', 'pycocotools', 'tensorboard')

Ensure-Source 'https://github.com/facebookresearch/sam-3d-body.git' (Join-Path $VendorRoot 'sam-3d-body') 'b5c765a0d89d789985e186d396315e7590887b94'
Ensure-Source 'https://github.com/microsoft/MoGe.git' (Join-Path $VendorRoot 'MoGe') '74fbce054ebed49800de42d0ad0e83495065719a'
Ensure-Source 'https://github.com/EasternJournalist/utils3d-moge.git' (Join-Path $VendorRoot 'utils3d-moge') '62f09d58509485564e24d5d9f6aac9ee9ebc0c37'

Download-Models
Write-Host 'Pro capture is installed. Restart npm run dev so the status endpoint refreshes.'
