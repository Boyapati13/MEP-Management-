const { spawnSync } = require('node:child_process');
const path = require('node:path');

const androidDir = path.join(process.cwd(), 'android');
const isWindows = process.platform === 'win32';
const command = isWindows ? 'gradlew.bat' : './gradlew';
const result = spawnSync(command, ['assembleDebug'], {
  cwd: androidDir,
  stdio: 'inherit',
  shell: isWindows,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
