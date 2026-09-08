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
} from './arm-ik-types';

export const DEFAULT_ARM_URDF_URL = '/assets/kinematics/arm.urdf';
export const ARM_END_EFFECTOR_LINK = 'ee_link';

// closed-chain-ik publishes these as ambient const enums, which cannot be
// consumed from an Angular isolated-modules build. Their runtime values are
// stable and documented by the library.
const DOF_X = 0;
const DOF_Y = 1;
const DOF_Z = 2;
const DOF_EX = 3;
const DOF_EY = 4;
const DOF_EZ = 5;
const SOLVE_CONVERGED = 0;
const SOLVE_STALLED = 1;
const SOLVE_DIVERGED = 2;
const SOLVE_TIMEOUT = 3;

type LoadedRobot = ReturnType<URDFLoader['parse']>;
type LoadedJoint = LoadedRobot['joints'][string];

interface LoadedArm {
  readonly robot: LoadedRobot;
  readonly ikRoot: ReturnType<typeof urdfRobotToIKRoot>;
  readonly endEffector: Link;
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
export class ArmIkSolver {
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
    const position: number[] = [];
    const orientation: number[] = [];

    model.ikRoot.updateMatrixWorld();
    model.endEffector.getWorldPosition(position);
    model.endEffector.getWorldQuaternion(orientation);

    return {
      position: this.toPosition(position),
      orientation: this.toQuaternion(orientation),
    };
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

    const endEffector = ikRoot.find((frame) => frame.name === ARM_END_EFFECTOR_LINK) as Link | null;
    if (!endEffector?.isLink) {
      throw new Error(`The URDF must contain an end-effector link named ${ARM_END_EFFECTOR_LINK}.`);
    }

    const goal = new Goal();
    goal.setGoalDoF(DOF_X, DOF_Y, DOF_Z, DOF_EX, DOF_EY, DOF_EZ);
    goal.makeClosure(endEffector);

    const solver = new Solver(ikRoot);
    solver.maxIterations = 100;

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
