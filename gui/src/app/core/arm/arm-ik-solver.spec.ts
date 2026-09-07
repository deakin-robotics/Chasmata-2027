import { ArmIkSolver } from './arm-ik-solver';

const SIX_JOINT_URDF = `
  <robot name="test_arm">
    <link name="base_link" />
    <joint name="base_joint" type="revolute">
      <parent link="base_link" /><child link="base_rot" />
      <origin xyz="0 0 0.05" /><axis xyz="0 0 1" />
      <limit lower="-3.14" upper="3.14" />
    </joint>
    <link name="base_rot" />
    <joint name="shoulder_joint" type="revolute">
      <parent link="base_rot" /><child link="arm1" />
      <origin xyz="0 0 0.07" /><axis xyz="1 0 0" />
      <limit lower="-0.1" upper="3.14" />
    </joint>
    <link name="arm1" />
    <joint name="elbow_joint" type="revolute">
      <parent link="arm1" /><child link="arm2" />
      <origin xyz="0 0 0.5" /><axis xyz="-1 0 0" />
      <limit lower="-0.1" upper="4.8" />
    </joint>
    <link name="arm2" />
    <joint name="yaw_joint" type="revolute">
      <parent link="arm2" /><child link="yaw" />
      <origin xyz="0 0 0.6" /><axis xyz="0 -1 0" />
      <limit lower="-1.65" upper="3.14" />
    </joint>
    <link name="yaw" />
    <joint name="pitch_joint" type="revolute">
      <parent link="yaw" /><child link="pitch" />
      <origin xyz="0 0 0.05" /><axis xyz="1 0 0" />
      <limit lower="-0.1" upper="4.8" />
    </joint>
    <link name="pitch" />
    <joint name="roll_joint" type="revolute">
      <parent link="pitch" /><child link="roll" />
      <origin xyz="0 0 -0.075" /><axis xyz="0 0 1" />
      <limit lower="-3.14" upper="3.14" />
    </joint>
    <link name="roll" />
    <joint name="ee_joint" type="fixed">
      <parent link="roll" /><child link="ee_link" />
      <origin xyz="0 0 -0.1" />
    </joint>
    <link name="ee_link" />
  </robot>
`;

describe('ArmIkSolver', () => {
  it('loads a six-joint URDF and solves its current pose', () => {
    const solver = new ArmIkSolver();
    solver.loadUrdf(SIX_JOINT_URDF);

    expect(solver.jointNames()).toEqual([
      'base_joint',
      'shoulder_joint',
      'elbow_joint',
      'yaw_joint',
      'pitch_joint',
      'roll_joint',
    ]);
    expect(solver.jointLimits()['shoulder_joint']).toEqual({
      lower: -0.1,
      upper: 3.14,
    });

    const result = solver.solve(solver.endEffectorPose());

    expect(result.status).toBe('converged');
    expect(Object.keys(result.jointAngles)).toHaveLength(6);
  });
});
