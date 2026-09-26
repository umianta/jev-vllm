// Runs in the audio thread: float samples at the context rate (16 kHz) → Int16 frames of 20 ms.
class PcmFramer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Int16Array(320);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.buf.length) {
        this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
        this.buf = new Int16Array(320);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-framer", PcmFramer);
