const fs = require('fs');
const path = require('path');

const excludedExecutablePattern = /(unins|uninstall|setup|update|crash|helper|installer)/i;
const auxiliaryExecutablePattern = /(courgette|crashpad|updater|autoupdate|squirrel|mini[_-]?installer|elevate|gameoverlay|overlayui|steamservice|steamerrorreporter|steamwebhelper|webhelper)/i;
const cliExecutableNamePattern = /^(docker|kubectl|git|node|npm|npx|pnpm|yarn|python|py|pip|java|javac|pwsh|powershell|cmd|bash|sh|wsl|ffmpeg|curl|wget|adb|fastboot)$/i;
const cliExecutableHintPattern = /(cli|command|console|terminal)/i;
const desktopExecutableHintPattern = /(desktop|client|app|gui)/i;
const excludedPathPattern = /\\programdata\\package cache\\|\\program files(?: \(x86\))?\\package cache\\|\\windows\\installer\\|\\programdata\\microsoft\\visualstudio\\packages\\|\\reference assemblies\\microsoft\\framework\\/i;
const installerFileExtensionPattern = /\.(msi|msp|msix|msixbundle|appx|appxbundle|msu|cab)$/i;
const excludedWebTargetPattern = /^(https?:|appx:https?:)|\.(html?|url)$/i;

function isExcludedPath(fullPath) {
  return excludedPathPattern.test(String(fullPath || '').replace(/\//g, '\\'));
}

function isInstallerArtifactFile(fileName) {
  return installerFileExtensionPattern.test(String(fileName || ''));
}

function isExcludedWebTarget(targetPath) {
  return excludedWebTargetPattern.test(String(targetPath || '').trim().toLowerCase());
}

function scoreExecutable(fileName, fullPath) {
  const baseName = path.basename(fileName, path.extname(fileName));
  const normalizedPath = String(fullPath || '').toLowerCase();

  let score = fileName.length;

  if (cliExecutableNamePattern.test(baseName)) {
    score += 120;
  }

  if (cliExecutableHintPattern.test(baseName)) {
    score += 60;
  }

  if (normalizedPath.includes('\\bin\\')) {
    score += 35;
  }

  if (/launcher/i.test(baseName)) {
    score += 15;
  }

  if (desktopExecutableHintPattern.test(baseName)) {
    score -= 35;
  }

  return score;
}

function isLikelyCliExecutable(fileName, fullPath) {
  const baseName = path.basename(fileName, path.extname(fileName));
  const normalizedPath = String(fullPath || '').toLowerCase();

  return cliExecutableNamePattern.test(baseName)
    || cliExecutableHintPattern.test(baseName)
    || normalizedPath.includes('\\bin\\');
}

function isLikelyAuxiliaryExecutable(fileName) {
  return auxiliaryExecutablePattern.test(fileName);
}

function pickExecutableFromDirectory(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) {
    return null;
  }

  const stats = fs.statSync(dirPath);
  if (!stats.isDirectory()) {
    return null;
  }

  const executables = fs
    .readdirSync(dirPath)
    .filter((entry) => entry.toLowerCase().endsWith('.exe'))
    .filter((entry) => !excludedExecutablePattern.test(entry))
    .filter((entry) => !isLikelyAuxiliaryExecutable(entry));

  if (executables.length === 0) {
    return null;
  }

  executables.sort((left, right) => {
    const leftScore = scoreExecutable(left, path.join(dirPath, left));
    const rightScore = scoreExecutable(right, path.join(dirPath, right));

    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }

    return left.localeCompare(right);
  });

  return path.join(dirPath, executables[0]);
}

function pickExecutableNearFile(filePath) {
  const currentDir = path.dirname(filePath);
  const parentDir = path.dirname(currentDir);

  const inCurrent = pickExecutableFromDirectory(currentDir);
  if (inCurrent && inCurrent.toLowerCase() !== filePath.toLowerCase()) {
    return inCurrent;
  }

  const inParent = pickExecutableFromDirectory(parentDir);
  if (inParent && inParent.toLowerCase() !== filePath.toLowerCase()) {
    return inParent;
  }

  return null;
}

function resolveLaunchTarget(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') {
    return null;
  }

  const cleanedPath = targetPath.trim().replace(/^"|"$/g, '');
  if (!cleanedPath || !fs.existsSync(cleanedPath)) {
    if (isExcludedWebTarget(cleanedPath)) {
      return null;
    }

    return null;
  }

  if (isExcludedWebTarget(cleanedPath)) {
    return null;
  }

  if (isExcludedPath(cleanedPath)) {
    return null;
  }

  const stats = fs.statSync(cleanedPath);
  if (stats.isFile()) {
    const fileName = path.basename(cleanedPath);
    const extension = path.extname(fileName).toLowerCase();

    if (isInstallerArtifactFile(fileName)) {
      return null;
    }

    if (extension === '.ico') {
      return pickExecutableNearFile(cleanedPath) || null;
    }

    if (excludedExecutablePattern.test(fileName) || isLikelyAuxiliaryExecutable(fileName)) {
      return pickExecutableNearFile(cleanedPath) || cleanedPath;
    }

    if (isLikelyCliExecutable(fileName, cleanedPath)) {
      const alternative = pickExecutableNearFile(cleanedPath);
      if (alternative && alternative.toLowerCase() !== cleanedPath.toLowerCase()) {
        return alternative;
      }
    }

    return cleanedPath;
  }

  if (!stats.isDirectory()) {
    return null;
  }

  const executable = pickExecutableFromDirectory(cleanedPath);
  if (!executable) {
    return cleanedPath;
  }

  return executable;
}

module.exports = {
  resolveLaunchTarget
};
