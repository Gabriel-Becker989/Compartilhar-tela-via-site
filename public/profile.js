/* =====================================================================
 *  Profile Manager — Persistent User Profile (localStorage)
 *  ===================================================================== */

const PROFILE_KEY = 'screen-share-profile';
const ADJECTIVES = [
  'Silencioso', 'Veloz', 'Brilhante', 'Cósmico', 'Digital', 'Elétrico',
  'Furtivo', 'Galáctico', 'Hiperativo', 'Invisível', 'Jovial', 'Kinetico',
  'Luminoso', 'Místico', 'Neon', 'Orbital', 'Pixelado', 'Quântico',
  'Radiante', 'Sônico', 'Temporal', 'Ultravioleta', 'Virtual', 'Xerox',
  'Zênite'
];
const NOUNS = [
  'Astronauta', 'Borboleta', 'Cactus', 'Dragão', 'Esquilo', 'Fênix',
  'Gato', 'Hamster', 'Iguana', 'Jaguar', 'Koala', 'Lince',
  'Morsa', 'Narval', 'Orca', 'Panda', 'Quati', 'Rato',
  'Saguim', 'Tucano', 'Urso', 'Vaquinha', 'Xexeu', 'Zebra'
];

function generateNickname() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 100);
  return `${adj}${noun}${num}`;
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function generateAvatarSeed() {
  return Math.floor(Math.random() * 1000000);
}

function getDefaultProfile() {
  return {
    uuid: generateUUID(),
    nickname: generateNickname(),
    avatarSeed: generateAvatarSeed(),
    createdAt: Date.now()
  };
}

function loadProfile() {
  try {
    const stored = localStorage.getItem(PROFILE_KEY);
    if (stored) {
      const profile = JSON.parse(stored);
      // Migração: garantir campos obrigatórios
      if (!profile.uuid) profile.uuid = generateUUID();
      if (!profile.nickname) profile.nickname = generateNickname();
      if (!profile.avatarSeed) profile.avatarSeed = generateAvatarSeed();
      if (!profile.createdAt) profile.createdAt = Date.now();
      saveProfile(profile);
      return profile;
    }
  } catch (e) {
    console.warn('[Profile] Erro ao carregar:', e);
  }
  const profile = getDefaultProfile();
  saveProfile(profile);
  return profile;
}

function saveProfile(profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch (e) {
    console.error('[Profile] Erro ao salvar:', e);
  }
}

function getAvatarDataURL(seed, size = 100) {
  // Gera avatar determinístico baseado na seed (DiceBear style)
  const colors = [
    '#5865f2', '#3ba55d', '#ed4245', '#faa61a', '#a371f7',
    '#00b0f4', '#f47fff', '#23a55a', '#e84d4d', '#7c8cff'
  ];
  const bgColor = colors[seed % colors.length];
  
  // Padrão geométrico simples baseado na seed
  let pattern = '';
  const cellSize = size / 10;
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      const bit = (seed >> ((y * 10 + x) % 32)) & 1;
      if (bit) {
        pattern += `<rect x="${x * cellSize}" y="${y * cellSize}" width="${cellSize}" height="${cellSize}" fill="white" opacity="0.15"/>`;
      }
    }
  }
  
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" fill="${bgColor}"/>` +
    pattern +
    `</svg>`
  )}`;
}

function updateProfile(updates) {
  const profile = loadProfile();
  Object.assign(profile, updates);
  saveProfile(profile);
  return profile;
}

function resetProfile() {
  localStorage.removeItem(PROFILE_KEY);
  return loadProfile();
}

// Exporta para uso global
window.ProfileManager = {
  load: loadProfile,
  save: saveProfile,
  update: updateProfile,
  reset: resetProfile,
  getAvatar: getAvatarDataURL,
  generateNickname,
  generateUUID
};