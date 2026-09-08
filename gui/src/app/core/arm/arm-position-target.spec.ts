import { ArmPositionTargetService } from './arm-position-target';

describe('ArmPositionTargetService', () => {
  it('starts with a neutral target position', () => {
    const target = new ArmPositionTargetService();

    expect(target.position()).toEqual([0, 0, 0]);
  });

  it('stores a copy of a new target position', () => {
    const target = new ArmPositionTargetService();
    const position = [0.2, -0.1, 0.4] as const;

    target.setPosition(position);

    expect(target.position()).toEqual(position);
    expect(target.position()).not.toBe(position);
  });

  it('can seed the target from a current arm pose', () => {
    const target = new ArmPositionTargetService();

    target.setFromPose({
      position: [0.1, 0.2, 0.3],
      orientation: [0, 0, 0, 1],
    });

    expect(target.position()).toEqual([0.1, 0.2, 0.3]);
  });

  it('translates the current target', () => {
    const target = new ArmPositionTargetService();
    target.setPosition([0.2, 0.3, 0.4]);

    target.translate([-0.1, 0.05, 0.2]);

    expect(target.position()[0]).toBeCloseTo(0.1);
    expect(target.position()[1]).toBeCloseTo(0.35);
    expect(target.position()[2]).toBeCloseTo(0.6);
  });

  it('rejects invalid target coordinates', () => {
    const target = new ArmPositionTargetService();

    expect(() => target.setPosition([0, Number.NaN, 0])).toThrow(
      'The arm position target must contain three finite coordinates.',
    );
  });
});
