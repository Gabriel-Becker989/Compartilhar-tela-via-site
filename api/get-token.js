import { AccessToken } from 'livekit-server-sdk';

export default async function handler(req, res) {
  try {
    const { roomName, participantName, password, avatar } = req.query;

    // 1. Validação da senha "ovo"
    if (password !== 'ovo') {
      return res.status(403).json({ error: 'Senha incorreta!' });
    }

    // 2. Leitura das variáveis globais cadastradas na Vercel
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const wsUrl = process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !wsUrl) {
      return res.status(500).json({ error: 'Configuração de ambiente ausente no servidor.' });
    }

    // 3. Montagem do Token JWT com o avatar no Metadata
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
    console.error('Erro na API Serverless:', error);
    return res.status(500).json({ error: 'Falha ao processar o token.' });
  }
}
