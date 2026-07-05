import type { LightSensor } from '../sensors/lightSensor';
import type { MicSensor } from '../sensors/micSensor';
import type { HeadingMode, OrientationSensor } from '../sensors/orientationSensor';
import { angularDistance, raisedCosineFalloff } from '../utils/math';
import { getCommandedBpm } from './engine';
import { getPlantLayers, applyGlobalScale, updateChime } from './layers';
import { PLANTS } from './plants';
import { getScaleForBrightness } from './scales';

const PLANT_WEIGHT_WIDTH = 120; // degrees — matches plant spacing so weights sum to 1
const GAIN_RAMP_SECONDS = 0.25;

export interface MappingSensors {
  light: LightSensor;
  mic: MicSensor;
  orientation: OrientationSensor;
}

export interface MappingState {
  brightness: number;
  wind: number;
  heading: number;
  headingMode: HeadingMode;
  tiltValue: number;
  scaleName: string;
  bpm: number;
  plantWeights: { name: string; weight: number }[];
}

export function updateMapping(sensors: MappingSensors, nowMs: number): MappingState {
  const brightness = sensors.light.getValue();
  const wind = sensors.mic.getValue();
  const heading = sensors.orientation.getHeading();
  const headingMode = sensors.orientation.getHeadingMode();
  const tiltValue = sensors.orientation.getTiltValue();

  const scale = getScaleForBrightness(brightness);
  applyGlobalScale(scale);

  // Wind no longer drives continuous tempo/intensity — instead it triggers discrete
  // chime hits on loud onsets. Master volume is a manual slider (see engine.setMasterVolume).
  // Onset detection needs the fast-attack display level, not the heavily-smoothed
  // mapping value above (which barely moves frame-to-frame and would never cross
  // the rise threshold).
  updateChime(sensors.mic.getDisplayLevel(), scale, nowMs);

  const plantWeights = PLANTS.map((preset) =>
    raisedCosineFalloff(angularDistance(heading, preset.headingDegrees), PLANT_WEIGHT_WIDTH),
  );

  const layers = getPlantLayers();
  layers.forEach((plant, i) => {
    plant.plantGain.gain.rampTo(plantWeights[i], GAIN_RAMP_SECONDS);
    plant.melodicGain.gain.rampTo(tiltValue, GAIN_RAMP_SECONDS);
    plant.rhythmicGain.gain.rampTo(1 - tiltValue, GAIN_RAMP_SECONDS);
  });

  return {
    brightness,
    wind,
    heading,
    headingMode,
    tiltValue,
    scaleName: scale.name,
    bpm: getCommandedBpm(),
    plantWeights: PLANTS.map((preset, i) => ({ name: preset.name, weight: plantWeights[i] })),
  };
}
