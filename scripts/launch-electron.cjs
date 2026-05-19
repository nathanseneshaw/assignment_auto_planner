// Launches Electron after explicitly DELETING ELECTRON_RUN_AS_NODE from the
// environment. cross-env can only set vars (including to ""), but Electron
// checks presence — `delete process.env.X` is the only way to make it go
// away. Without this, an inherited `ELECTRON_RUN_AS_NODE=1` from the shell
// causes electron.exe to run as a plain Node process: `require('electron')`
// returns the binary path instead of the API and `ipcMain.handle(...)` blows
// up at startup with "Cannot read properties of undefined".
'use strict'

const { spawn } = require('child_process')
const electronPath = require('electron')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

// Pass through extra args (e.g. `electron .` → here we always launch `.`).
const args = process.argv.slice(2)
if (args.length === 0) args.push('.')

const child = spawn(electronPath, args, { stdio: 'inherit', env, windowsHide: false })
child.on('close', (code, signal) => {
  if (code === null) {
    console.error('[launch-electron] exited with signal', signal)
    process.exit(1)
  }
  process.exit(code)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { if (!child.killed) child.kill(sig) })
}
