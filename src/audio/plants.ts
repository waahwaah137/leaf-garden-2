export interface PlantPreset {
  name: string;
  /** Compass heading (degrees, 0-360) this plant is "located" at. */
  headingDegrees: number;
  /** Scale-degree transposition applied to this plant's melodic layers, relative to the global tonic. */
  tonalOffsetDegrees: number;
  droneTimbre: {
    oscillatorType: 'sine' | 'triangle' | 'sawtooth';
    filterCutoffHz: number;
  };
  fluteTimbre: {
    registerOffsetDegrees: number;
    oscillatorType: 'sine' | 'triangle';
  };
  /** Base 8-step rhythmic pattern (1 = hit, 0 = rest); density tiers add subdivisions on top of this. */
  percussionPattern: number[];
}

export const PLANTS: PlantPreset[] = [
  {
    name: 'plant-a',
    headingDegrees: 0,
    tonalOffsetDegrees: 0,
    droneTimbre: { oscillatorType: 'sine', filterCutoffHz: 900 },
    fluteTimbre: { registerOffsetDegrees: 0, oscillatorType: 'sine' },
    percussionPattern: [1, 0, 0, 1, 0, 0, 1, 0],
  },
  {
    name: 'plant-b',
    headingDegrees: 120,
    tonalOffsetDegrees: 2,
    droneTimbre: { oscillatorType: 'triangle', filterCutoffHz: 1200 },
    fluteTimbre: { registerOffsetDegrees: 5, oscillatorType: 'triangle' },
    percussionPattern: [1, 0, 1, 0, 1, 0, 0, 1],
  },
  {
    name: 'plant-c',
    headingDegrees: 240,
    tonalOffsetDegrees: 4,
    droneTimbre: { oscillatorType: 'sawtooth', filterCutoffHz: 700 },
    fluteTimbre: { registerOffsetDegrees: -3, oscillatorType: 'sine' },
    percussionPattern: [1, 1, 0, 0, 1, 0, 1, 0],
  },
];
