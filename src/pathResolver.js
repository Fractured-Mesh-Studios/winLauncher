const fs = require('fs');
const path = require('path');

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
    return cleanedPath;
  }

  if (!stats.isDirectory()) {
    return null;
  }

  const excluded = /(unins|uninstall|setup|update|crash|helper)/i;
  const executables = fs
    .readdirSync(cleanedPath)
    .filter((entry) => entry.toLowerCase().endsWith('.exe'))
    .filter((entry) => !excluded.test(entry));

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

module.exports = {
  resolveLaunchTarget
};
