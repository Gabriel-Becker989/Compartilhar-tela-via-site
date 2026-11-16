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

- **Compilar o addon:** só com `npm run build:native:electron:isolated` (saída fora do repositório); trocar o binário em `build/Release` exige backup e autorização. `npm run rebuild` está desativado (só imprime aviso e sai com código 1).
- **Gerar instalador:** `npm run build:win` empacota sem compilar nada (`prebuild:win` mostra o SHA-256 do addon; `npmRebuild: false`) e grava em `dist-release/`. Não use `node-gyp rebuild` diretamente na raiz.
- **Não substitua, mova ou apague nada em `build/`** sem autorização explícita do proprietário nesta conversa. A promoção do addon (Etapa 3C) exige backup verificado, hashes e plano de reversão aprovados antes.
- Não descarte, restaure, agrupe ou commite as alterações locais sem revisão e pedido explícito.
- Não leia nem exponha `.env`, senhas ou tokens. Não cole segredos em logs ou documentos.
- Não acesse o volume `H:`. Não limpe `dist*/`, o arquivo `-` na raiz, perfis Electron, backups ou pastas temporárias de testes anteriores.
- Não retome a investigação das mini travadas de WebRTC nem mexa em buffers, temporizações, LiveKit ou vídeo como efeito colateral de outra tarefa. Isso foi adiado pelo proprietário.
- Não contorne restrições de segurança do sistema ou do Claude Code.

## Como rodar e testar

- App normal: `npm start` (carrega o addon de `build/Release/`, hoje o **3B**, SHA-256 `2FDF4E35…98C0`). Atenção: `npm start` usa `--disable-gpu`; para testes de vídeo prefira `npm run dev`.
- Com DevTools: `npm run dev`.
- **Modo isolado** (perfil Electron temporário, não toca nos dados normais):
  - `COLLAB_ISOLATED_RUN=1 npx electron .`
  - Para testar outro addon: acrescente `COLLAB_ISOLATED_ADDON=<caminho absoluto do .node fora do repositório>`.
  - Prefira sempre o modo isolado em testes automáticos.
- O Electron gráfico precisa rodar no Windows nativo (não no WSL). Registre sempre o código de saída do processo; os testes anteriores não tiveram código de saída confiável.
- Testes de **captura e transmissão real** (áudio de processo, entrada em sala LiveKit) só com autorização do proprietário para aquela rodada.

## Pendências conhecidas

- Feito (ver `HANDOFF.md`): Etapa 3C (3B promovido com backup), presets de vídeo medidos (`scripts/test-presets.js`), fluxo de build corrigido e instalador validado (`asarUnpack`, sem `.env`), correções de atraso do áudio e de sincronia validadas em live.
- Validar a opção experimental H.264 High (`localStorage['collab.h264High']`) numa live com o proprietário transmitindo.
- Republicar o site na Vercel para os espectadores pelo navegador usarem o `livekit-client@2.24.1` fixado.
- Não há executor de testes automatizado ainda. Adicionar Playwright ou qualquer dependência ao `package.json` precisa de aprovação.

## Forma de trabalho

O proprietário usa o chat do Claude como arquiteto/revisor e o Claude Code como construtor/testador.

- Para etapas arriscadas, apresente o plano antes de executar e espere o ok.
- Ao terminar cada etapa, atualize `HANDOFF.md` (estado, hashes, o que foi testado, próximos passos) para que o chat de arquitetura possa revisar.
- Escreva em português.
