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

**Percepção do proprietário nessa live:** atraso e dessincronia **semelhantes aos anteriores**, apesar de o áudio ter saído ≈0,5 s mais cedo no emissor. Espectador assistiu pelo site num tablet; sem log. Logo, a maior parte do atraso/dessincronia não está no buffer do emissor.

## Atualização 15/11/2026 — codificador de vídeo por hardware (Claude Code, autorizado)

**Método:** script externo (scratchpad, `encoder-test.js`) em modo isolado, sem sala e sem áudio: captura a tela 1 com o preset 1080p60 do app (`captureScreenStream`) e codifica numa conexão WebRTC local (dois `RTCPeerConnection` na própria página), 6 Mbps / 60 fps, `maintain-resolution`, 10 s de medição após 5 s de aquecimento. Todas as rodadas com código de saída 0.

**GPU:** NVIDIA (vendor 0x10DE, device 0x1F06), driver 32.0.16.1692; `video_encode=enabled`; a lista `videoEncoding` do `SystemInfo` vem vazia (não é confiável para decidir).

| Codec / perfil H.264 | Flags | Encoder | HW | fps (1080p) | encode/frame |
|---|---|---|---|---|---|
| H.264 Constrained Baseline `42e01f` (o que a live usa) | — | OpenH264 | não | 33,3 / 55,3 | 29,3 / 12,3 ms |
| H.264 CBP `42e01f` | `--enable-features=MediaFoundationH264CbpEncoding` | OpenH264 | não | 52,2 | 14,2 ms |
| H.264 Main `4d001f` | — | **MediaFoundationVideoEncodeAccelerator** | **sim** | 48,6 | 5,5 ms |
| H.264 High `64001f` | — | **MediaFoundationVideoEncodeAccelerator** | **sim** | 51,2 | 5,4 ms |
| H.264 High `64001f` | feature CBP acima | MediaFoundationVideoEncodeAccelerator | sim | 57,1 | 5,5 ms |
| VP8 | — | libvpx | não | 56,6 | 4,7 ms |

Decodificação H.264 local: `ExternalDecoder (D3D11VideoDecoder)`, por hardware. O OpenH264 varia muito com a carga da CPU (12–29 ms sem jogo; ≈37 ms na live de 1080p60 com jogo). O encoder da placa ficou em ≈5,5 ms em todas as rodadas.

**Conclusão:** o Electron 28 já usa o encoder da placa **sem flags**, desde que o perfil H.264 negociado seja Main ou High. O LiveKit/negociação atual acaba em Constrained Baseline, que só tem encoder por software nesta máquina. A feature `MediaFoundationH264CbpEncoding` não mudou isso.

**Leitura do `livekit-client` 2.24.1 (versão servida pela CDN em 15/11/2026):** o cliente não chama `setCodecPreferences` nem escolhe perfil; só confere o tipo (`h264`) contra `enabledPublishCodecs` do servidor. O perfil sai da resposta SDP do servidor (provavelmente o H.264 padrão do LiveKit, CBP `42e01f`; ainda não confirmado na sala real).

**Implementado (aprovado, ainda não commitado):**
- `public/index.html`: `livekit-client` fixado em `@2.24.1` (antes sem versão).
- `public/app.js`: opção experimental **desligada por padrão** que, com `localStorage['collab.h264High']==='1'`, reescreve `profile-level-id=42e01f` → `64001f` nas respostas SDP (`setRemoteDescription` com `type==='answer'`), mantendo o PT. Ativar: `localStorage.setItem('collab.h264High','1')` e recarregar; desativar: `localStorage.removeItem('collab.h264High')`. Mostra `[Share] Experimental ATIVO…` no console quando ligada.

**Validação local (isolado, sem sala, loopback WebRTC, 1080p60, saída 0):** padrão → `LivekitClient.version=2.24.1`, sem patch, OpenH264 (17,2 ms/frame); com a opção → patch ativo, negociado `64001f`, **MediaFoundationVideoEncodeAccelerator** (5,6 ms/frame, ≈49 fps), receptor que negociou CBP decodificou via D3D11 sem erro. `test-presets.js` sem mudança. **Não testado:** sala real com o LiveKit Cloud e decodificação no tablet do espectador.

## Atualização 15/11/2026 — log3 e sincronia áudio/vídeo (Claude Code)

**Log3 (proprietário, `npm run dev`, 720p60, ≈18 min, só emissor, "travou bastante"):** `ping timeout` (~2 min), `signal disconnected` (~10 min), `connection state mismatch`, `ICE restart` e `resumeConnection`/`attemptReconnect` do LiveKit; as travadas coincidem com quedas de conexão com o servidor. Worklet estável (`buf` 111–240 ms, 0 underruns, 0 trims; refills 1→8 só nos últimos ~30 s, no encerramento). A opção H.264 High **não** estava ativa (sem a linha `Experimental ATIVO`) e o script de estatísticas não foi colado.

**Causa provável da dessincronia persistente:** o vídeo é publicado como `ScreenShare` e o áudio como `Microphone`, sem o campo `stream` do `AddTrackRequest` (existe em 2.24.1, campo 15, também em `TrackInfo`). Sem ele, o servidor agrupa por fonte (câmera+mic, tela+áudio da tela), então áudio e vídeo da live ficam em MediaStreams diferentes no espectador e o navegador não faz lip-sync.

**Correção aplicada (aprovada, ainda não commitada):** `public/app.js`, `shareScreenWithFallback`: `stream: 'screen'` nos dois `publishTrack` (vídeo e áudio). Só afeta o emissor; não exige republicar o site. **Não testado em sala.** Conferir no espectador: `[...myRoom.remoteParticipants.values()].flatMap(p => [...p.trackPublications.values()]).forEach(p => console.log('[Sync]', p.kind, p.track && p.track.mediaStream && p.track.mediaStream.id))` — áudio e vídeo devem ter o mesmo id.

**Instalador de teste para um amigo do proprietário (15/11/2026):** `dist-20261115\compartilhar-tela-collab Setup 1.0.0.exe`, SHA-256 `7CDD2E9190E7A62B92848CE9041F4C719CD6CE19697AE5021506A753F8FA5B2E`, 76,7 MB, mesmo comando do `dist-3c` (`-c.directories.output=dist-20261115`, saída 0, `package.json` inalterado). Gerado do working tree em `dc8ca32` **mais a correção `stream: 'screen'` ainda não commitada** (`public/app.js` do pacote idêntico ao working tree; contém a ordem fonte→áudio, o trim do worklet, a opção H.264 High desligada e `livekit-client@2.24.1`). Addon empacotado `2FDF4E35…98C0` (igual a `build/Release`, inalterado antes/depois); asar só com `main.js`, `preload.js`, `package.json`, `public/*` e o addon; nenhum `.env`. Smoke de `win-unpacked` em modo isolado: addon de `app.asar.unpacked`, captura desligada, saída 0. Instalador não assinado (SmartScreen deve avisar).

**Live de validação (16/11/2026):** amigo do proprietário transmitindo com o instalador `dist-20261115` (correção `stream: 'screen'` incluída); proprietário assistindo pelo app (`npm run dev`), ≈54 min. Relato: **sem travadas, som acompanhando a imagem, "tudo perfeito"**. Log do espectador (`[Lat] RECEBE`): jitter buffer de vídeo mediano 63,5 ms (p95 92,6, máx. 129,5), de áudio 45,7 ms (p95 50,0) — diferença ≈18 ms; 0 pacotes perdidos, 0 frames descartados; RTT ≈11 ms. Vídeo recebido a 23 fps medianos (p5 12, máx. 30): preset de 30 fps do lado do amigo, sem log do emissor para saber o encoder dele. O comando `[Sync]` não foi rodado; a sincronia foi confirmada pela percepção do proprietário. `decoderImplementation` não é exposto ao espectador nesta versão (`decod=-`).

## Atualização 16/11/2026 — fluxo de build corrigido (Claude Code, aprovado)

**`package.json`:** `rebuild` desativado (imprime aviso e sai com 1); `build:win` = `electron-builder --win` (sem `node-gyp`); novo `prebuild:win` = `node scripts/check-addon.js` (falha se o addon não existir e imprime o SHA-256); no bloco `build`, `npmRebuild: false` e `directories.output: dist-release` (a `dist/` antiga não é mais sobrescrita). `build:linux` herda as duas opções.

**Validação:** `npm run rebuild` → código 1 com a mensagem, addon intacto (hash e mtime iguais). `npm run build:win` → código 0; `check-addon` mostrou `2FDF4E35…98C0`; "skipped dependencies rebuild"; saída em `dist-release\compartilhar-tela-collab Setup 1.0.0.exe` (SHA-256 `5FAD4853560791A955B0EF255D8DA586562461797E60EBFBFBAD9559E8AB39DF`); `build/Release` com hash e mtime iguais antes/depois; `.node` em `app.asar.unpacked` = 3B; asar só com `main.js`, `preload.js`, `package.json`, `public/*` e o addon, sem `.env`; `dist/` sem arquivos novos (mais recente de 19/09/2026). Smoke de `dist-release\win-unpacked` em modo isolado: addon de `app.asar.unpacked`, captura desligada, saída 0. `CLAUDE.md` atualizado com o fluxo novo.

**Pendências levantadas:** conexão do emissor (cabo × Wi-Fi) e região do projeto LiveKit Cloud; ativar e validar H.264 High; medir o espectador (tablet, site); qualidade adaptativa (hoje `maintain-resolution` e bitrate fixo).

**Próximo passo proposto (na época, não implementado):** fazer a publicação negociar H.264 High/Main (verificar como a versão do `livekit-client` em uso trata as preferências de perfil; hoje a CDN não tem versão fixada) e validar a compatibilidade do tablet/navegador do espectador. Alternativa sem depender de perfil: VP8 (software, mas leve nesta máquina). Para o atraso no espectador: instrumentar a página do site (ex.: painel de estatísticas por parâmetro na URL), o que exige publicar o site.

**Ainda pendente:** instalar e testar o instalador (proprietário); corrigir `build:win`/`rebuild` no `package.json` (com aprovação) para usar o fluxo validado acima; `npm start` e transmissão real com o addon promovido (pelo proprietário ou com autorização própria); sessão longa; corrigir `rebuild`/`build:win`, que **continuam podendo sobrescrever** o addon promovido (para refazer, use o backup `incoming\`); validar o instalador. Nada foi commitado; `build/` é ignorado pelo git.

Para arquitetura, histórico, limites das evidências, logs e detalhes das fases, consulte `RELATORIO_CONTINUIDADE_PROJETO.md`.

## Atualização 16/11/2026 — tela cheia e controles do vídeo (Claude, aprovado pelo proprietário)

**Problema:** o botão de tela cheia do espectador não fazia nada no app. Causa (leitura do código): `main.js` libera em `setPermissionRequestHandler` só as permissões de captura/mídia; `fullscreen` também passa por esse handler, era negada e o `requestFullscreen()` rejeitava em silêncio (erro só no console). No site pelo navegador o handler não existe.

**Alterações (não commitadas):**
- `main.js`: `'fullscreen'` acrescentado à lista de permissões liberadas. Nada mais muda no handler.
- `public/app.js` (`renderTrack` e constantes de ícones logo acima): a barra de cima (`.video-overlay`/`.video-controls-top`/`.volume-container`) virou `.video-controls` no canto inferior direito, com botão de volume e de tela cheia em ícones SVG (sem emoji). A barrinha de volume (`.volume-popover`) sobe a partir do botão. Mesma lógica de volume/mudo de antes, mais: mover a barra acima de 0 tira o mudo; o ícone e o rótulo mudam com mudo/tela cheia (`fullscreenchange`); duplo clique no vídeo alterna tela cheia; `exitFullscreen()` com `.catch`.
- `public/style.css`: regras antigas do overlay substituídas pelas novas. Controles com `opacity: 0` e aparecem em `.video-wrapper:hover`/`:focus-within`; a barrinha aparece em `.volume-group:hover`/`:focus-within`. A barra é um `range` comum girado −90° (o Chromium 120 do Electron 28 não tem range vertical por `writing-mode`). `.video-wrapper:fullscreen` sem borda/arredondamento.

**Validação feita:** só `node --check` em `app.js` e `main.js` (sintaxe OK) e conferência do diff; fins de linha CRLF preservados. **Não testado rodando:** o terminal no computador do proprietário não iniciou (pouco espaço livre em disco), então não houve `git status`/`git diff --check` nem execução do Electron nesta etapa.

**Próximos passos:** conferir `git status` e `git diff --check`; rodar `COLLAB_ISOLATED_RUN=1 npx electron .` (ou `npm run dev`) e, assistindo uma transmissão, verificar: controles só com o mouse em cima, barrinha subindo, mudo, tela cheia abrindo/fechando (botão, duplo clique e Esc). O site da Vercel precisa ser republicado para os espectadores pelo navegador receberem o visual novo; o instalador precisa ser gerado de novo (`npm run build:win`) para quem usa o app.

## Atualização 16/11/2026 — Etapa 1 da nova interface: cores e ícones (Claude, aprovado pelo proprietário)

Primeira de cinco etapas para levar ao app a proposta de UI revisada no canvas "Screen Share Collab — proposta de UI". Esta etapa é só visual: mesma disposição, mesmos IDs e classes usados pelo JS, sem tocar em áudio, LiveKit, vídeo ou `main.js`.

**Alterações (não commitadas):**
- `public/style.css`: variáveis de `:root` trocadas pela paleta nova (fundo `#0D0E12`, destaque `#8B92FF` com texto escuro `--accent-text`, vermelho `#FF5C5C`); criadas `--radius-sm` (já era usada sem estar definida), `--accent-text`, `--red-text` e `--font-ui` (fonte do sistema, Segoe UI no Windows; Google Fonts não foi usado porque a CSP não tem `font-src` e o app não deve depender de internet para a fonte). Bloco novo no fim, "ETAPA 1", sobrescreve botões, selos, abas e botões Assistir/Parar; para desfazer, apagar esse bloco e voltar as variáveis.
- `public/index.html`: emojis trocados por ícones SVG inline (logo, Compartilhar, Parar, Sair, atualizar processos, abas, tela vazia); emojis removidos das opções de áudio; título do modal "O que você quer mostrar?"; `aria-label` no fechar e no atualizar. Nenhum ID, classe ou `value` usado pelo JS mudou.
- `public/app.js`: só textos: rótulos de áudio sem emoji, selo "AO VIVO"/"PARADO", selo "Em uso: <qualidade>", aviso de áudio indisponível sem emoji, botões da lista de participantes "Assistir"/"Parar" (antes 🎥/❌) com `type="button"`, miniatura de fonte sem prévia com o texto "Sem prévia" no lugar do emoji. Avatar padrão (tubarão) mantido.

**Validação feita:** `node --check public/app.js` OK; CRLF preservado nos três arquivos. **Não testado rodando** (terminal no computador do proprietário indisponível por falta de espaço em disco).

**Observação:** a seção anterior (tela cheia e controles do vídeo) não tinha ficado gravada neste arquivo na primeira tentativa; foi regravada junto com esta.

**Próximos passos:** proprietário abre `npm run dev` e confere entrada, sala (barra de cima, lista de participantes, selos ao transmitir) e a janela de escolher fonte. Depois, Etapa 2: tela de entrada no layout da proposta.

## Atualização 16/11/2026 — Etapa 2 da nova interface: tela de entrada (Claude, aprovado pelo proprietário)

**Contexto informado pelo proprietário:** o app é privado e tem uma sala só (`sala-principal`); não há criação de salas, e a interface não deve sugerir isso.

**Alterações (não commitadas):**
- `public/index.html`: bloco `#login-screen` reorganizado como na proposta: à esquerda marca, título "Assista junto, com o som certo.", frase e três etiquetas; à direita o cartão "Entrar na sala" com foto (selo de câmera), campos com `<label>` "Seu nome" e "Senha da sala", botão de olho e "Entrar na sala". Mesmos IDs de antes (`avatar-input`, `avatar-preview`, `name-input`, `password-input`, `join-btn`, `login-error`); `src` padrão do avatar e `value` da senha intactos. Sem `<form>` (Enter recarregaria a página). Saíram o selo "LiveKit + WASAPI" e o subtítulo técnico.
- `public/style.css`: regras da tela de entrada substituídas (seção "LOGIN SCREEN (Etapa 2)"); removidas do bloco "ETAPA 1" as regras da tela de entrada antiga. Em janela estreita os dois lados empilham; `#login-screen` rola se faltar altura.
- `public/app.js`: único trecho novo, logo acima do listener do `join-btn`: o botão `#toggle-password` alterna `type` do campo de senha entre `password` e `text`. Lógica de login inalterada.

**Fora da proposta, de propósito:** a linha "sala-principal · N pessoas agora" (exigiria consultar a sala antes de entrar, mexendo no `/api/get-token`).

**Validação feita:** `node --check public/app.js` OK; todos os IDs usados pelo JS presentes uma vez; CRLF preservado. **Não testado rodando** (terminal do computador do proprietário indisponível).

**Próximos passos:** proprietário confere a tela de entrada no `npm run dev` (trocar foto, mostrar senha, erro de nome vazio/senha errada, entrar). Depois, Etapa 3: sala (barra de cima enxuta e lista de participantes).

## Atualização 16/11/2026 — Etapa 3 da nova interface: barra de cima e lista de participantes (Claude, aprovado pelo proprietário)

**Alterações (não commitadas):**
- `public/index.html`: na barra de cima, separador + nome da sala (`#room-name-badge`, agora classe `room-name`) e `#participant-count` com classe `badge-online` (bolinha verde); título da lista "Na sala" com `#sidebar-count`. IDs existentes mantidos.
- `public/app.js`: `updateParticipantsUI` reorganizada com duas funções novas, `hasScreenSharePublication` e `buildParticipantRow`. Cada linha mostra nome e situação ("Transmitindo", "Transmitindo · assistindo", "Na sala"); quem transmite ganha anel vermelho na foto; a linha que você está assistindo fica destacada (`li.watching`). O participante local mostra "Transmitindo" quando tem publicação de tela. O bloco dos botões Assistir/Parar (assinar/desassinar tracks) foi mantido **sem alteração**. `updateParticipantsUI()` agora também é chamada logo após `updateAudioStatusBadge(true)` (início da transmissão) e `updateAudioStatusBadge(false)` em `stopScreenShare` — só redesenha a lista.
- `public/style.css`: bloco novo "ETAPA 3" no fim (barra de cima, botão Sair em vermelho discreto, lista com 300 px).

**De propósito sem mudança:** controles de áudio, qualidade e Compartilhar continuam na barra de cima até a Etapa 4; grade de vídeos inalterada (encostaria na parte de vídeo, adiada). "Pelo navegador" do mockup não foi feito (o app não sabe a origem do participante sem mexer no token).

**Validação feita:** `node --check public/app.js` OK; CRLF preservado. **Não testado rodando.** Conferir com duas pessoas: lista, anel vermelho, "assistindo", Assistir/Parar, contagem, e a própria linha mudando ao transmitir/parar.

**Observação sobre este arquivo:** duas gravações anteriores deste `HANDOFF.md` (seções da tela cheia e da Etapa 2) chegaram ao disco sem o trecho acrescentado por último. A causa foi a forma como o Claude transferia o arquivo, não algo do lado do proprietário. Corrigido; as seções foram regravadas juntas e o tamanho final foi conferido no disco.

## Atualização 16/11/2026 — Etapa 4 da nova interface: janela de compartilhar (Claude, aprovado pelo proprietário)

**Alterações (não commitadas):**
- `public/index.html`: os controles de áudio (`#audio-source-select`, `#audio-process-wrapper`, `#audio-process-select`, `#refresh-processes-btn`) e de qualidade (`#quality-select`) saíram da barra de cima e foram para dentro de `#source-picker-modal`, **com os mesmos IDs**. `#audio-source-select` ficou escondida; três botões (`.segmented-btn[data-audio]`) mudam o valor dela e disparam `change`, então `audioCaptureState` é atualizado pelo mesmo listener de antes. Modal ganhou rodapé "Mostrando: …" e `#source-picker-start` ("Começar a transmitir", desabilitado até escolher). `#btn-share` foi para o cartão "Quer mostrar algo?" no pé da lista. `#audio-status-badge` e `#effective-quality-badge` ficam dentro de `#live-status`, visível só enquanto você transmite. Quem não transmite não vê nenhum controle de transmissão.
- `public/app.js`:
  - `showSourcePicker`: clicar numa miniatura só seleciona (borda + ✓); a escolha só vale em "Começar a transmitir". Os ouvintes de fechar/cancelar/abas/fundo agora são removidos ao fechar (antes acumulavam um a mais por abertura). A aba ativa volta para "Telas" a cada abertura. Miniaturas viraram `<button>`.
  - Novo: `syncAudioChoiceButtons`, `AUDIO_CHOICE_HINTS`, `autoMatchAudioToWindow`. Ao escolher uma **janela**, se algum processo da lista tiver `windowTitle` igual ao nome da janela, o áudio vai para "Só de um programa" com esse processo; não age se a pessoa já mexeu no áudio nessa abertura.
  - `loadProcessList`: depois de recriar as opções, volta a mostrar o processo já escolhido (antes a lista visual voltava para "Selecione…", embora o estado guardasse o PID).
  - `startShareFlow`: `#btn-share` chama `startShareFlow(null)`; a qualidade é lida de `#quality-select` **depois** da escolha da fonte. Cancelar a janela não mostra mais o aviso de erro.
  - `updateAudioStatusBadge`: mostra/esconde `#live-status`.
  - Lista: situação "Assistindo" (antes "Transmitindo · assistindo", que cortava).
  - Miniatura sem prévia: o SVG de reserva estava codificado duas vezes (`%23` dentro de `encodeURIComponent`) e saía preto; agora mostra "Sem prévia".
- `public/style.css`: bloco "ETAPA 4" no fim (modal 880 px, seleção, botões de áudio, rodapé, cartão; o cartão some com `:has(#btn-share.hidden)`).

**Sem mudança:** `startAudioCapture`, `shareScreenWithFallback`, `captureScreenStream`, presets, LiveKit, worklet, `main.js`.

**Limitação temporária:** trocar a qualidade no meio da transmissão não está acessível (a lista está no modal, que só abre antes de transmitir); por enquanto, parar e começar de novo. Volta na Etapa 5 (painel "Você ao vivo").

**Validação feita (fora do repositório, sem Electron, sem LiveKit real):** Chrome headless com Playwright abrindo `public/index.html` por `file://`, `livekit-client` substituído por um stub vazio e `window.electronAPI` simulado (2 telas, 2 janelas, 2 processos). Resultados: botão de olho alterna o tipo; na sala sem transmitir só `#btn-share` visível (`#live-status`, `#btn-stop`, áudio e qualidade ocultos); "Começar" desabilitado até escolher; escolher a janela "Jogo Teste" marcou "Só de um programa" com PID 4321 e o select mostrou 4321; "Sem áudio" escondeu a lista de processos e uma escolha posterior de janela não sobrescreveu a escolha manual; Cancelar fechou sem aviso; reabrindo, aba "Telas" ativa; escolher "Tela 2" + 720p60 + Começar passou `720p60` para `shareScreenWithFallback` (substituída por stub) e mostrou "AO VIVO", "Em uso: 720p60" e Parar, escondendo o cartão; nenhum erro de JS. `node --check` OK; CRLF preservado.

**Ainda não testado:** Electron real, captura de tela/áudio real e sala LiveKit. Próximo: o proprietário transmite de verdade (tela, janela com cada opção de áudio, qualidade, Cancelar, Parar). Depois, Etapa 5: painel "Você ao vivo" (devolve a troca de qualidade durante a transmissão).

## Atualização 16/11/2026 — Etapa 5 da nova interface: painel "Sua transmissão" (Claude, aprovado pelo proprietário)

Última etapa do plano de interface. Com ela, a proposta revisada no canvas está no app, exceto os itens listados em "Fora da proposta".

**Alterações (não commitadas):**
- `public/index.html`: novo `#live-panel` no pé da lista de participantes (no lugar do cartão "Quer mostrar algo?", que some ao transmitir), com fonte (nome e tipo), áudio, `#live-quality-select` (mesmos presets), "Em uso agora", `#live-change-source` ("Trocar fonte") e `#live-stop` ("Parar transmissão"). A barra de cima continua com "AO VIVO", "Em uso" e Parar.
- `public/app.js`:
  - Variáveis só de interface: `currentShareSource`, `currentShareAudio` (`ok`/`none`/`failed`) e `currentShareQualityUsed`, preenchidas no "Começar a transmitir" e em `startShareFlow`.
  - `updateLivePanel` (chamada por `updateAudioStatusBadge`) mostra, esconde e preenche o painel; `describeShareAudio` monta o texto do áudio.
  - `#live-quality-select` muda `#quality-select` e dispara o `change` dela, o mesmo caminho de antes para trocar a qualidade no meio da transmissão. **Mudança nesse listener:** ele agora guarda `selectedScreenSourceId` antes de `stopScreenShare()` e o devolve depois. Antes, trocar a qualidade ao vivo reabria a janela de escolha, porque `stopScreenShare` limpa a escolha; agora a mesma tela/janela continua. O áudio é parado e religado com a mesma escolha, como já acontecia.
  - "Trocar fonte" chama `stopScreenShare()` e `startShareFlow(null)`: há uma interrupção curta e a janela de escolha abre. Se a pessoa cancelar, a transmissão fica parada.
  - "Parar transmissão" chama `btnStop.click()`.
  - Durante a troca, os controles do painel ficam desabilitados.
- `public/style.css`: bloco "ETAPA 5" no fim.

**Fora da proposta, de propósito:**
- **Prévia local do que você transmite:** exigiria ligar a track de captura a mais um `<video>`, o que mexe na parte de vídeo, adiada pelo proprietário.
- **"Assistindo você · N":** o cliente LiveKit não informa quem assinou a sua track sem mudança no servidor ou nos metadados.
- **Medidor de nível de áudio:** exigiria ler o worklet.
- **"Pelo navegador":** precisaria de informação no token, como já registrado na Etapa 3.

**Validação feita (fora do repositório, Chrome headless + Playwright, `livekit-client` substituído por stub, Electron simulado; `startAudioCapture`/`stopAudioCapture`/`shareScreenWithFallback` substituídas por stubs que só registram as chamadas):**
- **Escolher janela "Jogo Teste" + Começar:** painel visível com "Jogo Teste / Janela", "Só jogo.exe" e 720p30; cartão de compartilhar escondido; chamadas `audio-start:window` → `share:720p30:window:111:0`.
- **Qualidade 1080p60 no painel:** `audio-stop` → `audio-start:window` → `share:1080p60:window:111:0`, **sem reabrir a janela**; "Em uso" passou a 1080p60.
- **Trocar fonte:** `audio-stop` e a janela abriu. Escolhendo "Tela 1" + Som do sistema, o painel mostrou "Tela 1 / Tela inteira / Som do sistema".
- **Parar transmissão:** painel e selos escondidos, cartão de volta.
- Nenhum erro de JS. `node --check` OK; CRLF preservado.

**Ainda não testado:** Electron real, captura real e sala LiveKit, em especial a troca de qualidade ao vivo mantendo a fonte.

**Próximos passos:**
1. O proprietário transmite de verdade: começar, trocar a qualidade no painel, trocar a fonte e parar.
2. Commit das etapas (pedir autorização).
3. Gerar o instalador (`npm run build:win`) para os amigos.
4. Republicar o site na Vercel, para quem assiste pelo navegador ver a interface nova.

## Atualização 16/11/2026 — Barra lateral com modo compacto (Claude, aprovado pelo proprietário)

**Pedido:** deixar a barra lateral mais minimalista para quem não quer compartilhar nem ver a lista. Foram apresentadas três opções (ocultar por completo / compacto / os dois). O proprietário escolheu a **opção 2, modo compacto**.

**Alterações (não commitadas):**
- `public/index.html`:
  - O `<h3>` da lista passou para `.sidebar-header`, junto com o botão novo `#sidebar-toggle`.
  - O texto de `#btn-share` ficou em `<span class="btn-label">`, e o botão ganhou `aria-label`.
  - Novo botão `#live-panel-mini` dentro do `#live-panel`.
- `public/app.js`:
  - `setSidebarCompact(on, remember)` e `initSidebarCompact()`, logo antes de `updateParticipantsUI`. A escolha fica em `localStorage['collab.sidebarCompact']` (`'1'`/`'0'`, com `try/catch`) e é aplicada ao abrir.
  - O ícone e o rótulo do botão mudam conforme o estado (`aria-expanded`).
  - `#live-panel-mini` expande a barra.
  - Em `updateParticipantsUI`, no bloco do botão Assistir/Parar (lógica de assinar sem alteração): o botão ganhou `aria-label` com o nome, a linha ganhou `title`, e um clique na linha chama `watchBtn.click()` **só no modo compacto**.
- `public/style.css`: bloco "BARRA LATERAL: MODO COMPACTO" no fim.
  - Na compacta a barra fica com 76 px: só as fotos, com anel vermelho para quem transmite.
  - Assistir/Parar vira um selo redondo sobre a foto (▶ lilás / ■ cinza).
  - Compartilhar vira um botão só com o ícone.
  - O painel "Sua transmissão" vira só o botão `#live-panel-mini`, que reabre a barra.
  - "AO VIVO", "Em uso" e Parar continuam na barra de cima.

**Sem mudança:** vídeo, áudio, LiveKit, `main.js`. A grade de vídeos só ganha a largura liberada, porque já era `flex: 1`.

**Validação feita (Chrome headless + Playwright, página servida em `http://127.0.0.1` local, `livekit-client` substituído por stub, Electron e publicações simuladas):**
- Barra começa completa (300 px); o botão compacta para 76 px e grava `'1'`; a grade de vídeos passou a 1204 px.
- Na compacta:
  - clicar na foto de quem transmite assinou (`setSubscribed(true)`, sid em `activeSubscribedSids`);
  - clicar no selo parou;
  - clicar em quem não transmite não fez nada;
  - compartilhar pelo ícone funcionou;
  - ao vivo, só o botão mini aparece no lugar do painel, e Parar continua no topo.
- Recarregando, a barra voltou compacta. O botão mini expandiu e gravou `'0'`.
- Nenhum erro de JS. `node --check` OK; CRLF preservado.

**Ainda não testado:** Electron real e sala real.

## Atualização 16/11/2026 — Limpeza das pastas de instaladores antigos (proprietário, com comando preparado pelo Claude)

O proprietário enviou para a Lixeira do Windows, com um comando PowerShell (`Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory`, opção `SendToRecycleBin`), as pastas `dist`, `dist2` a `dist13` (builds de 9 a 19/set), `dist-3c` (14/nov) e `dist-linux` (AppImage de 18/out, o único build Linux; pode ser gerado de novo com `npm run build:linux` em Linux).

**Ficaram:** `dist-release` (16/nov, instalador mais recente) e `dist-20261115` (15/nov, instalador validado em live com um amigo). O arquivo `-` da raiz (gravação WAV de ~1,5 min de 9/set, sobra de teste de captura) **foi mantido**. `build/`, `node_modules`, `.env`, `src`, `scripts`, documentos e `D:\Projetos\_backups` não foram tocados. Pasta conferida pelo Claude depois da limpeza. Regra correspondente atualizada no `CLAUDE.md`.

**Observação:** mesmo depois da limpeza, o terminal remoto do Claude no computador do proprietário ainda não iniciou (precisa de até 17 GB livres; o espaço só volta depois de esvaziar a Lixeira).

## Atualização 16/11/2026 — Site no navegador: só assistir (Claude, aprovado pelo proprietário)

**Motivo:** pelo navegador não dá para transmitir, porque a captura de tela e de áudio depende do preload do Electron. Com a interface nova, o cartão "Compartilhar tela" apareceria no site e abriria uma janela vazia.

**Alterações (não commitadas):**
- `public/app.js`: `IS_DESKTOP_APP = !!(window.electronAPI && window.electronAPI.getSources)`, que põe a classe `is-app` ou `is-browser` em `<html>`.
- `public/index.html`: a mensagem da tela vazia ganhou duas versões, `.app-only` e `.browser-only` ("Clique em Assistir… Para transmitir, use o app.").
- `public/style.css`: bloco "NAVEGADOR: SÓ ASSISTIR". Em `.is-browser` ficam escondidos `.share-card`, `#live-panel`, `#live-status`, `#btn-stop` e `.app-only`.

**Validação feita (Chrome headless + Playwright, `file://`, LiveKit em stub):**
- **Sem `electronAPI`:** classe `is-browser`, cartão de compartilhar escondido (também com a barra compacta), mensagem do navegador visível, botão Assistir visível.
- **Com `electronAPI` simulado:** classe `is-app` e tudo como antes.
- Nenhum erro de JS; CRLF preservado.

**Vercel (consultada pelo conector, só leitura):**
- Projeto `compartilhar-tela-via-site` (`prj_fpeTSZVTwqBObTAmThy7iNHYjaT3`), ligado ao GitHub `Gabriel-Becker989/Compartilhar-tela-via-site`.
- **Produção atual:** `dpl_JAaPQwcn4Pb3nsJaWohUytFrF5DD`, de 19/09, commit `ff2a980` da `versao-electron`. É o alvo de reversão caso a nova publicação dê problema.
- Pelo histórico, envios para a `versao-electron` geram pré-visualização, que depois foi promovida.
- As pré-visualizações têm proteção da Vercel (exigem login do time); o domínio de produção é aberto.

**Próximo passo:** commit (`main.js`, `public/*`, `HANDOFF.md`, `CLAUDE.md`), push, testar a pré-visualização e promover para produção com o ok do proprietário.
