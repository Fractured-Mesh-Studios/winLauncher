function createAppsService({ runPowerShell }) {
  function getInstalledApps(callback) {
    let isSettled = false;

    function finish(apps) {
      if (isSettled) {
        return;
      }

      isSettled = true;
      callback(Array.isArray(apps) ? apps : []);
    }

    const safetyTimeout = setTimeout(() => {
      finish([]);
    }, 12000);

    const psScript = `
    $ErrorActionPreference = 'SilentlyContinue'

    $paths = @(
      'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
    );

    $apps = New-Object System.Collections.Generic.List[object];
    $seen = New-Object 'System.Collections.Generic.HashSet[string]';
    $excludedExePattern = '(unins|uninstall|setup|update|crash|helper|installer)'
    $auxiliaryExePattern = '(?i)(courgette|crashpad|updater|autoupdate|squirrel|mini[_-]?installer|elevate|gameoverlay|overlayui|steamservice|steamerrorreporter|steamwebhelper|webhelper)'
    $excludedDisplayNamePattern = '(?i)\\b(cli|command[\\s-]?line)\\b'
    $excludedFrameworkDisplayNamePattern = '(?i)(microsoft\\s*\\.net\\s+host(\\s+fx\\s+resolver|\\s+-)?|microsoft\\s*\\.net\\s+runtime|microsoft\\s*\\.net\\s+framework|microsoft\\s*asp\\.net\\s+core\\s+runtime|microsoft\\s*windows\\s+desktop\\s+runtime|\\btargeting\\s+pack\\b|\\bdeveloper\\s+pack\\b|\\blanguage\\s+pack\\b|\\bsdk\\b)'
    $excludedRedistributableDisplayNamePattern = '(?i)(microsoft\\s+visual\\s+c\\+\\+.*redistributable)'
    $excludedSystemComponentDisplayNamePattern = '(?i)(\\b(driver|chipset|firmware|controlador|runtime library|redistributable package)\\b|nvidia\\s+graphics\\s+driver|intel\\(r\\)|realtek|qualcomm|broadcom|wireless|bluetooth|ethernet|audio\\s+driver|usb\\s+driver|graphics\\s+driver)'
    $excludedVisualStudioPackageDisplayNamePattern = '(?i)^(vs_[a-z0-9._-]+)$|visual\\s+studio\\s+installer|microsoft\\.visualstudio\\..*(msi|package)'
    $installerFileExtensionPattern = '(?i)\\.(msi|msp|msix|msixbundle|appx|appxbundle|msu|cab)$'
    $installerFileNamePattern = '(?i)(setup|installer|bootstrapper|prereq|redist)'
    $excludedWebTargetPattern = '(?i)^(https?:|appx:https?:)|\\.(html?|url)$'
    $cliExeNamePattern = '^(docker|kubectl|git|node|npm|npx|pnpm|yarn|python|py|pip|java|javac|pwsh|powershell|cmd|bash|sh|wsl|ffmpeg|curl|wget|adb|fastboot)$'

    function Is-ExcludedCandidatePath([string]$inputPath) {
      if (-not $inputPath) { return $false }

      $fullPath = $inputPath
      try {
        $fullPath = [System.IO.Path]::GetFullPath($inputPath)
      } catch {
      }

      $normalized = $fullPath.Replace('/', '\\').ToLowerInvariant()

            return $normalized.Contains('\\programdata\\package cache\\') -or
              $normalized.Contains('\\program files\\package cache\\') -or
              $normalized.Contains('\\program files (x86)\\package cache\\') -or
              $normalized.Contains('\\windows\\installer\\') -or
              $normalized.Contains('\\programdata\\microsoft\\visualstudio\\packages\\') -or
              $normalized.Contains('\\reference assemblies\\microsoft\\framework\\')
    }

      function Is-InstallerArtifactPath([string]$inputPath) {
        if (-not $inputPath) { return $false }

        $fileName = [System.IO.Path]::GetFileName($inputPath)
        if (-not $fileName) { return $false }

        if ($fileName -match $installerFileExtensionPattern) { return $true }

        if ($fileName -match $installerFileNamePattern -and $fileName -match '(?i)\\.exe$') {
          return $true
        }

        return $false
      }

      function Is-ExcludedWebTarget([string]$inputPath) {
        if (-not $inputPath) { return $false }
        return $inputPath.Trim().ToLowerInvariant() -match $excludedWebTargetPattern
      }

    function Get-ExeScore([object]$exe, [string]$displayName) {
      if ($null -eq $exe) { return [int]::MaxValue }

      $score = $exe.Name.Length
      $baseName = [System.IO.Path]::GetFileNameWithoutExtension($exe.Name)
      $lowerFullName = $exe.FullName.ToLowerInvariant()
      $displayNameLower = if ($displayName) { $displayName.ToLowerInvariant() } else { '' }

      if ($baseName -match $cliExeNamePattern) { $score += 120 }
      if ($baseName -match '(?i)(cli|command|console|terminal)') { $score += 60 }
      if ($lowerFullName -match '\\bin\\') { $score += 35 }
      if ($baseName -match '(?i)launcher') { $score += 15 }
      if ($baseName -match '(?i)(desktop|client|app|gui)') { $score -= 35 }

      if ($displayNameLower) {
        if ($displayNameLower -match '(?i)desktop' -and $baseName -match '(?i)desktop') { $score -= 30 }
        if ($displayNameLower -match '(?i)studio' -and $baseName -match '(?i)studio') { $score -= 20 }
        if ($displayNameLower -match '(?i)code' -and $baseName -match '(?i)code') { $score -= 20 }
      }

      return $score
    }

    function Select-BestExecutable([string]$directoryPath, [string]$displayName) {
      if (-not $directoryPath -or -not (Test-Path $directoryPath)) { return $null }

      $executables = Get-ChildItem -Path $directoryPath -Filter *.exe -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch $excludedExePattern -and $_.Name -notmatch $auxiliaryExePattern }

      if (-not $executables) { return $null }

      return $executables |
        Sort-Object @{Expression = { Get-ExeScore $_ $displayName }}, @{Expression = { $_.Name }} |
        Select-Object -First 1
    }

    function Resolve-LaunchCandidate([object]$entry, [string]$displayName) {
      $candidate = $null

      if ($entry.DisplayIcon) {
        $candidate = ($entry.DisplayIcon -split ',')[0].Trim('"')
      }

      if (-not $candidate -and $entry.InstallLocation) {
        $candidate = $entry.InstallLocation.Trim('"')
      }

      if (-not $candidate -and $entry.InstallSource) {
        $candidate = $entry.InstallSource.Trim('"')
      }

      if (-not $candidate) {
        return $null
      }

      if (Is-ExcludedCandidatePath $candidate) {
        return $null
      }

      if (Is-InstallerArtifactPath $candidate) {
        return $null
      }

      if (Is-ExcludedWebTarget $candidate) {
        return $null
      }

      if (-not (Test-Path $candidate)) {
        if ($candidate -match '\\.exe$' -or $candidate -match '\\.lnk$') {
          return $null
        }

        return $candidate
      }

      $item = Get-Item -LiteralPath $candidate -ErrorAction SilentlyContinue
      if ($null -eq $item) {
        return $null
      }

      if (Is-ExcludedCandidatePath $item.FullName) {
        return $null
      }

      if (Is-InstallerArtifactPath $item.FullName) {
        return $null
      }

      if (Is-ExcludedWebTarget $item.FullName) {
        return $null
      }

      if (-not $item.PSIsContainer) {
        $extension = [System.IO.Path]::GetExtension($item.Name)
        if ($extension) {
          $extension = $extension.ToLowerInvariant()
        }

        if ($extension -eq '.ico') {
          $candidateDirs = New-Object System.Collections.Generic.List[string]

          if ($item.DirectoryName) {
            $candidateDirs.Add($item.DirectoryName)
            $parentDir = Split-Path -Path $item.DirectoryName -Parent
            if ($parentDir) {
              $candidateDirs.Add($parentDir)
            }
          }

          if ($entry.InstallLocation) {
            $candidateDirs.Add($entry.InstallLocation.Trim('"'))
          }

          foreach ($dir in ($candidateDirs | Select-Object -Unique)) {
            if (-not $dir -or -not (Test-Path $dir)) { continue }
            $replacement = Select-BestExecutable -directoryPath $dir -displayName $displayName
            if ($replacement) {
              return $replacement.FullName
            }
          }

          return $null
        }

        if ($item.Name -match $excludedExePattern -or $item.Name -match $auxiliaryExePattern) {
          $dir = Split-Path -Path $item.FullName -Parent
          $replacement = Select-BestExecutable -directoryPath $dir -displayName $displayName

          if (-not $replacement) {
            $parentDir = Split-Path -Path $dir -Parent
            $replacement = Select-BestExecutable -directoryPath $parentDir -displayName $displayName
          }

          if ($replacement) {
            return $replacement.FullName
          }
        }

        return $item.FullName
      }

      $exe = Select-BestExecutable -directoryPath $item.FullName -displayName $displayName

      if ($exe) {
        return $exe.FullName
      }

      return $item.FullName
    }

    foreach ($path in $paths) {
      Get-ItemProperty -Path $path -ErrorAction SilentlyContinue | ForEach-Object {
        $displayName = $_.DisplayName;
        if (-not $displayName) { return; }

        $displayName = $displayName.Trim();
        if (-not $displayName) { return; }

        if ($displayName -match $excludedDisplayNamePattern) { return; }
        if ($displayName -match $excludedFrameworkDisplayNamePattern) { return; }
        if ($displayName -match $excludedRedistributableDisplayNamePattern) { return; }
        if ($displayName -match $excludedSystemComponentDisplayNamePattern) { return; }
        if ($displayName -match $excludedVisualStudioPackageDisplayNamePattern) { return; }

        $candidate = Resolve-LaunchCandidate $_ $displayName

        if (-not $candidate) { return; }
        if ($candidate -match '\\.ico$') { return; }
        if (Is-ExcludedCandidatePath $candidate) { return; }
        if (Is-InstallerArtifactPath $candidate) { return; }
        if (Is-ExcludedWebTarget $candidate) { return; }

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

      if ($appId -match '^(?i)https?:') { return }

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
      clearTimeout(safetyTimeout);

      if (err) {
        finish([]);
        return;
      }

      try {
        const raw = (stdout || '').trim();
        if (!raw) {
          finish([]);
          return;
        }

        const parsed = JSON.parse(raw);
        const apps = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
        finish(apps);
      } catch (error) {
        finish([]);
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
