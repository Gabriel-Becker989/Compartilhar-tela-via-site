/**
 * Vercel Serverless Function - Gera token JWT para LiveKit Cloud
 * 
 * Endpoint: GET /api/get-token?roomName=sala-principal&participantName=Usuario-123
 * 
 * Requer variáveis de ambiente na Vercel:
 * - LIVEKIT_API_KEY
 * - LIVEKIT_API_SECRET
 * - LIVEKIT_URL (ex: wss://projeto-xxx.livekit.cloud)
 */

const { AccessToken } = require('livekit-server-sdk');

module.exports = async (req, res) => {
  // Configura CORS para permitir requisições do frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Responde a preflight OPTIONS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Obtém parâmetros (query string ou body)
    const { roomName, participantName } = req.method === 'GET' 
      ? req.query 
      : req.body;

    // Validação obrigatória
    if (!roomName || !participantName) {
      return res.status(400).json({ 
        error: 'Parâmetros obrigatórios: roomName e participantName' 
      });
    }

    // Valida variáveis de ambiente
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !livekitUrl) {
      console.error('[get-token] Variáveis de ambiente faltando');
      return res.status(500).json({ 
        error: 'Configuração do servidor incompleta' 
      });
    }

    // Cria token JWT com permissões de publicação e subscrição
    const at = new AccessToken(apiKey, apiSecret, {
      identity: participantName,
      name: participantName,
      ttl: '6h', // Token válido por 6 horas
    });

    // Concede permissões na sala
    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,        // Pode publicar vídeo/áudio/tela
      canSubscribe: true,      // Pode assistir outros
      canPublishData: true,    // Pode enviar dados via DataChannel
    });

    // Gera o token JWT
    const token = await at.toJwt();

    // Retorna token + URL do servidor LiveKit
    return res.status(200).json({ 
      token, 
      url: livekitUrl 
    });

  } catch (err) {
    console.error('[get-token] Erro ao gerar token:', err);
    return res.status(500).json({ 
      error: 'Erro interno ao gerar token de acesso' 
    });
  }
};