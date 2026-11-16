// Verificação antes de empacotar (roda sozinho via "prebuild:win").
// Confere se o addon nativo existe em build/Release e mostra o SHA-256,
// para ficar registrado qual binário foi para o instalador.
// Não compila nem altera nada.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const addon = path.join(__dirname, '..', 'build', 'Release', 'wasi_audio.node');

if (!fs.existsSync(addon) || !fs.statSync(addon).isFile()) {
  console.error(`[check-addon] Addon ausente: ${addon}`);
  console.error('[check-addon] Compile com npm run build:native:electron:isolated e promova com backup (ver HANDOFF.md).');
  process.exit(1);
}

const hash = crypto.createHash('sha256').update(fs.readFileSync(addon)).digest('hex').toUpperCase();
console.log(`[check-addon] ${addon}`);
console.log(`[check-addon] ${fs.statSync(addon).size} bytes; SHA-256: ${hash}`);
