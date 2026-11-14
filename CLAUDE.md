# Screen Share Collab — instruções para o Claude Code

App Electron para compartilhar tela inteira ou uma janela com o áudio daquele processo, para um grupo pequeno de amigos assistir pelo navegador ou pelo app. Fluxo: Electron (`main.js`, `preload.js`) → interface em `public/` → addon nativo C++ WASAPI (`src/native/audio_capture.cc/.h`, compilado por `binding.gyp` como `wasi_audio.node`) → AudioWorklet → LiveKit. Token da sala: função Vercel em `api/get-token.js`.

**Alvo principal: Windows.** Secundário: Linux (Arch e distros baseadas em Debian), hoje com validação insuficiente.

## Antes de qualquer tarefa

1. Leia `HANDOFF.md` e `RELATORIO_CONTINUIDADE_PROJETO.md`. Eles são a fonte do estado atual.
2. Confira: branch (`versao-electron`), HEAD, `git status`, `git diff --check` e os hashes SHA-256 listados no relatório (fontes WASAPI e binários).
3. Se algo não bater com o handoff, pare e relate antes de agir.

## Regras do projeto (também em `GEMINI.md`)

- Preservar a arquitetura existente. Alterações pequenas e compatíveis. Não recriar o app, não usar OBS.
- Analisar o código existente antes de implementar qualquer coisa.
- `ARQUITETURA.md` é histórico e diverge do código. Não use como especificação.

## Proibições e cuidados

- **Nunca rode `npm run rebuild` nem `npm run build:win`.** Eles executam `node-gyp rebuild` sem alvo Electron e podem sobrescrever `build/Release/wasi_audio.node`. Para compilar o addon use apenas `npm run build:native:electron:isolated` (saída fora do repositório).
- **Não substitua, mova ou apague nada em `build/`** sem autorização explícita do proprietário nesta conversa. A promoção do addon (Etapa 3C) exige backup verificado, hashes e plano de reversão aprovados antes.
- Não descarte, restaure, agrupe ou commite as alterações locais sem revisão e pedido explícito.
- Não leia nem exponha `.env`, senhas ou tokens. Não cole segredos em logs ou documentos.
- Não acesse o volume `H:`. Não limpe `dist*/`, o arquivo `-` na raiz, perfis Electron, backups ou pastas temporárias de testes anteriores.
- Não retome a investigação das mini travadas de WebRTC nem mexa em buffers, temporizações, LiveKit ou vídeo como efeito colateral de outra tarefa. Isso foi adiado pelo proprietário.
- Não contorne restrições de segurança do sistema ou do Claude Code.

## Como rodar e testar

- App normal: `npm start` (carrega o addon de `build/Release/`, hoje o **antigo**).
- Com DevTools: `npm run dev`.
- **Modo isolado** (perfil Electron temporário, não toca nos dados normais):
  - `COLLAB_ISOLATED_RUN=1 npx electron .`
  - Para testar outro addon: acrescente `COLLAB_ISOLATED_ADDON=<caminho absoluto do .node fora do repositório>`.
  - Prefira sempre o modo isolado em testes automáticos.
- O Electron gráfico precisa rodar no Windows nativo (não no WSL). Registre sempre o código de saída do processo; os testes anteriores não tiveram código de saída confiável.
- Testes de **captura e transmissão real** (áudio de processo, entrada em sala LiveKit) só com autorização do proprietário para aquela rodada.

## Pendências conhecidas

- Etapa 3C: promover o addon PID Drain corrigido (2M validado em runtime, 3B só estático) ao caminho normal, com backup e reversão. Escolha do artefato é do proprietário.
- Confirmar se os presets de vídeo 480p, 720p e 1080p (`public/app.js`) entregam a resolução e o FPS esperados.
- Validar o instalador (`build:win`, `asarUnpack`) depois de corrigir o fluxo de build.
- Não há executor de testes automatizado ainda. Adicionar Playwright ou qualquer dependência ao `package.json` precisa de aprovação.

## Forma de trabalho

O proprietário usa o chat do Claude como arquiteto/revisor e o Claude Code como construtor/testador.

- Para etapas arriscadas, apresente o plano antes de executar e espere o ok.
- Ao terminar cada etapa, atualize `HANDOFF.md` (estado, hashes, o que foi testado, próximos passos) para que o chat de arquitetura possa revisar.
- Escreva em português.
