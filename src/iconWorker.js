const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { parentPort } = require('worker_threads');

const excludedExecutablePattern = /(unins|uninstall|setup|update|crash|helper|installer)/i;

const appIconCache = new Map();
const pendingByKey = new Map();
const requestQueue = [];
let isExtracting = false;

function getCacheKey(targetPath, size) {
  return `${size}|${targetPath}`;
}

function removeFromQueue(cacheKey) {
  const index = requestQueue.indexOf(cacheKey);
  if (index >= 0) {
    requestQueue.splice(index, 1);
  }
}

function runPowerShell(script, callback) {
  const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
  execFile(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand],
    { windowsHide: true, maxBuffer: 1024 * 1024 * 10 },
    callback
  );
}

function resolveLaunchTarget(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') {
    return null;
  }

  const cleanedPath = targetPath.trim().replace(/^"|"$/g, '');
  if (!cleanedPath || !fs.existsSync(cleanedPath)) {
    return null;
  }

  const stats = fs.statSync(cleanedPath);
  if (stats.isFile()) {
    const fileName = path.basename(cleanedPath);
    if (excludedExecutablePattern.test(fileName)) {
      const dirPath = path.dirname(cleanedPath);
      const replacement = fs
        .readdirSync(dirPath)
        .filter((entry) => entry.toLowerCase().endsWith('.exe'))
        .filter((entry) => !excludedExecutablePattern.test(entry))
        .sort((left, right) => {
          const leftIsLauncher = /launcher/i.test(left);
          const rightIsLauncher = /launcher/i.test(right);

          if (leftIsLauncher !== rightIsLauncher) {
            return leftIsLauncher ? 1 : -1;
          }

          return left.length - right.length;
        })[0];

      return replacement ? path.join(dirPath, replacement) : cleanedPath;
    }

    return cleanedPath;
  }

  if (!stats.isDirectory()) {
    return null;
  }

  const executables = fs
    .readdirSync(cleanedPath)
    .filter((entry) => entry.toLowerCase().endsWith('.exe'))
    .filter((entry) => !excludedExecutablePattern.test(entry));

  if (executables.length === 0) {
    return cleanedPath;
  }

  executables.sort((left, right) => {
    const leftIsLauncher = /launcher/i.test(left);
    const rightIsLauncher = /launcher/i.test(right);

    if (leftIsLauncher !== rightIsLauncher) {
      return leftIsLauncher ? 1 : -1;
    }

    return left.length - right.length;
  });

  return path.join(cleanedPath, executables[0]);
}

function runNextExtraction() {
  if (isExtracting || requestQueue.length === 0) {
    return;
  }

  isExtracting = true;
  const cacheKey = requestQueue.shift();
  const pending = pendingByKey.get(cacheKey);

  if (!pending) {
    isExtracting = false;
    runNextExtraction();
    return;
  }

  const escaped = pending.candidate.replace(/'/g, "''");

  const psScript = `
    $ErrorActionPreference = 'SilentlyContinue'
    $path = '${escaped}'
    $size = ${pending.size}

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

    const settled = pendingByKey.get(cacheKey);
    pendingByKey.delete(cacheKey);

    if (settled) {
      settled.requestIds.forEach((requestId) => {
        parentPort.postMessage({ id: requestId, dataUrl });
      });
    }

    isExtracting = false;
    runNextExtraction();
  });
}

if (!parentPort) {
  process.exit(0);
}

parentPort.on('message', (message) => {
  const requestId = message?.id;
  const targetPath = message?.targetPath;
  const size = Number(message?.size) || 144;
  const forceRefresh = Boolean(message?.forceRefresh);
  const priority = Boolean(message?.priority);

  if (!requestId || !targetPath) {
    parentPort.postMessage({ id: requestId, dataUrl: null });
    return;
  }

  const cleaned = String(targetPath).trim().replace(/^"|"$/g, '');
  if (!cleaned || cleaned.startsWith('appx:')) {
    parentPort.postMessage({ id: requestId, dataUrl: null });
    return;
  }

  const cacheKey = getCacheKey(cleaned, size);
  if (forceRefresh) {
    appIconCache.delete(cacheKey);
  }

  const cached = appIconCache.get(cacheKey);
  if (cached && !forceRefresh) {
    parentPort.postMessage({ id: requestId, dataUrl: cached });
    return;
  }

  const existingPending = pendingByKey.get(cacheKey);
  if (existingPending) {
    existingPending.requestIds.push(requestId);

    if (priority) {
      removeFromQueue(cacheKey);
      requestQueue.unshift(cacheKey);
    }

    return;
  }

  const candidate = resolveLaunchTarget(cleaned) || cleaned;
  pendingByKey.set(cacheKey, {
    candidate,
    size,
    requestIds: [requestId]
  });

  if (priority) {
    requestQueue.unshift(cacheKey);
  } else {
    requestQueue.push(cacheKey);
  }
  runNextExtraction();
});
