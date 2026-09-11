/* =====================================================================
 *  PCM Audio Processor — AudioWorkletProcessor
 *  Replaces deprecated ScriptProcessorNode
 *  ===================================================================== */

class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);
    this.sampleRate = options.processorOptions?.sampleRate || 48000;
    this.bufferSize = 128; // frames per process call
    // Máximo de ~1s de áudio (48k * 2 canais * 375 buffers) em fila.
    // Evita latência/uso de memória infinitos se o broadcast atrasar.
    this.maxQueueSamples = 128 * 2 * 375;
    this.pcmQueue = new Float32Array(0);

    this.port.onmessage = (e) => {
      if (e.data?.buffer) {
        this.enqueue(e.data.buffer);
      }
    };
  }

  enqueue(float32Array) {
    const newQueue = new Float32Array(this.pcmQueue.length + float32Array.length);
    newQueue.set(this.pcmQueue);
    newQueue.set(float32Array, this.pcmQueue.length);
    this.pcmQueue = newQueue.length > this.maxQueueSamples
      ? newQueue.subarray(newQueue.length - this.maxQueueSamples)
      : newQueue;
  }

  process(inputs, outputs, parameters) {
    if (!outputs || !outputs[0] || outputs[0].length < 2) return true;
    const output = outputs[0];
    const outputL = output[0];
    const outputR = output[1];

    for (let i = 0; i < outputL.length; i++) {
      if (this.pcmQueue.length >= 2) {
        outputL[i] = this.pcmQueue[0];
        outputR[i] = this.pcmQueue[1];
        this.pcmQueue = this.pcmQueue.subarray(2);
      } else {
        outputL[i] = 0;
        outputR[i] = 0;
      }
    }

    return true; // Keep processor alive
  }
}

registerProcessor('pcm-processor', PCMProcessor);