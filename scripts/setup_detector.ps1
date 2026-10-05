$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $repoRoot '.venv\Scripts\python.exe'
$bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'

if (Test-Path -LiteralPath $bundledPython) {
    $python = $bundledPython
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $python = (Get-Command python).Source
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    $python = (Get-Command py).Source
} else {
    throw 'Python 3.10+ was not found. Install Python or configure promptguard.pythonPath manually.'
}

if (-not (Test-Path -LiteralPath $venvPython)) {
    & $python -m venv (Join-Path $repoRoot '.venv')
}

& $venvPython -m pip install --disable-pip-version-check -r (Join-Path $repoRoot 'python\requirements.txt')
& $venvPython -c "import credsweeper; print('CredSweeper', credsweeper.__version__)"

