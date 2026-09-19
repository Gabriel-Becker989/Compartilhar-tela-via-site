/* =====================================================================
 *  PCM Audio Processor — AudioWorkletProcessor
 *  Replaces deprecated ScriptProcessorNode
 *
 *  RING BUFFER: tamanho fixo, sem alocações durante operação.
 *  Elimina GC pressure no thread real-time, que era a causa principal
 *  dos cortes/estalos de áudio.
 *
 *  Jitter buffer adaptativo ajustado:
 *   - Prime inicial de ~150ms (era 600ms): suficiente para absorver
 *     variação do IPC Electron sem delay audível de arranque.
 *   - Refill trigger em ~80ms (era 150ms): só aciona quando realmente
 *     crítico, evitando pausas desnecessárias.
 *   - Refill target em ~150ms (era 300ms): pausa menor quando ocorre.
 *
 *  Telemetria: underruns, drops, refills reportados a cada 5s.
 *  ===================================================================== */

class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this.sampleRate = options.processorOptions?.sampleRate || 48000;

    // Ring buffer: tamanho fixo = ~1.5s de áudio estéreo interleaved.
    // Nunca aloca durante enqueue/process — apenas move head/tail.
    // 1.5s × sampleRate × 2ch = ~144000 samples @48kHz.
    // Capacidade efetiva = ringSize - 1 (para diferenciar full de empty).
    this.ringSize = Math.pow(2, Math.ceil(Math.log2(Math.round(1.5 * this.sampleRate * 2) + 1)));
    this.ring = new Float32Array(this.ringSize);
    this.writeHead = 0;
    this.readHead = 0;

    // Jitter buffer adaptativo:
    //  Prime de ~150ms: absorve variação do IPC (batches ~41ms → 3-4 pacotes).
    //  Mantém profundidade entre 80ms e 150ms após o arranque.
    //  Valores em amostras INTERLEAVED (L+R).
    this.primeSamples = Math.round(0.150 * this.sampleRate) * 2;      // ~14400 @48kHz
    this.refillTargetSamples = Math.round(0.150 * this.sampleRate) * 2; // ~14400 @48kHz
    this.refillLowSamples = Math.round(0.080 * this.sampleRate) * 2;    // ~7680 @48kHz
    this.priming = true;
    this.inRefill = false;
    this.refills = 0;
    this.refillSamples = 0;

    // Telemetria
    this.receivedSamples = 0;
    this.consumedSamples = 0;
    this.underrunCount = 0;
    this.dropCount = 0;
    this.maxGapSamples = 0;
    this.curGapSamples = 0;
    this.lastStatTime = currentTime;

    this.port.onmessage = (e) => {
      if (e.data?.buffer) {
        this.enqueue(e.data.buffer);
      }
    };
  }

  /** Quantidade de amostras disponíveis no ring buffer. */
  get available() {
    const diff = this.writeHead - this.readHead;
    return diff >= 0 ? diff : diff + this.ringSize;
  }

  /** Espaço livre no ring buffer. */
  get freeSpace() {
    return this.ringSize - 1 - this.available;
  }

  /**
   * Enfileira dados no ring buffer.
   * Sem alocação de memória — escreve diretamente no buffer fixo.
   * Se overflow: descarta os dados mais antigos avançando readHead.
   */
  enqueue(float32Array) {
    const len = float32Array.length;
    this.receivedSamples += len;

    // Se não cabe, descarta as amostras mais antigas necessárias.
    if (len > this.freeSpace) {
      const overflow = len - this.freeSpace;
      this.dropCount += overflow;
      this.readHead = (this.readHead + overflow) & (this.ringSize - 1);
    }

    // Escrita em até dois segmentos (wrap around do ring).
    const firstSegment = Math.min(len, this.ringSize - this.writeHead);
    this.ring.set(float32Array.subarray(0, firstSegment), this.writeHead);
    if (len > firstSegment) {
      this.ring.set(float32Array.subarray(firstSegment), 0);
    }
    this.writeHead = (this.writeHead + len) & (this.ringSize - 1);
  }

  /**
   * Lê `count` amostras do ring buffer para `destL` e `destR`.
   * Desmultiplexa interleaved L/R diretamente — sem alocação.
   * @param {Float32Array} destL
   * @param {Float32Array} destR
   * @param {number} count — número de frames (pares L/R) a ler
   */
  readFrames(destL, destR, count) {
    const avail = this.available;
    const canRead = Math.min(count, avail >> 1); // frames disponíveis (divide por 2 canais)

    for (let i = 0; i < canRead; i++) {
      destL[i] = this.ring[this.readHead];
      this.readHead = (this.readHead + 1) & (this.ringSize - 1);
      destR[i] = this.ring[this.readHead];
      this.readHead = (this.readHead + 1) & (this.ringSize - 1);
      this.consumedSamples += 2;
      this.curGapSamples = 0;
    }

    // Preenche o restante com silêncio (underrun)
    for (let i = canRead; i < count; i++) {
      destL[i] = 0;
      destR[i] = 0;
      this.underrunCount++;
      this.curGapSamples++;
      if (this.curGapSamples > this.maxGapSamples) {
        this.maxGapSamples = this.curGapSamples;
      }
    }
  }

  process(inputs, outputs, parameters) {
    if (!outputs || !outputs[0] || outputs[0].length < 2) return true;
    const outputL = outputs[0][0];
    const outputR = outputs[0][1];
    const frames = outputL.length; // 128 frames por chamada @48kHz

    // Jitter buffer: espera prime antes de começar a tocar.
    if (this.priming) {
      if (this.available >= this.primeSamples) {
        this.priming = false;
      } else {
        outputL.fill(0);
        outputR.fill(0);
        this.maybeReportStats();
        return true;
      }
    }

    // Manutenção adaptativa: se a fila ficou rasa, aguarda reenchimento.
    if (!this.inRefill && this.available < this.refillLowSamples) {
      this.inRefill = true;
      this.refills++;
    }
    if (this.inRefill) {
      outputL.fill(0);
      outputR.fill(0);
      this.refillSamples += frames;
      if (this.available >= this.refillTargetSamples) {
        this.inRefill = false;
      }
      this.maybeReportStats();
      return true;
    }

    // Leitura normal — sem alocação.
    this.readFrames(outputL, outputR, frames);
    this.maybeReportStats();
    return true;
  }

  /** Relata estatísticas a cada 5s via port. */
  maybeReportStats() {
    if (currentTime - this.lastStatTime >= 5.0) {
      this.lastStatTime = currentTime;
      this.port.postMessage({
        type: 'stats',
        sampleRate: this.sampleRate,
        priming: this.priming,
        receivedSamples: this.receivedSamples,
        consumedSamples: this.consumedSamples,
        underrunCount: this.underrunCount,
        dropCount: this.dropCount,
        maxGapSamples: this.maxGapSamples,
        refills: this.refills,
        refillSamples: this.refillSamples,
        drift: this.receivedSamples - this.consumedSamples,
        ringAvailable: this.available,
        ringSize: this.ringSize,
      });
    }
  }
}

registerProcessor('pcm-processor', PCMProcessor);