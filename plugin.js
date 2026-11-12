const WebSocket = require('ws');
const { runPowerShell } = require('./src/powershell');
const { resolveLaunchTarget } = require('./src/pathResolver');
const { createStreamDeckMessaging } = require('./src/streamDeckMessaging');
const { createIconService } = require('./src/iconService');
const { createLaunchService } = require('./src/launchService');
const { createAppsService } = require('./src/appsService');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    args[argv[index].replace(/^-+/, '')] = argv[index + 1];
  }
  return args;
}

const args = parseArgs(process.argv);
const ws = new WebSocket(`ws://127.0.0.1:${args.port}`);
const settingsCache = {};
const launchIconSourceCache = new Map();

const { sendToInspector, setKeyImage } = createStreamDeckMessaging(ws);
const { getAppIconDataUrl, updateKeyImage } = createIconService({
  runPowerShell,
  resolveLaunchTarget,
  setKeyImage
});
const { launchApp } = createLaunchService({
  runPowerShell,
  resolveLaunchTarget
});
const { getInstalledApps } = createAppsService({
  runPowerShell
});

function refreshKeyImage(context, appPath, appIconSource, options = {}) {
  updateKeyImage(context, appPath, appIconSource, launchIconSourceCache, options);
}

function sendInstalledApps(context, action) {
  getInstalledApps((apps) => {
    apps.forEach((app) => {
      if (app?.Path && app?.IconSource) {
        launchIconSourceCache.set(app.Path, app.IconSource);
      }
    });

    sendToInspector(context, action, { apps });
  });
}

function handleGetAppIcon(msg) {
  const appPath = msg.payload?.appPath;
  const iconSource = msg.payload?.iconSource || appPath;
  const forceRefresh = Boolean(msg.payload?.forceRefresh);
  const priority = Boolean(msg.payload?.priority);

  if (appPath && iconSource) {
    launchIconSourceCache.set(appPath, iconSource);
  }

  getAppIconDataUrl(iconSource, 32, (iconDataUrl) => {
    sendToInspector(msg.context, msg.action, {
      appPath,
      appIcon: iconDataUrl || null
    });
  }, { forceRefresh, priority });
}

function handleBrowse(msg) {
  const psScript = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Filter = 'Programs and Shortcuts (*.exe;*.lnk;*.bat;*.cmd)|*.exe;*.lnk;*.bat;*.cmd|Executable files (*.exe)|*.exe|All files (*.*)|*.*'; if ($f.ShowDialog() -eq 'OK') { $f.FileName }`;

  runPowerShell(psScript, (err, stdout) => {
    const selectedPath = (stdout || '').trim();
    if (selectedPath) {
      sendToInspector(msg.context, msg.action, { selectedPath });
    }
  });
}

ws.on('open', () => {
  ws.send(JSON.stringify({ event: args.registerEvent, uuid: args.pluginUUID }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.event === 'didReceiveSettings' || msg.event === 'willAppear') {
    settingsCache[msg.context] = msg.payload?.settings || {};
    refreshKeyImage(
      msg.context,
      settingsCache[msg.context]?.appPath,
      settingsCache[msg.context]?.appIconSource
    );
  }

  if (msg.event === 'sendToPlugin' && msg.payload?.command === 'browse') {
    handleBrowse(msg);
  }

  if (msg.event === 'sendToPlugin' && msg.payload?.command === 'listApps') {
    sendInstalledApps(msg.context, msg.action);
  }

  if (msg.event === 'sendToPlugin' && msg.payload?.command === 'refreshIcon') {
    const appPath = msg.payload?.appPath || settingsCache[msg.context]?.appPath;
    const appIconSource = msg.payload?.iconSource || settingsCache[msg.context]?.appIconSource;
    refreshKeyImage(msg.context, appPath, appIconSource, {
      forceRefresh: Boolean(msg.payload?.forceRefresh),
      priority: Boolean(msg.payload?.priority)
    });
  }

  if (msg.event === 'sendToPlugin' && msg.payload?.command === 'getAppIcon') {
    handleGetAppIcon(msg);
  }

  if (msg.event === 'keyDown') {
    const targetPath = msg.payload?.settings?.appPath || settingsCache[msg.context]?.appPath;
    if (targetPath) {
      launchApp(targetPath);
    }
  }
});
