# Handoff — Screen Share Collab

**Estado em 11/11/2026:** consolidação do addon WASAPI PID Drain em andamento. Branch `versao-electron`, HEAD `ff2a980652cedc530563b351a2ba8d914af3470d`; staging vazio no início da auditoria. O projeto transmite tela e áudio pelo Electron/LiveKit para espectadores no navegador ou aplicativo. Windows é o alvo principal.

**Última atividade:** Etapa 3B criou `scripts/build-native-electron-isolated.js` e o script npm correspondente. O build isolado para Electron 28.3.3 x64 terminou com código 0, sem avisos ou erros, e passou em inspeção estática. O artefato 3B ainda não foi testado em execução. Antes disso, o addon PID Drain da Etapa 2M foi testado em transmissão real: ≈47.997 frames/s, zero refills e melhora audível significativa, com uma ou duas mini travadas restantes.

**Atualização 14/11/2026:** o addon 3B foi **promovido** a `build/Release/wasi_audio.node` (Etapa 3C parte 2, aprovada pelo proprietário). Ver a seção da parte 2 no fim deste arquivo; o parágrafo abaixo descreve o estado anterior.

**Ponto crítico (até 14/11/2026):** a execução normal ainda carrega o addon antigo `build/Release/wasi_audio.node`, SHA-256 `5DF88514964CD640386D514C054E9B40A1564E0A1AB62A5622901612B227C727`. O addon 2M funcionalmente validado tem hash `2346939F8D01861F847201F63DAEDEBFB402D2E11BE8024460096BEC52D15085`; o 3B tem hash `2FDF4E35F3E71247D9802E954D7985D4125732487E1C68826F0B0004718A98C0`. Os caminhos completos e evidências estão em `RELATORIO_CONTINUIDADE_PROJETO.md`.

**Alterações locais anteriores:** `main.js`, `package.json`, `public/app.js`, `src/native/audio_capture.cc`, `.h`, `src/native/stub.cc`; não rastreados `ARQUITETURA.md` e `scripts/build-native-electron-isolated.js`. Este handoff e o relatório também são novos. Não restaurar, descartar ou agrupar essas mudanças sem revisão. O staging estava vazio; revalidar antes de agir.

**Próxima tarefa recomendada — Etapa 3C:** preparar uma promoção reversível do addon corrigido ao caminho normal, escolhendo explicitamente o artefato, conferindo fontes e hashes, preparando backup verificável e passos de reversão. A substituição do addon exige autorização específica. Depois, validar preload, caminho e encerramento em smoke test isolado; testes de captura e transmissão dependem de autorização própria. Ajustar `build:win` e validar o instalador são etapas posteriores a planejar.

**Arquivos para começar:** `package.json`, `binding.gyp`, `scripts/build-native-electron-isolated.js`, `main.js`, `preload.js`, `src/native/audio_capture.cc`, `.h`, `public/app.js` e `GEMINI.md`. A documentação `ARQUITETURA.md` é histórica e contém diferenças em relação ao código; confira antes de usá-la.

**Cuidados:** `build/` é ignorado; `npm run rebuild` e `build:win` podem sobrescrever o addon normal com alvo inadequado. Preserve perfis Electron, backups e artefatos isolados. Não acesse H: nem limpe diretórios anteriores. O Electron gráfico falhou no sandbox do Codex; o PowerShell comum abriu o aplicativo. Não contorne restrições de segurança. A investigação de mini travadas WebRTC foi adiada pelo proprietário.

**Validações antes de continuar:** branch/HEAD, staging, `git status`, `git diff --check`, hashes dos fontes WASAPI (`66CA069A…2354BD84` e `287027E6…E4892`) e dos binários; conferir cache Electron 28.3.3 x64 e disponibilidade de ferramentas. Na promoção, validar backup e destino; no pacote, verificar `asarUnpack`, conteúdo e carregamento. Os encerramentos anteriores não tiveram código de saída confiável.

## Atualização 14/11/2026 — validação inicial e teste dos presets de vídeo (Claude Code)

**Validação:** branch `versao-electron`, HEAD `ff2a980…`, staging vazio, `git diff --check` sem problemas (saída 0). Status igual ao descrito acima, mais `CLAUDE.md` não rastreado (novo). Hashes conferidos e iguais ao relatório: `audio_capture.cc` `66CA069A…2354BD84`, `.h` `287027E6…E4892`, addon normal antigo `5DF88514…C727`, 2M `2346939F…5085`, 3B `2FDF4E35…98C0`. Electron instalado 28.3.3. Nenhum arquivo do repositório foi alterado além deste handoff.

**Teste dos presets (modo isolado, sem sala, sem áudio):** script externo (fora do repo) iniciou `electron.exe .` com `COLLAB_ISOLATED_RUN=1` e `--remote-debugging-port` em 127.0.0.1, chamou as funções do próprio `app.js` (`getQualityPreset` + `captureScreenStream`, com `contentHint='detail'` e `maintain-resolution` como em `shareScreenWithFallback`) na tela 1 (1920×1080, DPR 1, rAF ≈133 Hz) com animação de tela cheia, e contou os frames entregues por 6 s via `MediaStreamTrackProcessor`. Nenhuma conexão LiveKit (`myRoom` nulo), 0 tracks de áudio, addon normal antigo carregado mas captura não iniciada. Três rodadas: A e A2 com `electron .`; B com as flags do `npm start` (`--disable-gpu --disable-gpu-compositing --no-sandbox`). **Todas encerraram com código de saída 0** via `window.close()`.

| Preset | Resolução entregue | FPS medido (A / A2 / B) |
|---|---|---|
| 480p30 | 852×480 (pedido 854×480) | 28,5 / 28,7 / 27,8 |
| 720p30 | 1280×720 | 28,3 / 27,7 / 27,5 |
| 720p60 | 1280×720 | **47,7** / 57,2 / 57,1 |
| 1080p30 | 1920×1080 | 28,6 / 28,3 / 28,3 |
| 1080p60 | 1920×1080 | 57,2 / **53,2** / 57,1 |

Leitura: a resolução bate em todos os presets; o 480p sai com 852 px de largura (arredondamento para manter 16:9 com largura par, inofensivo). O FPS de captura fica ~5% abaixo do nominal (~57 em vez de 60, ~28 em vez de 30), com intervalo mediano de 17,4 ms / 34,6 ms; hipótese não comprovada: o capturador alinha com o vsync do monitor de ~133–144 Hz. Em 2 das 6 medições de 60 fps houve trechos a ~30 fps (p95 do intervalo ≈31 ms), uma vez no 720p60 e outra no 1080p60, logo não é defeito de um preset específico. As flags do `npm start` não mudaram o resultado da captura.

**Como rodar de novo:** o script agora está em `scripts/test-presets.js` (não rastreado; não depende de nenhuma dependência nova). No PowerShell comum, na raiz do repositório:

```
node scripts/test-presets.js padrao
node scripts/test-presets.js npmstart --disable-gpu --disable-gpu-compositing --no-sandbox
```

O primeiro argumento é só um rótulo; o resto vai como flags para o Electron. Ele usa sempre perfil isolado e o addon normal (remove `COLLAB_ISOLATED_ADDON` do ambiente), abre a porta de depuração 9333 apenas em 127.0.0.1 (mude com `PRESET_TEST_PORT`), cobre a janela com uma animação durante ~45 s e imprime uma tabela por preset, o código de saída do Electron e a linha `RESULT` com o JSON completo. O próprio script sai com 0 se o Electron saiu com 0 e o teste não deu erro, 1 em caso de erro e 2 se precisou matar o Electron. Verificação após salvar (14/11): saída 0, resultados iguais aos da tabela acima (≈57 fps nos de 60, ≈28 nos de 30).

**Limites:** só mede a captura (`getUserMedia`), não o encoder H.264 nem o que chega ao espectador (`maxBitrate`/`maxFramerate` do `screenShareEncoding` exigem sala). Só tela inteira, não janela. Só um monitor 1920×1080; em monitor maior o `maxWidth/maxHeight` reduziria mantendo a proporção. Script e saídas brutas: scratchpad da sessão do Claude Code (`preset-test.js`, `run-A.txt`, `run-A2.txt`, `run-B.txt`), temporários.

**Próximos passos possíveis:** medir FPS/resolução enviados (`getStats` do emissor) numa sala, com autorização; repetir com fonte de janela e com monitor de 60 Hz; seguir com a Etapa 3C.

## Atualização 14/11/2026 — Etapa 3C parte 1: addon 3B em runtime isolado (Claude Code)

**Escopo autorizado:** carregar o addon 3B via `COLLAB_ISOLATED_ADDON` (perfil isolado), smoke test e duas capturas de áudio de 60 s sem entrar em sala. **Nada em `build/` foi tocado; nenhum addon foi promovido.** Hashes antes e depois iguais: normal `5DF88514…C727`, 3B `2FDF4E35…98C0`, 2M `2346939F…5085`, fontes `66CA069A…`/`287027E6…`.

**Método:** script externo (scratchpad do Claude Code, `addon-test.js`, temporário) inicia `electron.exe .` com `COLLAB_ISOLATED_RUN=1`, `COLLAB_ISOLATED_ADDON=<3B>` e porta de depuração em 127.0.0.1; confere o caminho do `wasi_audio.node` na lista de módulos do processo principal; chama as funções do próprio `app.js` (`startAudioCapture`/`stopAudioCapture`), que montam o caminho normal WASAPI → main → IPC → AudioWorklet → `MediaStreamDestination` (não toca nos alto-falantes, não publica). Fonte sonora: PowerShell oculto com `System.Media.SoundPlayer` tocando um WAV de 440 Hz, 48 kHz, ~100 s sem loop, iniciado 2 s antes. Números nativos: última linha `[WASAPI]` (relatório final do stop). Worklet: últimos `[Worklet]` do console.

**Resultados (todas as rodadas com código de saída 0 do Electron, `myRoom` nulo antes e depois):**

| Rodada | Addon carregado | frames/s nativo | refills | underruns | drops | Outros |
|---|---|---|---|---|---|---|
| Smoke | 3B (caminho confirmado no processo) | — | — | — | — | `isCapturing=false`, `getProcessList` ok (9 itens) |
| Sistema 60 s | 3B | 48.000,0 (2.957.280 / 61,61 s) | 0 | 0 | 0 | wake=event, `packetGapMaxMs=10`, 1 discontinuity (início), `tsfnFailures=0`, `queueMaxPackets=1` |
| PID 60 s | 3B | 47.975,1 (2.954.880 / 61,59 s) | **1 (21 ms, nos primeiros 5 s)** | 0 | 0 | wake=poll, `pidMaxPacketsPerWake=2`, `pidMultiPacketWakeups=469`/5.773, `packetGapMaxMs=22`, `pidNextPacketSizeErrors=0`, `tsfnFailures=0` |
| 2O (referência, addon 2M, transmissão real) | 2M | ≈47.997 (PID) | 0 | 0 | 0 | 1.220 despertares multipacote, máximo 2 |

**Leitura:** o 3B se comporta como o 2M nos pontos que importam: sem déficit sustentado no PID (2K tinha ≈45.130 frames/s e 860 refills), máximo de 2 pacotes por despertar, zero underruns e zero drops. O frames/s do PID é medido sobre todo o tempo desde o start, incluindo a latência de arranque; a diferença de ≈22 frames/s para o 2O equivale a ≈29 ms no total e não aparece como perda contínua (o buffer do worklet ficou estável entre 99 e 179 ms do segundo 5 ao 60). O único refill aconteceu antes do primeiro relatório de 5 s e o contador não subiu mais, então parece transiente de arranque, não déficit; o 2O registrou zero, mas não se sabe se a janela de medição dele incluía o arranque. Comparação com limites: rodadas de 60 s (não sessão longa), sem LiveKit nem escuta real, fonte sintética, um único dispositivo de saída. O processo do player (PowerShell sem janela) não aparece em `getProcessList` (lista de janelas com áudio); a captura por PID funcionou passando o PID diretamente. Logs brutos: scratchpad do Claude Code, pasta `3c\run` (`*-native.log`, `*-console.log`, `*-summary.json`).

**Próximo passo (na época):** Etapa 3C parte 2, executada abaixo.

## Atualização 14/11/2026 — Etapa 3C parte 2: promoção do 3B (Claude Code)

**Autorização:** proprietário aprovou o plano e escolheu o **3B**, incluindo as capturas de 60 s sem sala.

**Verificações prévias:** nenhum Electron aberto; branch/HEAD/status iguais ao início; `git diff --check` ok; fontes `66CA069A…`/`287027E6…`; 32 GB livres em D:.

**Backup:** `D:\Projetos\_backups\screen-share-collab\3C-20261114-0246\` (somente leitura).
- `original\` = cópia integral de `build/Release` antes da promoção (21 arquivos com os de `incoming`, 0 divergências na conferência).
- `incoming\` = `.node` e `.pdb` do 3B copiados de `…\wasi-audio-electron-e4pWz1\build\Release\`.
- `MANIFEST.sha256` (hash de todos os arquivos) e `LEIA-ME.txt`.

| Arquivo em `build/Release` | Antes (backup `original\`) | Depois (3B) |
|---|---|---|
| `wasi_audio.node` | `5DF88514964CD640386D514C054E9B40A1564E0A1AB62A5622901612B227C727` | `2FDF4E35F3E71247D9802E954D7985D4125732487E1C68826F0B0004718A98C0` |
| `wasi_audio.pdb` | `3253EBB80191267AB44E9DBA7F275BAA2F5A6CA357ABD0663939E107BCBD457C` | `A2DDC100857F73A6B36A8034246469FB1C669C6877F334E2AB9C6C352F71ED1C` |

Só esses dois arquivos foram trocados (cópia para `*.promote-tmp`, conferência do hash, renomeação por cima). `obj\`, `.lib`, `.exp`, `.iobj`, `.ipdb` e `nothing.lib` ficaram como estavam; são artefatos do build antigo, não usados em execução.

**Validação no caminho normal** (modo isolado, **sem** `COLLAB_ISOLATED_ADDON`; lista de módulos do processo mostrou `D:\Projetos\Compartilhar-tela-via-site\build\Release\wasi_audio.node`, hash em disco do 3B; todas as rodadas com saída 0 e `myRoom` nulo):

| Rodada | frames/s | refills | underruns | drops | Outros |
|---|---|---|---|---|---|
| Smoke | — | — | — | — | `isCapturing=false`, `getProcessList` ok |
| Sistema 60 s | 47.999,2 | 0 | 0 | 0 | wake=event, `packetGapMaxMs=11`, `tsfnFailures=0` |
| PID 60 s | 47.971,9 | 0 | 0 | 0 | wake=poll, máx. 2 pacotes/despertar, 455/5.752 multipacote, `pidNextPacketSizeErrors=0` |
| `test-presets.js` | — | — | — | — | igual às rodadas anteriores: resoluções corretas, ≈57/≈28 fps |

O refill de arranque visto na parte 1 não se repetiu, o que reforça a leitura de transiente. Logs: scratchpad do Claude Code, `3c\pos\` (temporário).

**Reversão (se necessário):** fechar o Electron; copiar `original\wasi_audio.node` e `original\wasi_audio.pdb` do backup para `build/Release/*.promote-tmp`, tirar o atributo somente leitura, conferir `5DF88514…C727` / `3253EBB8…457C`, renomear por cima, conferir o hash e repetir o smoke isolado. O backup completo de `build/Release` está em `original\`.

## Atualização 14/11/2026 — commits e instalador 3C (Claude Code)

**Commits (aprovados pelo proprietário, sem push), sobre `ff2a980`:** `e4d0c86` native (PID Drain + diagnóstico), `b52e098` modo isolado (`main.js` parcial), `9f70765` Linux (`main.js` restante + `stub.cc`), `9237feb` `screenShareEncoding`, `d035ca9` script de build isolado, `b8a692b` `test-presets.js`, `24636e9` docs. `ARQUITETURA.md` ficou fora de propósito (histórico). O arquivo `-` da raiz já era rastreado e não tem alteração; `.env`, `build/` e `dist*/` são ignorados. O working tree batia com o HEAD após os commits.

**Instalador:** gerado sem `build:win` e sem `node-gyp`, com `node node_modules/electron-builder/cli.js --win -c.npmRebuild=false -c.directories.output=dist-3c` (pelo Bash: no PowerShell o argumento `-c.directories.output=…` é quebrado e lido como arquivo de configuração). Saída 0, `package.json` inalterado.
- Instalador: `dist-3c\compartilhar-tela-collab Setup 1.0.0.exe` (NSIS one-click, por usuário), SHA-256 `DD5776F60B9410BE63EDB2CFCFDB9D658EC0C29B8D95B488DF4A3FB91C43BDEC`, 76,7 MB. **Não instalado.**
- `build/Release/wasi_audio.node` antes e depois: `2FDF4E35…98C0`.
- `win-unpacked\resources\app.asar.unpacked\build\Release\wasi_audio.node`: `2FDF4E35…98C0` (igual ao 3B).
- `app.asar` (635 entradas): fora de `node_modules`, só `main.js`, `preload.js`, `package.json`, `public/*` e o stub do `.node`. Nenhum `.env` no asar nem em `dist-3c`; `server.log` e `-` também não entram.
- Smoke test de `win-unpacked\compartilhar-tela-collab.exe` em modo isolado: o addon carregado (lista de módulos) é o de `app.asar.unpacked`, `isCapturing=false`, sem sala, **código de saída 0**.
- Avisos do builder: sem `author` no `package.json` e ícone padrão do Electron. `livekit-server-sdk` (dependência da função Vercel) vai junto no asar em `node_modules`, sem uso no app; avaliar depois.

## Atualização 14/11/2026 — atraso e dessincronia na live (Claude Code)

**Relato do proprietário (app instalado, Valorant/LoL, 720p e 1080p60, sistema e PID):** áudio e vídeo bons, mas ≈1,2 s de atraso em relação ao tempo real e áudio dessincronizado do vídeo.

**Log do emissor (≈19 min, 1080p60, PID, console com script de `getStats`):**
- Worklet: `buf` fixo entre 589 e 679 ms do início ao fim, 0 underruns/refills/drops. Nos testes isolados era 98–179 ms.
- Vídeo: ≈20 fps (11–35), `qualityLimitationReason=cpu` em 221/223 amostras, encode mediano ≈37 ms/frame (provável encoder por software; implementação do encoder não registrada).
- Rede: RTT ≈10 ms, fila de envio mediana 12 ms (p95 47, máx. 153), banda estimada mediana ≈5,5 Mbps.
- Não houve log do espectador; a maior parte do 1,2 s do vídeo não está no emissor.

**Causa do buffer de ≈630 ms — confirmada em teste isolado (PID, 60 s, sem sala, addon 3B normal):** `startShareFlow` liga o áudio (`app.js:749`) antes do seletor de fonte (`app.js:592`), cujo `getSources` (miniaturas, 904 ms no teste) trava o processo principal; o áudio represado chega de uma vez antes do fim do prime e o worklet, sem controle de excesso, mantém esse atraso para sempre. Controle (sem `getSources`): `buf` 98–168 ms. Com `getSources` logo após o start: `buf` 607–687 ms. Ambos com 0 underruns/refills/drops e saída 0.

**Correção aplicada (aprovada pelo proprietário, ainda não commitada):**
1. `public/app.js` / `startShareFlow`: abre o seletor e fixa `selectedScreenSourceId` **antes** de `startAudioCapture`. Cancelar o seletor segue o mesmo caminho de erro de antes ("Nenhuma fonte selecionada"). A troca de qualidade durante a live continua chamando `stopScreenShare` → `startShareFlow`, que reabre o seletor como antes.
2. `public/audio-worklet.js`: se a fila ficar acima de ~300 ms por ~2 s seguidos, descarta o excesso de uma vez até o alvo de ~150 ms (uma descontinuidade). Novos contadores `trims`/`trimSamples` no relatório; o log `[Worklet]` mostra `trims=N(ms)`. Prime, refill e tamanho do ring não mudaram.

**Validação (isolado, PID 60 s, sem sala, addon 3B normal, saída 0 em todas):**

| Cenário | `buf` (12 relatórios) | underruns / drops | refills | trims |
|---|---|---|---|---|
| Controle (só liga o áudio) | 87–167 ms | 0 / 0 | 2 (19 ms, só nos primeiros 5 s) | 0 |
| Rajada (áudio e logo `getSources`, 848 ms) | 105–195 ms (antes da correção: 607–687) | 0 / 0 | 0 | 1 (483 ms descartados) |
| Nova ordem (`getSources` e depois o áudio) | 89–169 ms | 0 / 0 | 1 (21 ms, só nos primeiros 5 s) | 0 |

`test-presets.js` depois da correção: saída 0, resultados iguais aos anteriores. Os refills de arranque já apareciam antes da correção (parte 1 da 3C) e não são causados pelo trim. **Não testado:** o `startShareFlow` completo (exige sala) e uma live real; o instalador de `dist-3c` **não** contém esta correção (é preciso gerar outro para testar instalado).

**Live real com a correção (15/11/2026, proprietário, `npm run dev`, 720p60, ≈33 min, log só do emissor):**
- Worklet: `buf` 88–188 ms (mediana 138) do início ao fim, **0 trims**, 0 underruns, 0 drops; 3 refills somando 40 ms (1 no arranque, 2 ao longo da live, ≈3 e ≈13 min). Antes da correção: `buf` 589–679 ms fixo.
- Vídeo: `encoderImplementation=OpenH264`, `powerEfficientEncoder=false` (encoder por **software**, mesmo com GPU ligada); fps mediano 51 (p5 37, máx. 58), encode mediano 12,8 ms, `limite=cpu` em 20/394 amostras. Na live anterior em 1080p60 (instalado) o mesmo encoder ficava em ≈20 fps limitado por CPU.
- Rede: RTT ≈11 ms, fila de envio mediana 0,4 ms (p95 4,4), banda estimada mediana ≈5,2 Mbps.
- Sem log do espectador outra vez.

**Ainda a fazer:** percepção do proprietário sobre atraso/sincronia nesta live; log do espectador; avaliar encoder H.264 por hardware (Media Foundation) para 1080p60; commit da correção.

**Ainda pendente:** instalar e testar o instalador (proprietário); corrigir `build:win`/`rebuild` no `package.json` (com aprovação) para usar o fluxo validado acima; `npm start` e transmissão real com o addon promovido (pelo proprietário ou com autorização própria); sessão longa; corrigir `rebuild`/`build:win`, que **continuam podendo sobrescrever** o addon promovido (para refazer, use o backup `incoming\`); validar o instalador. Nada foi commitado; `build/` é ignorado pelo git.

Para arquitetura, histórico, limites das evidências, logs e detalhes das fases, consulte `RELATORIO_CONTINUIDADE_PROJETO.md`.
