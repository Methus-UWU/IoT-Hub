import { Service, signal } from '@angular/core';

/**
 * Sound for the parts that make one in the real world.
 *
 * A relay that switches, a motor that spins and a pump that runs are all things
 * you hear before you see on a bench, and the canvas was silent about all three:
 * the only feedback that a coil had pulled in was a two-pixel lamp. Everything
 * here is synthesised with Web Audio rather than shipped as sample files, so the
 * bundle grows by nothing and a motor's pitch can follow the voltage across it.
 *
 * Nothing in this file knows what a relay *is*. The page hands over the runtime
 * values the simulation already publishes — `chN`, `spinning`, `pumping`,
 * `sounding` — and this service turns them into voices, the same way the artwork
 * pipeline turns shape lists into SVG. A new noisy part becomes audible by
 * emitting one of those keys, not by editing this file.
 */

const MUTED_KEY = 'iot-hub.virtual-device.muted';

type VoiceKind = 'motor' | 'pump' | 'buzzer';

/** A part that should be making a continuous noise right now. */
export interface SustainedSound {
  /** Instance id, so one part keeps one voice across ticks. */
  readonly id: string;
  readonly kind: VoiceKind;
  /** 0–1 how hard it is working; drives pitch and level. */
  readonly intensity: number;
  /** Buzzers only: the tone being driven, which is their whole point. */
  readonly hertz?: number;
}

interface Voice {
  readonly kind: VoiceKind;
  readonly gain: GainNode;
  /** Retuned as the drive changes: a motor's fundamental, a pump's throat. */
  readonly pitch: AudioParam;
  /** The motor's second oscillator, kept a beat above the fundamental. */
  readonly harmonic?: AudioParam;
  readonly sources: readonly AudioScheduledSourceNode[];
}

function readMuted(): boolean {
  try {
    return globalThis.localStorage?.getItem(MUTED_KEY) === 'true';
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    globalThis.localStorage?.setItem(MUTED_KEY, String(muted));
  } catch {
    // As above: a missing preference is not worth failing a click over.
  }
}

/** Ramp time short enough to feel immediate, long enough not to click. */
const GLIDE = 0.05;

@Service()
export class CircuitAudioService {
  private readonly mutedState = signal(readMuted());
  /** True while the user has silenced the canvas; survives a reload. */
  readonly muted = this.mutedState.asReadonly();

  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly voices = new Map<string, Voice>();

  /**
   * Opens the audio device while a user gesture is still in scope.
   *
   * Browsers hand back a suspended context to anything that asks outside a
   * click, and the first sound comes from the simulation tick — a frame or two
   * after the press of Start, by which time the gesture is over. Calling this
   * from the click handler itself is what makes the first relay audible instead
   * of the first one after it.
   */
  prime(): void {
    this.ensureContext();
  }

  toggleMuted(): void {
    const next = !this.mutedState();
    this.mutedState.set(next);
    writeMuted(next);
    if (next) this.silence();
  }

  /**
   * Reconciles the running voices against the parts that should be sounding.
   *
   * Called on every simulation tick, so it must be cheap and idempotent: a part
   * already making the right noise is retuned, never restarted. Restarting is
   * what would turn a steady motor into the stutter this replaces.
   */
  sustain(sounds: readonly SustainedSound[]): void {
    if (this.mutedState()) return;
    const context = sounds.length ? this.ensureContext() : this.context;
    if (!context) return;

    const live = new Set<string>();
    for (const sound of sounds) {
      live.add(sound.id);
      const existing = this.voices.get(sound.id);
      if (existing && existing.kind === sound.kind) {
        this.tune(existing, sound);
        continue;
      }
      // A part that changed what it is doing — a motor rewired as a pump would
      // be odd, but a stale voice outliving its part is not — starts over.
      if (existing) this.stopVoice(sound.id);
      const master = this.master;
      if (master) this.voices.set(sound.id, this.startVoice(context, master, sound));
    }

    for (const id of [...this.voices.keys()]) {
      if (!live.has(id)) this.stopVoice(id);
    }
  }

  /**
   * The armature snapping over, once per transition.
   *
   * Pulling in is the louder, brighter of the two: the coil throws the contact
   * across, while releasing is just the return spring.
   */
  click(energised: boolean): void {
    if (this.mutedState()) return;
    const context = this.ensureContext();
    if (!context || !this.master || !this.noise) return;

    const now = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = this.noise;

    // A relay click is a transient, not a tone: a band of noise shaped by an
    // envelope that is over in a few tens of milliseconds.
    const band = context.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = energised ? 2400 : 1700;
    band.Q.value = 1.2;

    const gain = context.createGain();
    const peak = energised ? 0.5 : 0.3;
    const length = energised ? 0.045 : 0.03;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + length);

    source.connect(band).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + length + 0.02);
  }

  /** Stops everything at once — the simulation stopped, or the page is closing. */
  silence(): void {
    for (const id of [...this.voices.keys()]) this.stopVoice(id);
  }

  private startVoice(context: AudioContext, master: GainNode, sound: SustainedSound): Voice {
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.connect(master);

    const voice = this.build(context, gain, sound.kind);
    for (const source of voice.sources) source.start();
    this.tune(voice, sound);
    return voice;
  }

  private build(context: AudioContext, gain: GainNode, kind: VoiceKind): Voice {
    if (kind === 'motor') return this.buildMotor(context, gain);
    if (kind === 'pump') return this.buildPump(context, gain);
    return this.buildBuzzer(context, gain);
  }

  /**
   * A small brushed DC motor: a buzzy fundamental with a second, slightly
   * detuned copy above it. The beat between the two is what keeps it from
   * sounding like a test tone.
   */
  private buildMotor(context: AudioContext, gain: GainNode): Voice {
    const fundamental = context.createOscillator();
    fundamental.type = 'sawtooth';

    const upper = context.createOscillator();
    upper.type = 'square';

    const upperLevel = context.createGain();
    upperLevel.gain.value = 0.25;

    // Without this the sawtooth is all edge; a motor is mostly body.
    const body = context.createBiquadFilter();
    body.type = 'lowpass';
    body.frequency.value = 900;
    body.Q.value = 0.8;

    fundamental.connect(body);
    upper.connect(upperLevel).connect(body);
    body.connect(gain);

    return {
      kind: 'motor',
      gain,
      pitch: fundamental.frequency,
      harmonic: upper.frequency,
      sources: [fundamental, upper],
    };
  }

  /**
   * A diaphragm pump: filtered noise for the water, gated by a slow tremolo so
   * you hear it reciprocating rather than hissing.
   */
  private buildPump(context: AudioContext, gain: GainNode): Voice {
    const source = context.createBufferSource();
    source.buffer = this.ensureNoise(context);
    source.loop = true;

    const throat = context.createBiquadFilter();
    throat.type = 'bandpass';
    throat.frequency.value = 320;
    throat.Q.value = 1.4;

    const stroke = context.createOscillator();
    stroke.type = 'sine';
    stroke.frequency.value = 7;

    const strokeDepth = context.createGain();
    strokeDepth.gain.value = 0.45;

    // The LFO rides on top of the voice gain rather than replacing it, so the
    // level the page asks for still sets how loud the pump is overall.
    stroke.connect(strokeDepth).connect(gain.gain);

    source.connect(throat).connect(gain);

    return { kind: 'pump', gain, pitch: throat.frequency, sources: [source, stroke] };
  }

  /**
   * A piezo can: a square wave with the bottom taken out of it.
   *
   * A real disc has almost no diaphragm below a kilohertz and a sharp mechanical
   * limit above a few, so the high-pass and low-pass together are what stop this
   * sounding like a synthesiser playing the same note. The square is the honest
   * shape — it is what a sketch's `tone()` actually drives.
   */
  private buildBuzzer(context: AudioContext, gain: GainNode): Voice {
    const tone = context.createOscillator();
    tone.type = 'square';

    const disc = context.createBiquadFilter();
    disc.type = 'highpass';
    disc.frequency.value = 700;

    const ceiling = context.createBiquadFilter();
    ceiling.type = 'lowpass';
    ceiling.frequency.value = 7000;

    tone.connect(disc).connect(ceiling).connect(gain);

    return { kind: 'buzzer', gain, pitch: tone.frequency, sources: [tone] };
  }

  /** Maps what a part is doing onto the pitch and level of its running voice. */
  private tune(voice: Voice, sound: SustainedSound): void {
    const context = this.context;
    if (!context) return;
    const level = Math.min(Math.max(sound.intensity, 0), 1);
    const at = context.currentTime;

    if (voice.kind === 'buzzer') {
      // Stepped, not glided: a sketch playing a melody moves between notes, and
      // sliding between them would turn every tune into a siren.
      voice.pitch.setValueAtTime(Math.min(Math.max(sound.hertz ?? 2400, 20), 10_000), at);
      voice.gain.gain.setTargetAtTime(0.045, at, GLIDE);
      return;
    }

    if (voice.kind === 'motor') {
      const hertz = 42 + level * 128;
      voice.pitch.setTargetAtTime(hertz, at, GLIDE);
      // Just off the octave, so the two oscillators beat instead of locking.
      voice.harmonic?.setTargetAtTime(hertz * 2.02, at, GLIDE);
      voice.gain.gain.setTargetAtTime(0.035 + level * 0.075, at, GLIDE);
      return;
    }

    voice.pitch.setTargetAtTime(240 + level * 260, at, GLIDE);
    voice.gain.gain.setTargetAtTime(0.05 + level * 0.09, at, GLIDE);
  }

  private stopVoice(id: string): void {
    const voice = this.voices.get(id);
    const context = this.context;
    if (!voice || !context) return;
    this.voices.delete(id);

    // Fade out first: cutting a running oscillator dead is an audible pop.
    const at = context.currentTime;
    voice.gain.gain.cancelScheduledValues(at);
    voice.gain.gain.setTargetAtTime(0.0001, at, 0.03);
    for (const source of voice.sources) source.stop(at + 0.2);
  }

  /**
   * The audio context, created on the first sound rather than at startup.
   *
   * Browsers refuse to start one outside a user gesture, and the first sound
   * always follows a press of Start — so building it here is both allowed and
   * the only way to avoid a suspended context nothing ever resumes.
   */
  private ensureContext(): AudioContext | null {
    if (this.context) {
      if (this.context.state === 'suspended') void this.context.resume();
      return this.context;
    }
    if (typeof AudioContext === 'undefined') return null;

    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = 0.9;
    master.connect(context.destination);

    this.context = context;
    this.master = master;
    this.ensureNoise(context);
    // Created outside a gesture it arrives suspended; resume is allowed as soon
    // as the page has been interacted with once, which by here it has.
    if (context.state === 'suspended') void context.resume();
    return context;
  }

  /** Two seconds of white noise, shared by every click and every pump. */
  private ensureNoise(context: AudioContext): AudioBuffer {
    if (this.noise) return this.noise;
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index++) {
      samples[index] = Math.random() * 2 - 1;
    }
    this.noise = buffer;
    return buffer;
  }
}
