export type SoundName =
  | 'deal'
  | 'card'
  | 'check'
  | 'fold'
  | 'call'
  | 'raise'
  | 'allin'
  | 'turn'
  | 'win'
  | 'winSoft'
  | 'reveal'
  | 'toggle';

const PREF_KEY = 'holdem.sound';

export function loadSoundEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, enabled ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = !loadSoundEnabled();

  unlock = (): void => {
    if (typeof window === 'undefined') return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    if (!this.ctx) {
      const ctx = new Ctor();
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.knee.value = 24;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;

      const master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(compressor);
      compressor.connect(ctx.destination);

      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      this.ctx = ctx;
      this.master = master;
      this.noiseBuffer = buffer;
    }

    if (this.ctx.state === 'suspended') void this.ctx.resume();
  };

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  play(name: SoundName, delay = 0): void {
    if (this.muted) return;
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuffer) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t = ctx.currentTime + 0.015 + delay;

    switch (name) {
      case 'deal': {
        this.burst(t, 0.18, 900, 0.6, 0.032, 'bandpass', 1600);
        this.card(t + 0.04);
        this.card(t + 0.11);
        this.card(t + 0.18);
        break;
      }
      case 'card':
        this.card(t);
        break;
      case 'check':
        this.burst(t, 0.045, 620, 1, 0.06);
        this.tone(200, t, 0.06, 'sine', 0.038);
        break;
      case 'fold':
        this.burst(t, 0.16, 1500, 0.7, 0.05, 'lowpass', 320);
        this.tone(300, t, 0.1, 'triangle', 0.018, 180);
        break;
      case 'call':
        this.chip(t, 0.9);
        break;
      case 'raise':
        this.chip(t);
        this.chip(t + 0.06, 0.8);
        this.chip(t + 0.12, 0.65);
        break;
      case 'allin':
        for (let i = 0; i < 5; i++) this.chip(t + i * 0.045, 0.9 - i * 0.1);
        this.tone(90, t + 0.04, 0.38, 'sine', 0.07, 60);
        this.tone(180, t + 0.04, 0.22, 'triangle', 0.022, 100);
        break;
      case 'turn':
        this.tone(880, t, 0.18, 'sine', 0.055);
        this.tone(1318.5, t + 0.09, 0.36, 'sine', 0.038);
        this.tone(1760, t + 0.09, 0.2, 'sine', 0.01);
        break;
      case 'reveal':
        this.card(t);
        break;
      case 'win': {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, index) => {
          this.tone(freq, t + index * 0.085, 0.38, 'triangle', index === 3 ? 0.05 : 0.036);
          this.tone(freq * 2, t + index * 0.085, 0.22, 'sine', 0.01);
        });
        this.tone(261.63, t + 0.03, 0.7, 'sine', 0.022);
        break;
      }
      case 'winSoft':
        this.tone(392, t, 0.3, 'sine', 0.03);
        this.tone(523.25, t + 0.1, 0.4, 'sine', 0.024);
        break;
      case 'toggle':
        this.chip(t, 0.55);
        break;
    }
  }

  playCards(count: number, delay = 0): void {
    const cards = Math.min(5, Math.max(1, count));
    for (let i = 0; i < cards; i++) this.play('card', delay + i * 0.075);
  }

  private card(t: number, volume = 1): void {
    this.burst(t, 0.06, 1700 + Math.random() * 800, 0.8, 0.065 * volume, 'bandpass', 700);
    this.tone(760 + Math.random() * 220, t, 0.035, 'triangle', 0.015 * volume);
  }

  private chip(t: number, volume = 1): void {
    const base = 2100 + Math.random() * 900;
    this.burst(t, 0.025, base * 1.7, 1.1, 0.06 * volume, 'bandpass');
    this.tone(base, t, 0.075, 'sine', 0.022 * volume);
    this.tone(base * 1.5, t + 0.006, 0.045, 'triangle', 0.008 * volume);
  }

  private tone(
    freq: number,
    t: number,
    duration: number,
    type: OscillatorType,
    gain: number,
    endFreq?: number,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const osc = ctx.createOscillator();
    const envelope = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), t + duration);

    envelope.gain.setValueAtTime(0.0001, t);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    osc.connect(envelope);
    envelope.connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.03);
  }

  private burst(
    t: number,
    duration: number,
    freq: number,
    q: number,
    gain: number,
    type: BiquadFilterType = 'bandpass',
    endFreq?: number,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    const noise = this.noiseBuffer;
    if (!ctx || !master || !noise) return;

    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, t);
    if (endFreq) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(60, endFreq), t + duration);
    }

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, t);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    src.connect(filter);
    filter.connect(envelope);
    envelope.connect(master);
    src.start(t, Math.random() * 0.3);
    src.stop(t + duration + 0.02);
  }
}

export const sound = new SoundEngine();

if (typeof window !== 'undefined') {
  const unlock = () => sound.unlock();
  window.addEventListener('pointerdown', unlock, { once: true, capture: true });
  window.addEventListener('keydown', unlock, { once: true, capture: true });
  window.addEventListener('click', unlock, { once: true, capture: true });
}
