import type * as RapierModule from '@dimforge/rapier3d-compat';
import type { ImpulseJoint, ImpulseJointSet, JointAxis } from '@dimforge/rapier3d-compat';

export type Rapier = typeof RapierModule;

let rapierReady: Promise<Rapier> | null = null;

/**
 * Load and initialise Rapier once per process. The dynamic import keeps the ~2 MB module (its wasm
 * is embedded, nothing is fetched) out of the main bundle until the first disaster.
 */
export function loadRapier(): Promise<Rapier> {
  rapierReady ??= import('@dimforge/rapier3d-compat').then(async (rapier) => {
    await rapier.init();
    return rapier;
  });
  return rapierReady;
}

type RawJointSet = ImpulseJointSet['raw'];
type RawAxis = Parameters<RawJointSet['jointConfigureMotorPosition']>[1];
type RawMotorModel = Parameters<RawJointSet['jointConfigureMotorModel']>[2];

/**
 * The TS wrapper has no per-axis motor API for generic joints, but the raw joint set does. Its wasm
 * enums are not re-exported; their values are identical to the public JointAxis / MotorModel enums.
 */
export function configureAxisSpring(
  R: Rapier,
  set: ImpulseJointSet,
  joint: ImpulseJoint,
  axis: JointAxis,
  target: number,
  stiffness: number,
  damping: number,
) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- identical wasm enum, see above
  const rawAxis = axis as unknown as RawAxis;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- identical wasm enum, see above
  const model = R.MotorModel.AccelerationBased as unknown as RawMotorModel;
  set.raw.jointConfigureMotorModel(joint.handle, rawAxis, model);
  set.raw.jointConfigureMotorPosition(joint.handle, rawAxis, target, stiffness, damping);
}

export const isLinear = (R: Rapier, a: JointAxis) =>
  a === R.JointAxis.LinX || a === R.JointAxis.LinY || a === R.JointAxis.LinZ;
