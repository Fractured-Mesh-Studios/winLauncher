const { spawn } = require('child_process');

function createLaunchService({ runPowerShell, resolveLaunchTarget }) {
  function launchByPowerShell(target) {
    const escaped = String(target).replace(/'/g, "''");
    const psScript = `
    $ErrorActionPreference = 'Stop'
    $target = '${escaped}'

    if ($target.StartsWith('appx:')) {
      $appId = $target.Substring(5)
      Start-Process -FilePath ("shell:AppsFolder\\" + $appId)
      exit 0
    }

    Start-Process -FilePath $target
  `;

    runPowerShell(psScript, () => {});
  }

  function launchByShellStart(target, onFailure) {
    const child = spawn('cmd.exe', ['/c', 'start', '""', target], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });

    child.on('error', () => {
      if (typeof onFailure === 'function') {
        onFailure();
      }
    });

    child.unref();
  }

  function tryResolveSteamLaunchTargetFromIcon(iconPath, callback) {
    const escaped = String(iconPath).replace(/'/g, "''");
    const psScript = `
    $ErrorActionPreference = 'SilentlyContinue'
    $iconPath = '${escaped}'

    function Normalize-PathValue([string]$value) {
      if (-not $value) { return $null }
      $clean = ($value -split ',')[0].Trim().Trim('"')
      if (-not $clean) { return $null }
      try { return [System.IO.Path]::GetFullPath($clean).ToLowerInvariant() } catch { return $clean.ToLowerInvariant() }
    }

    $needle = Normalize-PathValue $iconPath
    if (-not $needle) { return }

    $paths = @(
      'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
    )

    foreach ($path in $paths) {
      Get-ItemProperty -Path $path -ErrorAction SilentlyContinue | ForEach-Object {
        $candidateIcon = Normalize-PathValue $_.DisplayIcon
        if (-not $candidateIcon -or $candidateIcon -ne $needle) { return }

        $steamId = $null
        if ($_.PSChildName -match '^Steam App\\s+(\\d+)$') {
          $steamId = $Matches[1]
        } elseif ($_.UninstallString -match 'steam://uninstall/(\\d+)') {
          $steamId = $Matches[1]
        } elseif ($_.UninstallString -match 'steam://rungameid/(\\d+)') {
          $steamId = $Matches[1]
        }

        if ($steamId) {
          "steam://rungameid/$steamId"
          return
        }

        if ($_.InstallLocation -and (Test-Path $_.InstallLocation)) {
          $exe = Get-ChildItem -Path $_.InstallLocation -Filter *.exe -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -notmatch 'unins|uninstall|setup|update|crash|helper' } |
            Select-Object -First 1
          if ($exe) {
            $exe.FullName
            return
          }
        }
      }
    }
  `;

    runPowerShell(psScript, (err, stdout) => {
      if (err) {
        callback(null);
        return;
      }

      const resolved = (stdout || '').trim();
      callback(resolved || null);
    });
  }

  function launchApp(targetPath) {
    if (!targetPath) {
      return;
    }

    const cleaned = String(targetPath).replace(/\u0000/g, '').trim().replace(/^"|"$/g, '');
    if (!cleaned) {
      return;
    }

    if (cleaned.startsWith('appx:')) {
      launchByPowerShell(cleaned);
      return;
    }

    if (/\\steam\\games\\[^\\]+\.ico$/i.test(cleaned)) {
      tryResolveSteamLaunchTargetFromIcon(cleaned, (resolvedTarget) => {
        if (resolvedTarget) {
          launchApp(resolvedTarget);
          return;
        }

        launchByShellStart('steam://open/main', () => {
          launchByPowerShell(cleaned);
        });
      });
      return;
    }

    const hasUriScheme = /^[a-z][a-z0-9+.-]*:/i.test(cleaned);
    const isWindowsDrivePath = /^[a-z]:[\\/]/i.test(cleaned);
    const isShellPath = cleaned.toLowerCase().startsWith('shell:');
    if ((hasUriScheme && !isWindowsDrivePath) || isShellPath) {
      launchByShellStart(cleaned, () => {
        launchByPowerShell(cleaned);
      });
      return;
    }

    const launchTarget = resolveLaunchTarget(cleaned);
    if (!launchTarget) {
      launchByPowerShell(cleaned);
      return;
    }

    launchByShellStart(launchTarget, () => {
      launchByPowerShell(launchTarget);
    });
  }

  return {
    launchApp
  };
}

module.exports = {
  createLaunchService
};
