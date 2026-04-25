import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function homePath(...parts) {
  return path.join(os.homedir(), ...parts);
}

export function configDir(appName, env = process.env) {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', appName);
  }
  if (process.platform === 'win32') {
    return path.join(env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName);
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), appName);
}

export function lstatSafe(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch {
    return null;
  }
}

export function writeFileIfChanged(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) {
    return false;
  }
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

export function writeJsonFile(filePath, value) {
  return writeFileIfChanged(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
