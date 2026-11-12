const { execFile } = require('child_process');

function runPowerShell(script, callback) {
  const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
  execFile(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand],
    { windowsHide: true, maxBuffer: 1024 * 1024 * 10 },
    callback
  );
}

module.exports = {
  runPowerShell
};
