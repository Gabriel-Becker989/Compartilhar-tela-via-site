// Build the current working-tree addon for the locally installed Electron.
// All generated files stay under a new directory outside this repository.
// Usage: npm run build:native:electron:isolated -- --devdir=<cached headers root> --output-root=<external directory> [--python=<python.exe>]
// The complete Electron header cache must already exist; this command never installs dependencies.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = /^--(devdir|output-root|python)=(.+)$/.exec(arg);
  if (!match) throw new Error(`Unknown argument: ${arg}`);
  return [match[1], match[2]];
}));

function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function requireFile(file) {
  if (!fs.statSync(file).isFile()) throw new Error(`Not a file: ${file}`);
}

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('This build command requires Windows x64');
}
if (!options.devdir || !options['output-root']) {
  throw new Error('Pass --devdir=<Electron header cache> and --output-root=<directory outside repo>');
}

const version = require(path.join(repo, 'node_modules/electron/package.json')).version;
const gypPackage = require(path.join(repo, 'node_modules/node-gyp/package.json'));
const gyp = path.join(repo, 'node_modules/node-gyp/bin/node-gyp.js');
const devdir = fs.realpathSync(options.devdir);
const headers = path.join(devdir, version);
const outputRoot = path.resolve(options['output-root']);
const sources = [
  'binding.gyp',
  'src/native/audio_capture.cc',
  'src/native/audio_capture.h',
  'src/native/stub.cc',
];

for (const file of sources) requireFile(path.join(repo, file));
requireFile(gyp);
requireFile(path.join(headers, 'include/node/config.gypi'));
requireFile(path.join(headers, 'x64/node.lib'));
const installed = Number(fs.readFileSync(path.join(headers, 'installVersion'), 'utf8').trim());
if (!Number.isInteger(installed) || installed < gypPackage.installVersion) {
  throw new Error(`Incomplete Electron ${version} header cache`);
}
if (options.python) requireFile(path.resolve(options.python));
if (within(repo, outputRoot) || within(outputRoot, repo)) {
  throw new Error('The output root must not overlap the repository');
}
if (within(repo, devdir) || within(devdir, repo)) {
  throw new Error('The header cache must not overlap the repository');
}

fs.mkdirSync(outputRoot, { recursive: true });
const tree = fs.mkdtempSync(path.join(outputRoot, 'wasi-audio-electron-'));
fs.mkdirSync(path.join(tree, 'src/native'), { recursive: true });
fs.mkdirSync(path.join(tree, 'node_modules'), { recursive: true });
fs.mkdirSync(path.join(tree, 'tmp'));

const copied = {};
for (const file of sources) {
  fs.copyFileSync(path.join(repo, file), path.join(tree, file));
  copied[file] = sha256(path.join(tree, file));
  if (copied[file] !== sha256(path.join(repo, file))) throw new Error(`Copy changed: ${file}`);
}
fs.cpSync(path.join(repo, 'node_modules/node-addon-api'), path.join(tree, 'node_modules/node-addon-api'), { recursive: true });

const env = { ...process.env, TEMP: path.join(tree, 'tmp'), TMP: path.join(tree, 'tmp') };
if (options.python) env.PYTHON = path.resolve(options.python);
const target = [`--target=${version}`, '--arch=x64', '--dist-url=https://electronjs.org/headers', `--devdir=${devdir}`, '--verbose'];
function run(phase) {
  const log = path.join(tree, `${phase}.log`);
  const fd = fs.openSync(log, 'w');
  let result;
  try {
    result = spawnSync(process.execPath, [gyp, phase, ...target], {
      cwd: tree, env, stdio: ['ignore', fd, fd], windowsHide: true,
    });
  } finally {
    fs.closeSync(fd);
  }
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${phase} failed with exit ${result.status}; see ${log}`);
  return log;
}

console.log(`Tree: ${tree}`);
console.log(`Electron: ${version} x64; cached node.lib SHA-256: ${sha256(path.join(headers, 'x64/node.lib'))}`);
console.log(`Source SHA-256: ${JSON.stringify(copied)}`);
console.log(`Configure log: ${run('configure')}`);
console.log(`Build log: ${run('build')}`);
const addon = path.join(tree, 'build/Release/wasi_audio.node');
requireFile(addon);
console.log(`Addon: ${addon}`);
console.log(`Bytes: ${fs.statSync(addon).size}; SHA-256: ${sha256(addon)}`);
