function createAppsService({ runPowerShell }) {
  function getInstalledApps(callback) {
    const psScript = `
    $ErrorActionPreference = 'SilentlyContinue'

    $paths = @(
      'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
    );

    $apps = New-Object System.Collections.Generic.List[object];
    $seen = New-Object 'System.Collections.Generic.HashSet[string]';

    foreach ($path in $paths) {
      Get-ItemProperty -Path $path -ErrorAction SilentlyContinue | ForEach-Object {
        $displayName = $_.DisplayName;
        if (-not $displayName) { return; }

        $displayName = $displayName.Trim();
        if (-not $displayName) { return; }

        $iconValue = $_.DisplayIcon;
        $candidate = $null;

        if ($iconValue) {
          $candidate = ($iconValue -split ',')[0].Trim('"');
        }

        if (-not $candidate -and $_.InstallLocation) {
          $candidate = $_.InstallLocation.Trim('"');
        }

        if (-not $candidate -and $_.InstallSource) {
          $candidate = $_.InstallSource.Trim('"');
        }

        if (-not $candidate) { return; }

        if (-not (Test-Path $candidate)) {
          if ($candidate -match '\\.exe$' -or $candidate -match '\\.lnk$') {
            $candidate = $null;
          }
        }

        if ($candidate) {
          $launchPath = $candidate
          $steamId = $null

          if ($_.PSChildName -match '^Steam App\\s+(\\d+)$') {
            $steamId = $Matches[1]
          } elseif ($_.UninstallString -match 'steam://uninstall/(\\d+)') {
            $steamId = $Matches[1]
          } elseif ($_.UninstallString -match 'steam://rungameid/(\\d+)') {
            $steamId = $Matches[1]
          }

          if ($steamId) {
            $launchPath = "steam://rungameid/$steamId"
          }

          $normalized = $displayName.ToLowerInvariant();
          if ($seen.Add($normalized)) {
            $apps.Add([pscustomobject]@{ Name = $displayName; Path = $launchPath; IconSource = $candidate });
          }
        }
      }
    }

    Get-StartApps | ForEach-Object {
      $displayName = $_.Name
      $appId = $_.AppID
      if (-not $displayName -or -not $appId) { return }

      $displayName = $displayName.Trim()
      if (-not $displayName) { return }

      $normalized = $displayName.ToLowerInvariant()
      if ($seen.Add($normalized)) {
        $apps.Add([pscustomobject]@{ Name = $displayName; Path = ('appx:' + $appId); IconSource = $null })
      }
    }

    $apps |
      Sort-Object Name |
      Select-Object Name, Path, IconSource |
      ConvertTo-Json -Depth 5 -Compress
  `;

    runPowerShell(psScript, (err, stdout) => {
      if (err) {
        callback([]);
        return;
      }

      try {
        const raw = (stdout || '').trim();
        if (!raw) {
          callback([]);
          return;
        }

        const parsed = JSON.parse(raw);
        const apps = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
        callback(apps);
      } catch (error) {
        callback([]);
      }
    });
  }

  return {
    getInstalledApps
  };
}

module.exports = {
  createAppsService
};
