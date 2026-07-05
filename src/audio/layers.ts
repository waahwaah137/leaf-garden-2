import * as Tone from 'tone';
import { createChimeLayer, type ChimeLayer } from './chime';
import { masterBus } from './engine';
import { PLANTS, type PlantPreset } from './plants';
import { degreeToNote, type ScaleDef } from './scales';

export type RoleName = 'melodic' | 'rhythmic';

interface DroneLayer {
  gainNode: Tone.Gain;
  setScale: (scale: ScaleDef) => void;
}

interface FluteLayer {
  gainNode: Tone.Gain;
  setScale: (scale: ScaleDef) => void;
}

interface VocalLayer {
  gainNode: Tone.Gain;
  setScale: (scale: ScaleDef) => void;
}

interface PercussionLayer {
  gainNode: Tone.Gain;
}

interface TextureLayer {
  gainNode: Tone.Gain;
}

export interface PlantLayers {
  preset: PlantPreset;
  plantGain: Tone.Gain;
  melodicGain: Tone.Gain;
  rhythmicGain: Tone.Gain;
  drone: DroneLayer;
  flute: FluteLayer;
  vocal: VocalLayer;
  percussion: PercussionLayer;
  texture: TextureLayer;
}

let plantLayers: PlantLayers[] = [];
let sharedReverb: Tone.Reverb;
let chimeLayer: ChimeLayer;

function createDroneLayer(preset: PlantPreset, destination: Tone.Gain): DroneLayer {
  const gainNode = new Tone.Gain(Tone.dbToGain(-16)).connect(destination);
  const filter = new Tone.Filter(preset.droneTimbre.filterCutoffHz, 'lowpass').connect(gainNode);
  const synth = new Tone.PolySynth(Tone.FMSynth, {
    envelope: { attack: 3, decay: 1, sustain: 1, release: 4 },
    modulationIndex: 2,
    harmonicity: 1.5,
  }).connect(filter);
  synth.set({ oscillator: { type: preset.droneTimbre.oscillatorType } });

  let currentNotes: string[] = [];

  function setScale(scale: ScaleDef): void {
    const nextNotes = [0, 2].map((degree) => degreeToNote(scale, degree, preset.tonalOffsetDegrees));
    if (nextNotes.join(',') === currentNotes.join(',')) return;
    if (currentNotes.length > 0) synth.triggerRelease(currentNotes, '+0.1');
    synth.triggerAttack(nextNotes, '+2');
    currentNotes = nextNotes;
  }

  return { gainNode, setScale };
}

function createFluteLayer(preset: PlantPreset, destination: Tone.Gain): FluteLayer {
  const gainNode = new Tone.Gain(Tone.dbToGain(-10)).connect(destination);
  const delay = new Tone.PingPongDelay('8n', 0.15).connect(gainNode);
  delay.wet.value = 0.15;
  const synth = new Tone.MonoSynth({
    envelope: { attack: 0.08, decay: 0.2, sustain: 0.3, release: 0.6 },
    filterEnvelope: { attack: 0.05, decay: 0.2, sustain: 0.4, release: 0.5, baseFrequency: 800, octaves: 2 },
  }).connect(delay);
  synth.oscillator.type = preset.fluteTimbre.oscillatorType;

  let scale: ScaleDef | null = null;
  let degree = 2 + preset.fluteTimbre.registerOffsetDegrees;

  const loop = new Tone.Loop((time) => {
    if (!scale) return;
    const step = Math.random() < 0.5 ? 1 : -1;
    const leap = Math.random() < 0.15 ? step * 2 : step;
    degree = Math.max(-2, Math.min(9, degree + leap));
    if (Math.random() < 0.82) {
      const note = degreeToNote(scale, degree, preset.tonalOffsetDegrees);
      synth.triggerAttackRelease(note, '8n', time, 0.6 + Math.random() * 0.3);
    }
  }, '4n');
  loop.humanize = true;
  loop.start(0);

  function setScale(nextScale: ScaleDef): void {
    scale = nextScale;
  }

  return { gainNode, setScale };
}

function createVocalLayer(preset: PlantPreset, destination: Tone.Gain): VocalLayer {
  const gainNode = new Tone.Gain(Tone.dbToGain(-14)).connect(destination);
  const synth = new Tone.PolySynth(Tone.AMSynth, {
    envelope: { attack: 0.05, decay: 0.3, sustain: 0.4, release: 1.2 },
  }).connect(gainNode);

  let scale: ScaleDef | null = null;
  let barCount = 0;

  const loop = new Tone.Loop((time) => {
    barCount++;
    if (!scale) return;
    if (barCount % 4 !== 0) return; // periodic call/response, not constant
    const call = degreeToNote(scale, 4, preset.tonalOffsetDegrees);
    const response = degreeToNote(scale, 1, preset.tonalOffsetDegrees);
    synth.triggerAttackRelease(call, '4n', time, 0.5);
    synth.triggerAttackRelease(response, '4n', time + Tone.Time('2n').toSeconds(), 0.4);
  }, '1m');
  loop.start(0);

  function setScale(nextScale: ScaleDef): void {
    scale = nextScale;
  }

  return { gainNode, setScale };
}

function createPercussionLayer(preset: PlantPreset, destination: Tone.Gain): PercussionLayer {
  const gainNode = new Tone.Gain(Tone.dbToGain(-8)).connect(destination);
  const low = new Tone.MembraneSynth({ octaves: 4, pitchDecay: 0.05 }).connect(gainNode);
  const slap = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.08, sustain: 0 },
  }).connect(new Tone.Filter(4000, 'highpass').connect(gainNode));

  const GHOST_NOTE_PROBABILITY = 0.15; // fixed baseline fill, no longer wind-driven

  const sequence = new Tone.Sequence(
    (time, step: number) => {
      if (preset.percussionPattern[step % preset.percussionPattern.length]) {
        low.triggerAttackRelease('C2', '8n', time);
      } else if (Math.random() < GHOST_NOTE_PROBABILITY) {
        slap.triggerAttackRelease('16n', time);
      }
    },
    Array.from({ length: 8 }, (_, i) => i),
    '8n',
  );
  sequence.start(0);

  return { gainNode };
}

function createTextureLayer(preset: PlantPreset, destination: Tone.Gain): TextureLayer {
  const gainNode = new Tone.Gain(Tone.dbToGain(-24)).connect(destination);
  const filter = new Tone.Filter(500, 'bandpass').connect(gainNode);
  const lfo = new Tone.LFO({ frequency: 0.08, min: 300, max: 2200 }).connect(filter.frequency);
  lfo.start();
  const noise = new Tone.Noise('pink').connect(filter);
  noise.start();
  void preset;

  return { gainNode };
}

export function createLayers(): PlantLayers[] {
  sharedReverb = new Tone.Reverb({ decay: 4, wet: 0.25 }).connect(masterBus);
  chimeLayer = createChimeLayer(masterBus);

  plantLayers = PLANTS.map((preset) => {
    const plantGain = new Tone.Gain(0).connect(sharedReverb);
    const melodicGain = new Tone.Gain(0.5).connect(plantGain);
    const rhythmicGain = new Tone.Gain(0.5).connect(plantGain);

    return {
      preset,
      plantGain,
      melodicGain,
      rhythmicGain,
      drone: createDroneLayer(preset, melodicGain),
      flute: createFluteLayer(preset, melodicGain),
      vocal: createVocalLayer(preset, melodicGain),
      percussion: createPercussionLayer(preset, rhythmicGain),
      texture: createTextureLayer(preset, rhythmicGain),
    };
  });

  return plantLayers;
}

export function getPlantLayers(): PlantLayers[] {
  return plantLayers;
}

export function applyGlobalScale(scale: ScaleDef): void {
  for (const plant of plantLayers) {
    plant.drone.setScale(scale);
    plant.flute.setScale(scale);
    plant.vocal.setScale(scale);
  }
}

export function updateChime(micLevel: number, scale: ScaleDef, nowMs: number): void {
  chimeLayer?.update(micLevel, scale, nowMs);
}
