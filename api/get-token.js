const { AccessToken } = require('livekit-server-sdk');

module.exports = async function handler(req, res) {
  try {
    const { roomName, participantName, password, avatar } = req.query;

    // 1. Validação da senha "ovo"
    if (password !== 'ovo') {
      return res.status(403).json({ error: 'Senha incorreta!' });
    }

    // 2. Leitura das variáveis de ambiente na Vercel
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const wsUrl = process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !wsUrl) {
      console.error('Chaves ausentes:', { apiKey: !!apiKey, apiSecret: !!apiSecret, wsUrl: !!wsUrl });
      return res.status(500).json({ error: 'Variáveis de ambiente ausentes no servidor.' });
    }

    // 3. Geração do token JWT
    const at = new AccessToken(apiKey, apiSecret, {
      identity: participantName || `usuario-${Math.floor(Math.random() * 1000)}`,
                               metadata: JSON.stringify({ avatar: avatar || '' })
    });

    at.addGrant({
      roomJoin: true,
      room: roomName || 'sala-principal',
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();

    return res.status(200).json({ token, url: wsUrl });
  } catch (error) {
    console.error('Erro interno na função:', error);
    return res.status(500).json({ error: 'Erro interno na geração do token.' });
  }
};
