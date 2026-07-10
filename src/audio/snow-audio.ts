export type SnowSoundKind = "step" | "dig" | "compact" | "deposit" | "throw" | "impact";

export class SnowAudio {
  private context: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private windSource: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;

  ensureStarted(): void {
    if (!this.context) {
      this.context = new AudioContext();
      this.noiseBuffer = this.makeNoiseBuffer(2);
      this.startWind();
    }
    if (this.context.state === "suspended") void this.context.resume();
  }

  setWind(strength: number): void {
    if (!this.context || !this.windGain || !this.windFilter) return;
    const now = this.context.currentTime;
    this.windGain.gain.setTargetAtTime(0.006 + Math.min(1, strength) * 0.038, now, 0.7);
    this.windFilter.frequency.setTargetAtTime(240 + strength * 580, now, 0.9);
  }

  play(kind: SnowSoundKind, wetness = 0.05, hardness = 0.1, intensity = 0.6): void {
    this.ensureStarted();
    if (!this.context || !this.noiseBuffer) return;
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const band = this.context.createBiquadFilter();
    band.type = kind === "impact" ? "lowpass" : "bandpass";
    const baseFrequency = kind === "step" ? 720 : kind === "compact" ? 430 : kind === "throw" ? 1100 : 560;
    band.frequency.value = baseFrequency * (1 - wetness * 0.48) + hardness * 900;
    band.Q.value = 0.5 + hardness * 2.5;
    const gain = this.context.createGain();
    const duration = kind === "throw" ? 0.18 : kind === "impact" ? 0.22 : 0.08 + intensity * 0.08;
    const peak = (kind === "step" ? 0.055 : 0.075) * Math.max(0.15, intensity);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.playbackRate.value = 0.78 + Math.random() * 0.35;
    source.connect(band).connect(gain).connect(this.context.destination);
    source.start(now, Math.random() * 1.2, duration + 0.02);
    source.stop(now + duration + 0.04);

    if (kind === "step" && hardness > 0.3) {
      const crack = this.context.createOscillator();
      const crackGain = this.context.createGain();
      crack.type = "triangle";
      crack.frequency.setValueAtTime(150 + hardness * 170, now);
      crack.frequency.exponentialRampToValueAtTime(70, now + 0.045);
      crackGain.gain.setValueAtTime(0.025 * intensity, now);
      crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      crack.connect(crackGain).connect(this.context.destination);
      crack.start(now);
      crack.stop(now + 0.055);
    }
  }

  private makeNoiseBuffer(seconds: number): AudioBuffer {
    if (!this.context) throw new Error("Audio context not initialized.");
    const length = this.context.sampleRate * seconds;
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const channel = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.68 + white * 0.32;
      channel[index] = previous;
    }
    return buffer;
  }

  private startWind(): void {
    if (!this.context || !this.noiseBuffer) return;
    this.windSource = this.context.createBufferSource();
    this.windSource.buffer = this.noiseBuffer;
    this.windSource.loop = true;
    this.windFilter = this.context.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 360;
    this.windFilter.Q.value = 0.35;
    this.windGain = this.context.createGain();
    this.windGain.gain.value = 0.018;
    this.windSource.connect(this.windFilter).connect(this.windGain).connect(this.context.destination);
    this.windSource.start();
  }
}
