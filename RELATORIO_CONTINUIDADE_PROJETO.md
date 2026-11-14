# Relatório de continuidade — Screen Share Collab

**Auditoria:** 11/11/2026. **Workspace:** `D:\Projetos\Compartilhar-tela-via-site`. **Branch:** `versao-electron`. **HEAD:** `ff2a980652cedc530563b351a2ba8d914af3470d`. O staging estava vazio no início da auditoria.

## 1. Resumo e evidências

O projeto permite que uma pessoa compartilhe tela e áudio ao vivo pelo Electron e que outras assistam no navegador ou no aplicativo. A prioridade declarada pelo proprietário é áudio limpo e vídeo fluido, com preferência por preservar a arquitetura existente e sem usar OBS. O problema central investigado foi o áudio por processo no Windows ficar com microcortes durante a transmissão.

**Ponto de interrupção:** a Etapa 3B criou e executou um build isolado e reproduzível do addon corrigido. O binário novo passou em inspeção estática; ainda **não foi carregado em runtime**, nem promovido ao caminho normal. A correção PID Drain já havia sido validada em execução real com um **build anterior dos mesmos fontes**, na Etapa 2O. O próximo passo proposto é a Etapa 3C: planejar e executar uma promoção reversível do addon, mediante autorização específica, incluindo backup, verificação e validação do caminho normal.

As medições das etapas 2K–2O vêm dos registros de execução e relatos do proprietário nesta conversa, não de testes repetidos nesta auditoria. Logs nativos dos testes 2O estão nas pastas `%TEMP%\screen-share-2O-A-7968af44f6ee4dbe88000b1a0af0da42` e `%TEMP%\screen-share-2O-B-6a3bc185640b4b6182900907ac5ae6aa`, se ainda disponíveis. O renderer foi fornecido em `C:\Users\Gabriel\.codex\visualizations\2026\11\07\01a1b38e-109b-7e93-a393-5dc68a96fde5\screen-share-collab-addon-pid-drain-859e55f8d397455a8ef1e0a521ba57fb\build\Release\renderer.txt`. Esses dados podem conter informações de sessão: revisá-los antes de compartilhar.

## 2. Visão do produto

O público previsto são participantes de uma sala que desejam transmitir jogos, janelas ou tela com áudio e assistir a outros participantes. A experiência pretendida inclui selecionar fonte de vídeo, qualidade e modalidade de áudio, entrar em uma sala e controlar reprodução. São essenciais a captura confiável, a entrega de áudio/vídeo e a possibilidade de assistir via navegador; perfis, avatar, controles e opções de qualidade complementam a experiência. A operação Linux e a infraestrutura própria existem no código, mas seu estado de validação atual é desconhecido. Não há roadmap completo ou lista exaustiva de funcionalidades futuras confirmada no repositório.

## 3. Arquitetura e fluxos

| Componente | Responsabilidade e evidência |
|---|---|
| Electron | `main.js` cria janela e handlers IPC, trata permissões e carrega o addon no Windows; `preload.js` oferece `audioCapture` e `electronAPI` por `contextBridge`. |
| Interface | `public/index.html`, `public/style.css` e `public/app.js`: sala, seleção de fonte, preset e publicação. `shareScreenWithFallback()` usa o capturador do Electron e publica vídeo e áudio como tracks separados. |
| Áudio Windows | `src/native/audio_capture.cc` e `.h`: WASAPI loopback do sistema e captura por processo, conversão PCM para float estéreo, fila, lotes, callback Node-API e diagnóstico agregado. |
| Processamento de áudio | `public/audio-worklet.js`: ring buffer, prime, refill e contadores. O fluxo é WASAPI → Node-API → main → IPC → renderer → AudioWorklet → `MediaStreamDestination` → LiveKit. |
| WebRTC | `public/index.html` carrega `livekit-client` via CDN sem versão fixada; `public/app.js` publica e assina tracks. A versão efetiva da CDN em cada execução não está comprovada pelo lockfile. |
| Autorização de sala | `api/get-token.js` é uma função serverless Vercel que verifica uma senha compartilhada e cria token LiveKit usando variáveis de ambiente. Não reproduzir segredos em documentos ou logs. O código atual envia parâmetros de acesso por URL; avaliar exposição e autenticação em trabalho separado. |
| Infraestrutura | `vercel.json` configura a instalação e funções; `docker-compose.yml` e `livekit.yaml` contêm alternativa de infraestrutura. O uso de LiveKit Cloud foi relatado; implantação atual e infraestrutura própria não foram verificadas nesta auditoria. |
| Linux | `main.js` usa `parecord` e conversão para float; a seleção por processo atualmente recai no som do sistema. Não há validação Linux recente comprovada. |

Não foi identificado banco de dados no código investigado; isso não prova inexistência de serviços externos não presentes no repositório. `public/profile.js` implementa perfil em `localStorage`, mas não foi encontrada inclusão desse arquivo em `public/index.html`; seu uso efetivo é desconhecido. O Electron normal usa seus diretórios de dados padrão. O modo isolado cria `userData` e `sessionData` temporários e aceita `COLLAB_ISOLATED_ADDON`, protegendo o perfil normal por verificações de sobreposição.

`binding.gyp` compila `audio_capture.cc` em Windows e `stub.cc` nas demais plataformas. `src/native/napi_bindings.cc` e `process_enumerator.cc` existem, mas não aparecem como fontes no alvo atual de `binding.gyp`; não assumir que participem do addon compilado. Os parâmetros atuais de lote são 4000 frames ou 85 ms. O Worklet usa prime/target de aproximadamente 150 ms e limiar de refill de 80 ms; não há reamostragem adaptativa na implementação atual.

## 4. Ambiente e build

Versões locais observadas: Electron **28.3.3**, Node.js **24.18.0**, node-gyp **12.4.0**, node-addon-api **8.9.2**, electron-builder **24.13.3** e livekit-server-sdk **2.18.0**. As faixas em `package.json` permitem outras versões; conferir o lockfile e o pacote realmente instalado. MSVC 14.51.36231, SDK Windows 10.0.26100.0 e headers Electron 28.3.3 x64 foram usados no build anterior.

`package.json` define `start`, `dev`, `rebuild`, `build:win`, `build:linux` e o novo `build:native:electron:isolated`. **Atenção:** `rebuild` e o primeiro passo de `build:win` executam `node-gyp rebuild` na raiz sem alvo Electron explícito; podem sobrescrever `build/Release/wasi_audio.node` e compilar com headers inadequados. A configuração `asarUnpack` existe, mas o distribuível não foi validado com a correção.

O novo `scripts/build-native-electron-isolated.js` lê a versão Electron instalada, copia os fontes atuais e `node-addon-api`, usa cache de headers indicado, arquitetura x64 e grava configuração, build e logs fora do repositório. É iniciado com `npm run build:native:electron:isolated -- --devdir=<cache> --output-root=<pasta externa> --python=<python.exe>`. O cache deve estar completo. A execução 3B usou o cache já disponível e não fez download; a presença do `--dist-url` e a validação de alguns arquivos de cache não constituem, por si só, um bloqueio de rede universal. A verificação de saída usa caminhos resolvidos sintaticamente: aliases ou links de diretório exigem cautela e revisão antes de uso em novos ambientes.

## 5. Estado Git e integridade

No início: modificados `main.js`, `package.json`, `public/app.js`, `src/native/audio_capture.cc`, `src/native/audio_capture.h`, `src/native/stub.cc`; não rastreados `ARQUITETURA.md` e `scripts/build-native-electron-isolated.js`. `git diff --check` passou. Os dois documentos de continuidade foram criados por esta auditoria e aparecerão como não rastreados. Não confundir esse estado com um checkout limpo nem descartar as alterações existentes.

Hashes SHA-256 conferidos:

| Item | SHA-256 |
|---|---|
| `src/native/audio_capture.cc` | `66CA069A261CF983CC0F3DB71A58B865527A7DE91BA78FB0B0F8F09D2354BD84` |
| `src/native/audio_capture.h` | `287027E6AE1A941A8C95A8FCA815A9853D619CE00B1CF073247503BC78BE4892` |
| `build/Release/wasi_audio.node` normal antigo | `5DF88514964CD640386D514C054E9B40A1564E0A1AB62A5622901612B227C727` |
| PID Drain validado em execução, Etapa 2M | `2346939F8D01861F847201F63DAEDEBFB402D2E11BE8024460096BEC52D15085` |
| Build isolado posterior, Etapa 3B | `2FDF4E35F3E71247D9802E954D7985D4125732487E1C68826F0B0004718A98C0` |

**Atualização 14/11/2026:** o 3B (`2FDF4E35…98C0`) foi promovido a `build/Release/wasi_audio.node` na Etapa 3C, com backup verificado do binário antigo em `D:\Projetos\_backups\screen-share-collab\3C-20261114-0246\`; detalhes, validação e reversão em `HANDOFF.md`. O texto a seguir descreve o estado de 11/11.

O addon antigo está ignorado por `build/` em `.gitignore` e é o que `main.js` carrega em execução normal. O PID Drain validado fica em `C:\Users\Gabriel\.codex\visualizations\2026\11\07\01a1b38e-109b-7e93-a393-5dc68a96fde5\screen-share-collab-addon-pid-drain-859e55f8d397455a8ef1e0a521ba57fb\build\Release\wasi_audio.node`. O novo artefato e logs de 3B estão em `C:\Users\Gabriel\.codex\visualizations\2026\11\07\01a1b38e-109b-7e93-a393-5dc68a96fde5\wasi-audio-electron-e4pWz1`. São arquivos locais externos, não artefatos garantidos em outros ambientes.

## 6. Evolução comprovada e histórico

- Git local: `713238b` introduziu suporte Electron/Vercel; `3e727eb` registra auditoria QA; `ee637d4` passou a ignorar artefatos de build; `ff2a980` registra otimização WASAPI, ring buffer e batching. Títulos de commits não comprovam comportamento atual nem incluem o trabalho não commitado posterior.
- Etapas anteriores à consolidação: modo isolado de dados e addon alternativo foi acrescentado em `main.js`; 720p60 recebeu ajuste de `screenShareEncoding`; foram feitos builds isolados e smoke tests. A origem e a intenção de todas as mudanças Linux não podem ser reconstruídas integralmente apenas pelo diff.
- 2K: PID ≈45.130 frames/s e 860 refills/9,2 s de silêncio; som do sistema ≈47.999 frames/s no teste comparativo.
- 2L–2M: drenagem por PID com `GetNextPacketSize()`, até 64 leituras por despertar, mais instrumentação; compilação isolada para Electron 28.3.3 x64.
- 2N–2O: o addon 2M carregou em perfil isolado; `getSources` estava disponível e a captura inicialmente desligada. Em teste real, PID ≈47.997 frames/s, zero refills/underruns/descartes, 1.220 despertares com múltiplos pacotes e máximo de dois. O proprietário percebeu melhora acentuada e uma ou duas mini travadas. O código de saída do smoke test não foi confiavelmente registrado.
- 2P: auditoria de observabilidade identificou falta de métricas do emissor/receptor WebRTC. O proprietário decidiu adiar essa investigação porque a qualidade atual é satisfatória.
- 3A: auditoria de consolidação identificou binário normal antigo e build sem alvo Electron explícito. 3B: comando de build isolado criado; build com saída 0, zero avisos e erros, PE32+ x64, exports Node-API, `node.lib` Electron e delay-load inspecionados. O timestamp PE e hash diferem do build 2M, sem demonstrar incompatibilidade ou equivalência funcional.

## 7. Estado das funcionalidades

| Funcionalidade | Classificação | Evidência e limite |
|---|---|---|
| PID Drain contra déficit sustentado | **Concluída nas condições experimentais testadas** | 2O com addon 2M, não ainda promovido ao fluxo normal. |
| Som do Sistema e transmissão 720p60 | **Implementada e validada em sessões específicas** | Testes 2K/2O; não constituem validação exaustiva de dispositivos e versões. |
| Build isolado 3B | **Concluído para construção e inspeção estática** | Um build bem-sucedido; runtime do artefato 3B desconhecido. |
| Integração normal e distribuível PID Drain | **Parcialmente implementada** | Fontes corrigidos presentes, mas addon normal é antigo; pacote instalado não verificado. |
| Encerramento normal do smoke test | **Estado desconhecido** | PID terminou, mas código de saída confiável não foi obtido. |
| Linux, troca de modalidade e sessões prolongadas | **Implementação existente, validação insuficiente** | Não há resultados recentes suficientes no material disponível. |
| Observabilidade das mini travadas | **Planejada/adiante** | Auditoria 2P apenas; investigação explicitamente adiada pelo proprietário. |
| Automação gráfica pelo Codex | **Planejada** | Electron gráfico falhou no sandbox; funciona no PowerShell comum. Não há executor implementado. |

## 8. Alterações locais e dependências

`audio_capture.cc/.h` combinam PID Drain, diagnóstico e alterações anteriores de batching; revisar por partes antes de qualquer consolidação. `public/app.js` altera a publicação de vídeo 720p60. `main.js` combina isolamento de perfil/addon com mudanças Linux e IPC. `stub.cc` adiciona includes. `package.json` e `scripts/build-native-electron-isolated.js` compõem a Etapa 3B. `ARQUITETURA.md` é documento anterior não rastreado. Os grupos não precisam ser um único commit; não há autorização de commit nesta auditoria.

## 9. Riscos e pendências prioritárias

1. **Resolvido em 14/11/2026 (Etapa 3C, ver HANDOFF) — addon normal desatualizado:** `main.js` carrega o binário antigo, não o corrigido. `build/` é ignorado e não acompanha o checkout. A promoção exige backup, hashes e autorização.
2. **Alta — scripts de build normais:** alvo Electron não é explícito no `node-gyp rebuild` atual. Não executá-los na raiz antes de preservar o binário e revisar o fluxo.
3. **Alta — distribuição:** `files` e `asarUnpack` mencionam o `.node`, mas não há comprovação do conteúdo e carregamento do instalador final. Testar o pacote real após preparar o build correto.
4. **Importante — áudio residual:** uma ou duas mini travadas permanecem observadas; causa não localizada. Não atribuir à rede, ao WASAPI ou ao receptor sem dados. Investigação adiada.
5. **Importante — ciclo de vida:** testar parada, reinício, troca sistema/PID, encerramento, sessão prolongada e regressão de vídeo. A fila Node-API é configurada sem limite; diagnosticar crescimento se observado.
6. **Importante — segurança e manutenção:** senha compartilhada no código e parâmetros de autenticação na URL requerem avaliação separada; não expor valores. `npm start` inclui `--no-sandbox` e flags gráficas; `main.js` adiciona `no-sandbox` no Linux. Avaliar implicações sem presumir autorização para alterá-los.
7. **Importante — diagnóstico nativo:** contadores atômicos e thread de resumo periódico custam recursos; discutir ativação em modo diagnóstico sem perder dados de erro, após preservar a correção validada.
8. **Importante — SDK e documentação:** CDN LiveKit não tem versão fixada. `ARQUITETURA.md` descreve reamostragem adaptativa e opções de publicação diferentes do código atual; tratá-lo como contexto histórico, não especificação atual.

## 10. Roadmap evidenciado e propostas

**Concluído com limites:** investigação e correção do déficit PID, validação funcional de 2M e build isolado estático de 3B. **Em andamento:** consolidação do addon para o fluxo normal. **Próxima fase proposta:** 3C, com backup e promoção verificável; não foi executada. **Posterior:** validação do pacote Windows, regressão de vídeo e ciclo de captura; automação do Electron pelo Codex como frente separada. **Adiado por decisão do proprietário:** aprofundar observabilidade das mini travadas. Não há evidência de cronograma ou critérios de lançamento abrangentes.

## 11. Plano de continuidade e critérios

1. Revalidar branch, HEAD, staging, diffs e os hashes acima; verificar que o artefato a promover corresponde à decisão do proprietário. O build 2M tem validação real; o 3B tem apenas validação estática. Não assumir que hashes diferentes significam diferenças de comportamento ou equivalência.
2. Preparar e revisar backup do `.node` normal, origem exata, destino, hashes, procedimento de promoção e reversão. Obter autorização específica antes de substituir qualquer binário.
3. Após promoção autorizada, confirmar hash do destino e fazer smoke test em perfil isolado, sem captura; comprovar caminho do módulo, preload, captura desligada e encerramento com código confiável.
4. Mediante autorização para captura, comparar sistema e PID, parar/reiniciar e alternar fontes; medir frames/s, refills, fila, áudio percebido e 720p60. Em seguida avaliar sessão prolongada.
5. Atualizar fluxo `build:win` para usar o build correto, validar conteúdo do ASAR/desempacotamento e testar instalador sem substituir artefatos ou dados existentes inadvertidamente. Avaliar quais contadores manter em modo normal.
6. Registrar resultados e revisar grupos de diff. Commits, publicação, automação externa e mudanças de permissões exigem instruções apropriadas do proprietário.

Critério para considerar 3C concluída: backup recuperável conferido; binário escolhido em `build/Release` com hash verificado; carregamento e encerramento comprovados; captura e regressões aceitas pelo proprietário; fluxo de build e reversão documentados. Os critérios concretos e a escolha entre 2M e 3B devem ser confirmados antes da promoção.

## 12. Lacunas e inconsistências

- Não há README, roadmap completo ou instruções `AGENTS.md` detectadas; `GEMINI.md` orienta preservar arquitetura, fazer alterações pequenas e priorizar Windows. O histórico completo de decisões pré-Git e logs externos pode estar incompleto.
- Não há prova de versão fixa do LiveKit carregado via CDN, nem de paridade entre a página implantada e o working tree local.
- `ARQUITETURA.md` é anterior e contradiz o Worklet, opções de publicação e batching Linux atuais; revisar antes de reutilizar. `profile.js` não aparece incluído na página.
- A versão do Windows necessária ao loopback por processo, suporte a outros dispositivos/formatos e comportamento Linux precisam ser verificados em testes próprios; comentários não substituem matriz de compatibilidade.
- Não há teste de instalador, teste de longa duração abrangente ou encerramento com código confiável documentado para o addon novo. As raras travadas não estão localizadas.
- O histórico não permite afirmar quais mudanças locais devem ser agrupadas em commits nem se as credenciais e infraestrutura de produção continuam ativas. Não consultar serviços externos ou incluir dados sensíveis sem necessidade.

## 13. Guia para o próximo agente

Comece por `HANDOFF.md`, este relatório, `GEMINI.md`, `package.json`, `binding.gyp`, `scripts/build-native-electron-isolated.js`, `main.js` e `src/native/audio_capture.cc/.h`. Confira o estado Git e hashes antes de agir. Preserve o working tree, perfis Electron, diretórios temporários e addons anteriores; não acesse o volume H: sem instrução. O addon normal ainda é o antigo; o PID Drain 2M foi validado funcionalmente, enquanto o build 3B aguarda runtime. A próxima tarefa recomendada é preparar a promoção reversível 3C e submetê-la à autorização do proprietário. Não retome a investigação WebRTC adiada nem altere buffers, temporizações, LiveKit ou vídeo como parte incidental dessa tarefa.
