import { Service, signal } from '@angular/core';
import URDFLoader from 'urdf-loader';
import {
  Goal,
  Link,
  Solver,
  setIKFromUrdf,
  setUrdfFromIK,
  urdfRobotToIKRoot,
} from 'closed-chain-ik';

import {
  ArmIkPose,
  ArmIkSolveResult,
  ArmIkSolveStatus,
  ArmJointLimit,
  ArmPosition,
  ArmQuaternion,
} from '../arm-ik-types';

export const DEFAULT_ARM_URDF_URL = '/assets/kinematics/arm.urdf';
export const ARM_END_EFFECTOR_LINK = 'ee_link';
export const ARM_J4_PIVOT_LINK = 'j4_pivot_link';

// closed-chain-ik publishes these as ambient const enums, which cannot be
// consumed from an Angular isolated-modules build. Their runtime values are
// stable and documented by the library.
const DOF_X = 0;
const DOF_Y = 1;
const DOF_Z = 2;
const SOLVE_CONVERGED = 0;
const SOLVE_STALLED = 1;
const SOLVE_DIVERGED = 2;
const SOLVE_TIMEOUT = 3;
const SOLVER_DIVERGE_THRESHOLD = 0.1;

type LoadedRobot = ReturnType<URDFLoader['parse']>;
type LoadedJoint = LoadedRobot['joints'][string];

interface LoadedArm {
  readonly robot: LoadedRobot;
  readonly ikRoot: ReturnType<typeof urdfRobotToIKRoot>;
  readonly endEffector: Link;
  readonly j4Pivot: Link;
  readonly goal: Goal;
  readonly solver: Solver;
  readonly jointNames: readonly string[];
}

/**
 * Browser-side inverse kinematics for the arm model.
 *
 * This service owns the URDF and IK library objects. It does not publish ROS
 * commands; callers can pass the returned joint angles to the future arm
 * command interface after the rover-side limit check is available.
 */
@Service()
export class ArmClosedChainIkProvider {
  private readonly loader = new URDFLoader();
  private readonly modelState = signal<LoadedArm | null>(null);

  readonly loaded = this.modelState.asReadonly();

  /** Loads the six-joint arm URDF from the GUI's public assets. */
  async load(url = DEFAULT_ARM_URDF_URL): Promise<void> {
    const robot = await new Promise<LoadedRobot>((resolve, reject) => {
      this.loader.load(url, resolve, undefined, () =>
        reject(new Error(`Unable to load arm URDF: ${url}`)),
      );
    });
    this.loadRobot(robot);
  }

  /** Loads a URDF string. This is useful for tests and future model loading. */
  loadUrdf(urdf: string): void {
    this.loadRobot(this.loader.parse(urdf));
  }

  /** Names of the movable joints present in the loaded URDF. */
  jointNames(): readonly string[] {
    return this.requireModel().jointNames;
  }

  /** Returns URDF limits in radians for the movable joints. */
  jointLimits(): Readonly<Record<string, ArmJointLimit>> {
    const model = this.requireModel();
    return Object.fromEntries(
      model.jointNames.map((name) => {
        const joint = model.robot.joints[name];
        return [name, { lower: Number(joint.limit.lower), upper: Number(joint.limit.upper) }];
      }),
    );
  }

  /** Seeds the solver with the latest measured or commanded joint angles. */
  setJointAngles(jointAngles: Readonly<Record<string, number>>): void {
    const model = this.requireModel();

    for (const name of model.jointNames) {
      const angle = jointAngles[name];
      if (angle !== undefined && Number.isFinite(angle)) {
        model.robot.setJointValue(name, angle);
      }
    }

    setIKFromUrdf(model.ikRoot, model.robot);
  }

  /** Returns the current end-effector pose from the IK model. */
  endEffectorPose(): ArmIkPose {
    const model = this.requireModel();
    return this.poseForLinks(model.endEffector, model.endEffector);
  }

  /** Returns the J4 pivot position with the current EE orientation. */
  j4PivotPose(): ArmIkPose {
    const model = this.requireModel();
    return this.poseForLinks(model.j4Pivot, model.endEffector);
  }

  /** Solves for the joint angles needed to reach a target pose. */
  solve(target: ArmIkPose): ArmIkSolveResult {
    const model = this.requireModel();
    this.validatePose(target);

    model.goal.setPosition(...target.position);
    model.goal.setQuaternion(...target.orientation);

    const statuses = model.solver.solve();
    const status = statuses.at(-1) ?? SOLVE_TIMEOUT;

    setUrdfFromIK(model.robot, model.ikRoot);

    return {
      status: this.toSolveStatus(status),
      jointAngles: this.readJointAngles(model),
    };
  }

  private loadRobot(robot: LoadedRobot): void {
    const ikRoot = urdfRobotToIKRoot(robot, false);
    if (!ikRoot) {
      throw new Error('The URDF did not produce an IK root.');
    }

    // urdfRobotToIKRoot adds a free six-DOF world joint. The rover arm is
    // mounted to a fixed base, and only the named arm joints are sent to it.
    // Locking this synthetic root prevents the solver from reaching a target
    // by translating or rotating the entire arm outside the command payload.
    (ikRoot as unknown as { clearDoF(): void }).clearDoF();

    const endEffector = ikRoot.find((frame) => frame.name === ARM_END_EFFECTOR_LINK) as Link | null;
    if (!endEffector?.isLink) {
      throw new Error(`The URDF must contain an end-effector link named ${ARM_END_EFFECTOR_LINK}.`);
    }

    // Older test URDFs do not have the explicit pivot frame yet. The yaw link
    // is coincident with the J4 pivot, so it is a safe compatibility fallback.
    const j4Pivot = (
      ikRoot.find((frame) => frame.name === ARM_J4_PIVOT_LINK) ??
      ikRoot.find((frame) => frame.name === 'yaw')
    ) as Link | null;
    if (!j4Pivot?.isLink) {
      throw new Error(`The URDF must contain a J4 pivot link named ${ARM_J4_PIVOT_LINK}.`);
    }

    const goal = new Goal();
    // The in-house fallback keeps its original EE-position target. Its
    // orientation is intentionally free so the fixed-base solver can choose a
    // reachable joint configuration instead of stalling on an unnecessary
    // orientation constraint. Only MoveIt2 uses the J4-pivot target.
    goal.setGoalDoF(DOF_X, DOF_Y, DOF_Z);
    goal.makeClosure(endEffector);

    const solver = new Solver(ikRoot);
    solver.maxIterations = 100;
    // The library's default threshold is tuned for a free-floating root. With
    // the rover base fixed, a normal first correction can temporarily increase
    // the residual before converging, so do not reject that correction as a
    // divergent solve.
    solver.divergeThreshold = SOLVER_DIVERGE_THRESHOLD;

    const jointNames = Object.entries(robot.joints)
      .filter(([, joint]) => this.isMovableJoint(joint))
      .map(([name]) => name);

    if (jointNames.length !== 6) {
      throw new Error(`Expected six movable arm joints, found ${jointNames.length}.`);
    }

    setIKFromUrdf(ikRoot, robot);
    this.modelState.set({
      robot,
      ikRoot,
      endEffector,
      j4Pivot,
      goal,
      solver,
      jointNames,
    });
  }

  private isMovableJoint(joint: LoadedJoint): boolean {
    return joint.jointType === 'revolute' || joint.jointType === 'continuous';
  }

  private readJointAngles(model: LoadedArm): Readonly<Record<string, number>> {
    return Object.fromEntries(
      model.jointNames.map((name) => [name, Number(model.robot.joints[name].angle)]),
    );
  }

  private requireModel(): LoadedArm {
    const model = this.modelState();
    if (!model) {
      throw new Error('Load the arm URDF before using the IK solver.');
    }

    return model;
  }

  private validatePose(target: ArmIkPose): void {
    if (
      target.position.length !== 3 ||
      target.orientation.length !== 4 ||
      [...target.position, ...target.orientation].some((value) => !Number.isFinite(value))
    ) {
      throw new Error('The IK target pose must contain finite numbers.');
    }
  }

  private toPosition(values: readonly number[]): ArmPosition {
    return [values[0], values[1], values[2]];
  }

  private poseForLinks(positionLink: Link, orientationLink: Link): ArmIkPose {
    const position: number[] = [];
    const orientation: number[] = [];

    const model = this.requireModel();
    model.ikRoot.updateMatrixWorld();
    positionLink.getWorldPosition(position);
    orientationLink.getWorldQuaternion(orientation);

    return {
      position: this.toPosition(position),
      orientation: this.toQuaternion(orientation),
    };
  }

  private toQuaternion(values: readonly number[]): ArmQuaternion {
    return [values[0], values[1], values[2], values[3]];
  }

  private toSolveStatus(status: number): ArmIkSolveStatus {
    switch (status) {
      case SOLVE_CONVERGED:
        return 'converged';
      case SOLVE_STALLED:
        return 'stalled';
      case SOLVE_DIVERGED:
        return 'diverged';
      case SOLVE_TIMEOUT:
      default:
        return 'timeout';
    }
  }
}
