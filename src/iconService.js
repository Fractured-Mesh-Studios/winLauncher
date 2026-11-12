function createIconService({ runPowerShell, resolveLaunchTarget, setKeyImage }) {
  const appIconCache = new Map();

  function getAppIconDataUrl(targetPath, size, callback) {
    if (!targetPath) {
      callback(null);
      return;
    }

    const cleaned = String(targetPath).trim().replace(/^"|"$/g, '');
    if (!cleaned || cleaned.startsWith('appx:')) {
      callback(null);
      return;
    }

    const cacheKey = `${size}|${cleaned}`;
    const cached = appIconCache.get(cacheKey);
    if (cached) {
      callback(cached);
      return;
    }

    const candidate = resolveLaunchTarget(cleaned) || cleaned;
    const escaped = candidate.replace(/'/g, "''");

    const psScript = `
    $ErrorActionPreference = 'SilentlyContinue'
    $path = '${escaped}'
    $size = ${Number(size) || 144}

    if (-not (Test-Path $path)) { return }

    try {
      Add-Type -AssemblyName System.Drawing

      if (-not ('IconNative' -as [type])) {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class IconNative {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern uint PrivateExtractIcons(
        string szFileName,
        int nIconIndex,
        int cxIcon,
        int cyIcon,
        IntPtr[] phicon,
        uint[] piconid,
        uint nIcons,
        uint flags);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool DestroyIcon(IntPtr hIcon);
}
"@ -Language CSharp
      }

      $resolved = (Resolve-Path $path).Path
      if ((Get-Item $resolved).PSIsContainer) {
        $exe = Get-ChildItem -Path $resolved -Filter *.exe -File | Select-Object -First 1
        if ($null -eq $exe) { return }
        $resolved = $exe.FullName
      }

      $sourceBitmap = $null
      $icon = $null
      $iconHandle = [IntPtr]::Zero

      if ($resolved.ToLowerInvariant().EndsWith('.ico')) {
        $sourceBitmap = [System.Drawing.Bitmap]::FromFile($resolved)
      } else {
        $handles = New-Object IntPtr[] 1
        $ids = New-Object UInt32[] 1
        [IconNative]::PrivateExtractIcons($resolved, 0, 256, 256, $handles, $ids, 1, 0) | Out-Null
        $iconHandle = $handles[0]

        if ($iconHandle -ne [IntPtr]::Zero) {
          $icon = [System.Drawing.Icon]::FromHandle($iconHandle)
          $sourceBitmap = $icon.ToBitmap()
        } else {
          $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($resolved)
          if ($icon -ne $null) {
            $sourceBitmap = $icon.ToBitmap()
          }
        }
      }

      if ($null -eq $sourceBitmap) { return }

      $render = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $graphics = [System.Drawing.Graphics]::FromImage($render)
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.DrawImage($sourceBitmap, 0, 0, $size, $size)

      $stream = New-Object System.IO.MemoryStream
      $render.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
      [Convert]::ToBase64String($stream.ToArray())

      $stream.Dispose()
      $graphics.Dispose()
      $render.Dispose()
      $sourceBitmap.Dispose()
      if ($icon -ne $null) { $icon.Dispose() }
      if ($iconHandle -ne [IntPtr]::Zero) { [IconNative]::DestroyIcon($iconHandle) | Out-Null }
    } catch {
    }
  `;

    runPowerShell(psScript, (err, stdout) => {
      if (err) {
        callback(null);
        return;
      }

      const base64 = (stdout || '').trim();
      if (!base64) {
        callback(null);
        return;
      }

      const dataUrl = `data:image/png;base64,${base64}`;
      appIconCache.set(cacheKey, dataUrl);
      callback(dataUrl);
    });
  }

  function updateKeyImage(context, targetPath, iconSource, launchIconSourceCache) {
    if (!context || !targetPath) {
      return;
    }

    const iconTarget = iconSource || launchIconSourceCache.get(targetPath) || targetPath;
    getAppIconDataUrl(iconTarget, 144, (dataUrl) => {
      if (!dataUrl) {
        return;
      }

      setKeyImage(context, dataUrl);
    });
  }

  return {
    getAppIconDataUrl,
    updateKeyImage
  };
}

module.exports = {
  createIconService
};
