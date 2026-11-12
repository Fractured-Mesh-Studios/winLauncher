const path = require('path');
const { Worker } = require('worker_threads');

function createIconService({ runPowerShell, resolveLaunchTarget, setKeyImage }) {
  const appIconCache = new Map();
  const inflightRequests = new Map();
  const extractionQueue = [];
  let isExtracting = false;
  const workerCallbacks = new Map();
  let workerRequestId = 0;
  let iconWorker = null;
  let workerDisabled = false;

  function settleWorkerCallbacksWithNull() {
    workerCallbacks.forEach((callback) => callback(null));
    workerCallbacks.clear();
  }

  function ensureWorker() {
    if (iconWorker || workerDisabled) {
      return;
    }

    try {
      iconWorker = new Worker(path.join(__dirname, 'iconWorker.js'));

      iconWorker.on('message', (message) => {
        const callback = workerCallbacks.get(message?.id);
        if (!callback) {
          return;
        }

        workerCallbacks.delete(message.id);
        callback(message?.dataUrl || null);
      });

      iconWorker.on('error', () => {
        workerDisabled = true;
        settleWorkerCallbacksWithNull();
        iconWorker = null;
      });

      iconWorker.on('exit', (code) => {
        if (code !== 0) {
          workerDisabled = true;
        }
        settleWorkerCallbacksWithNull();
        iconWorker = null;
      });
    } catch {
      workerDisabled = true;
      iconWorker = null;
    }
  }

  function flushInflight(cacheKey, dataUrl) {
    const callbacks = inflightRequests.get(cacheKey) || [];
    inflightRequests.delete(cacheKey);
    callbacks.forEach((callback) => callback(dataUrl));
  }

  function getCacheKey(targetPath, size) {
    return `${size}|${targetPath}`;
  }

  function clearIconCacheForPath(targetPath) {
    if (!targetPath) {
      return;
    }

    const cleaned = String(targetPath).trim().replace(/^"|"$/g, '');
    if (!cleaned) {
      return;
    }

    Array.from(appIconCache.keys()).forEach((cacheKey) => {
      if (cacheKey.endsWith(`|${cleaned}`)) {
        appIconCache.delete(cacheKey);
      }
    });
  }

  function runNextExtraction() {
    if (isExtracting || extractionQueue.length === 0) {
      return;
    }

    isExtracting = true;
    const job = extractionQueue.shift();
    const { cacheKey, candidate, size } = job;
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
      const base64 = err ? '' : (stdout || '').trim();
      const dataUrl = base64 ? `data:image/png;base64,${base64}` : null;

      if (dataUrl) {
        appIconCache.set(cacheKey, dataUrl);
      }

      flushInflight(cacheKey, dataUrl);
      isExtracting = false;
      runNextExtraction();
    });
  }

  function getAppIconDataUrl(targetPath, size, callback, options = {}) {
    if (!targetPath) {
      callback(null);
      return;
    }

    const cleaned = String(targetPath).trim().replace(/^"|"$/g, '');
    if (!cleaned || cleaned.startsWith('appx:')) {
      callback(null);
      return;
    }

    const forceRefresh = Boolean(options.forceRefresh);
    const priority = Boolean(options.priority);
    const cacheKey = getCacheKey(cleaned, size);

    if (forceRefresh) {
      appIconCache.delete(cacheKey);
    }

    const cached = appIconCache.get(cacheKey);
    if (cached && !forceRefresh) {
      callback(cached);
      return;
    }

    ensureWorker();
    if (iconWorker && !workerDisabled) {
      const requestId = ++workerRequestId;
      workerCallbacks.set(requestId, (dataUrl) => {
        if (dataUrl) {
          appIconCache.set(cacheKey, dataUrl);
        }
        callback(dataUrl);
      });

      try {
        iconWorker.postMessage({
          id: requestId,
          targetPath: cleaned,
          size: Number(size) || 144,
          forceRefresh,
          priority
        });
        return;
      } catch {
        workerCallbacks.delete(requestId);
      }
    }

    const queuedCallbacks = inflightRequests.get(cacheKey);
    if (queuedCallbacks) {
      queuedCallbacks.push(callback);
      return;
    }

    inflightRequests.set(cacheKey, [callback]);

    const candidate = resolveLaunchTarget(cleaned) || cleaned;
    if (priority) {
      extractionQueue.unshift({ cacheKey, candidate, size });
    } else {
      extractionQueue.push({ cacheKey, candidate, size });
    }
    runNextExtraction();
  }

  function updateKeyImage(context, targetPath, iconSource, launchIconSourceCache, options = {}) {
    if (!context || !targetPath) {
      return;
    }

    const iconTarget = iconSource || launchIconSourceCache.get(targetPath) || targetPath;
    if (options.forceRefresh) {
      clearIconCacheForPath(iconTarget);
    }

    getAppIconDataUrl(iconTarget, 144, (dataUrl) => {
      if (!dataUrl) {
        return;
      }

      setKeyImage(context, dataUrl);
    }, options);
  }

  return {
    getAppIconDataUrl,
    updateKeyImage
  };
}

module.exports = {
  createIconService
};
