import { ComponentFixture, TestBed } from '@angular/core/testing';
import * as Three from 'three';

import { ArmIkCoordinator } from '../../../core/arm/ik/arm-ik-coordinator';
import { ArmViewModeService } from '../../../core/arm/arm-view-mode';
import { GamepadSnapshot } from '../../../core/gamepad/gamepad-input';
import { ArmMode } from '../../../core/fma/fma-state.service';
import { ArmControlModeService } from '../../../core/control/arm/arm-control-mode';
import { ArmModelViewer } from './arm-model-viewer';

describe('ArmModelViewer', () => {
  let fixture: ComponentFixture<ArmModelViewer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArmModelViewer],
    }).compileComponents();

    fixture = TestBed.createComponent(ArmModelViewer);
    fixture.detectChanges();
  });

  it('should render the model viewer shell', () => {
    expect(fixture.nativeElement.querySelector('[aria-label="Arm 3D model viewer"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.scene-host')).toBeTruthy();
  });

  it('should show the unavailable overlay without rendering while ROS is disconnected', () => {
    expect(fixture.componentInstance.rosConnected()).toBe(false);
    expect(fixture.componentInstance.ikStatus()).toBe('idle');
    expect(fixture.nativeElement.querySelector('app-unavailable-overlay')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.viewer-status')?.textContent).toContain(
      '3D: UNAVAILABLE',
    );
    expect(fixture.nativeElement.querySelector('.ik-status')?.textContent).toContain('IK: —');
    expect(fixture.nativeElement.querySelector('.orientation-mode-status')?.textContent).toContain(
      'MODE: —',
    );
    expect(fixture.nativeElement.querySelector('.viewer-status-error')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('canvas')).toBeFalsy();
  });

  it('should show a telemetry spinner without rendering the digital twin', () => {
    fixture.componentInstance.status.set('waiting-telemetry');
    fixture.componentInstance.statusMessage.set('Waiting for arm telemetry');
    fixture.detectChanges();

    expect(fixture.componentInstance.viewerStatusLabel()).toBe('WAITING FOR TELEMETRY');
    expect(fixture.nativeElement.querySelector('.viewer-waiting')?.textContent).toContain(
      'Waiting for arm telemetry',
    );
    expect(fixture.nativeElement.querySelector('canvas')).toBeFalsy();
  });

  it('should show the current camera view only when the twin is ready', () => {
    const viewMode = TestBed.inject(ArmViewModeService);
    const viewer = fixture.componentInstance;

    expect(fixture.nativeElement.querySelector('.viewer-view-mode')).toBeFalsy();

    viewer.status.set('ready');
    viewMode.set('top');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.viewer-view-mode')?.textContent.trim()).toBe('TOP');

    viewMode.set('side');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.viewer-view-mode')?.textContent.trim()).toBe('SIDE');

    viewMode.setFree();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.viewer-view-mode')?.textContent.trim()).toBe('FREE');

    viewer.status.set('waiting-telemetry');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.viewer-view-mode')).toBeFalsy();
  });

  it('should hide the target marker when the actual marker reaches it', () => {
    TestBed.inject(ArmIkCoordinator).setPosition([0, 0, 0]);

    let distance = 0.01;
    const viewer = fixture.componentInstance as unknown as {
      targetMarker: {
        visible: boolean;
        position: { distanceTo: (other: unknown) => number };
        material: { opacity: number };
      } | null;
      actualMarker: { position: object } | null;
      updateTargetMarkerVisibility: () => void;
      animateTargetMarker: (now?: number) => void;
      targetMarkerFadeStartedAtMs: number | null;
    };

    viewer.targetMarker = {
      visible: true,
      position: { distanceTo: () => distance },
      material: { opacity: 1 },
    };
    viewer.actualMarker = { position: {} };

    viewer.updateTargetMarkerVisibility();
    expect(viewer.targetMarker.visible).toBe(true);
    expect(viewer.targetMarker.material.opacity).toBe(1);

    const fadeStartedAtMs = viewer.targetMarkerFadeStartedAtMs ?? 0;
    viewer.animateTargetMarker(fadeStartedAtMs + 125);
    expect(viewer.targetMarker.material.opacity).toBeCloseTo(0.5);

    viewer.animateTargetMarker(fadeStartedAtMs + 250);
    expect(viewer.targetMarker.material.opacity).toBe(0);
    expect(viewer.targetMarker.visible).toBe(false);

    distance = 0.03;
    viewer.updateTargetMarkerVisibility();
    expect(viewer.targetMarker.visible).toBe(true);

    const fadeInStartedAtMs = viewer.targetMarkerFadeStartedAtMs ?? 0;
    viewer.animateTargetMarker(fadeInStartedAtMs + 50);
    expect(viewer.targetMarker.material.opacity).toBeCloseTo(0.5);

    viewer.animateTargetMarker(fadeInStartedAtMs + 100);
    expect(viewer.targetMarker.material.opacity).toBeCloseTo(1);
  });

  it('should fade the target marker out when Manual mode is selected', () => {
    TestBed.inject(ArmIkCoordinator).setPosition([0, 0, 0]);

    const viewer = fixture.componentInstance as unknown as {
      targetMarker: {
        visible: boolean;
        position: { distanceTo: (other: unknown) => number };
        material: { opacity: number };
      } | null;
      actualMarker: { position: object } | null;
      updateTargetMarkerVisibility: () => void;
      animateTargetMarker: (now?: number) => void;
      targetMarkerFadeStartedAtMs: number | null;
    };
    viewer.targetMarker = {
      visible: true,
      position: { distanceTo: () => 0.03 },
      material: { opacity: 1 },
    };
    viewer.actualMarker = { position: {} };

    const armControlMode = TestBed.inject(ArmControlModeService);
    armControlMode.setMode(ArmMode.Manual);
    viewer.updateTargetMarkerVisibility();

    const fadeStartedAtMs = viewer.targetMarkerFadeStartedAtMs ?? 0;
    viewer.animateTargetMarker(fadeStartedAtMs + 250);

    expect(viewer.targetMarker.visible).toBe(false);
    expect(viewer.targetMarker.material.opacity).toBe(0);
  });

  it('should pan the camera and target across the selected viewer plane', () => {
    const viewer = fixture.componentInstance as unknown as {
      three: typeof Three;
      camera: Three.PerspectiveCamera | null;
      controls: { target: Three.Vector3; update: () => void; dispose: () => void } | null;
      robot: Three.Object3D | null;
      panCamera: (rightStickX: number, rightStickY: number) => void;
    };
    const camera = new Three.PerspectiveCamera();
    camera.position.set(1, 2, 3);
    const controls = { target: new Three.Vector3(4, 5, 6), update: vi.fn(), dispose: vi.fn() };
    const robot = new Three.Object3D();
    robot.rotation.x = -Math.PI / 2;
    robot.updateMatrixWorld(true);
    viewer.three = Three;
    viewer.camera = camera;
    viewer.controls = controls;
    viewer.robot = robot;

    const viewMode = TestBed.inject(ArmViewModeService);
    viewMode.set('top');
    viewer.panCamera(1, 1);

    expect(camera.position.toArray()).toEqual([1.004, 2, 2.996]);
    expect(controls.target.toArray()).toEqual([4.004, 5, 5.996]);
    expect(controls.update).toHaveBeenCalledOnce();

    viewMode.set('side');
    viewer.panCamera(1, 1);

    expect(camera.position.toArray()).toEqual([1.004, 2.004, 3]);
    expect(controls.target.toArray()).toEqual([4.004, 5.004, 6]);
  });

  it('should ignore viewer panning in FREE view, Manual mode, and while LB is held', () => {
    const viewer = fixture.componentInstance as unknown as {
      camera: Three.PerspectiveCamera | null;
      controls: { target: Three.Vector3; update: () => void; dispose: () => void } | null;
      robot: Three.Object3D | null;
      shouldPanCamera: (snapshot: GamepadSnapshot | null) => boolean;
    };
    viewer.camera = new Three.PerspectiveCamera();
    viewer.controls = { target: new Three.Vector3(), update: vi.fn(), dispose: vi.fn() };
    viewer.robot = new Three.Object3D();

    const armControlMode = TestBed.inject(ArmControlModeService);
    const viewMode = TestBed.inject(ArmViewModeService);
    const buttons = Array.from({ length: 16 }, () => 0);
    const snapshot: GamepadSnapshot = {
      axes: [0, 0, 0.5, -0.5],
      buttons,
    };

    armControlMode.setMode(ArmMode.Position);
    viewMode.set('side');
    expect(viewer.shouldPanCamera(snapshot)).toBe(true);

    viewMode.setFree();
    expect(viewer.shouldPanCamera(snapshot)).toBe(false);

    viewMode.set('side');
    buttons[4] = 1;
    expect(viewer.shouldPanCamera(snapshot)).toBe(false);

    buttons[4] = 0;
    armControlMode.setMode(ArmMode.Manual);
    expect(viewer.shouldPanCamera(snapshot)).toBe(false);
  });

  it('should enter FREE only for an unmodified orbit gesture', () => {
    const viewer = fixture.componentInstance as unknown as {
      orbitPointerDown: (event: PointerEvent) => void;
    };
    const viewMode = TestBed.inject(ArmViewModeService);

    viewMode.set('top');
    viewer.orbitPointerDown({
      button: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      pointerType: 'mouse',
    } as PointerEvent);
    expect(viewMode.view()).toBe('free');

    viewMode.set('top');
    viewer.orbitPointerDown({
      button: 2,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      pointerType: 'mouse',
    } as PointerEvent);
    expect(viewMode.view()).toBe('top');
  });

  it('should center canonical camera views on the J4 pivot', () => {
    const viewer = fixture.componentInstance as unknown as {
      three: typeof Three;
      camera: Three.PerspectiveCamera | null;
      controls: { target: Three.Vector3; update: () => void; dispose: () => void } | null;
      robot: Three.Object3D & {
        links: Record<string, Three.Object3D>;
        updateMatrixWorld: (force?: boolean) => Three.Object3D;
      };
      toggleCameraView: () => void;
    };
    const robot = new Three.Object3D() as typeof viewer.robot;
    const j4Pivot = new Three.Object3D();
    const eeLink = new Three.Object3D();
    j4Pivot.position.set(0.2, 0.3, 0.4);
    eeLink.position.set(1, 1, 1);
    robot.add(j4Pivot, eeLink);
    robot.links = { j4_pivot_link: j4Pivot, ee_link: eeLink };
    robot.updateMatrixWorld(true);

    viewer.three = Three;
    viewer.camera = new Three.PerspectiveCamera();
    viewer.controls = { target: new Three.Vector3(), update: vi.fn(), dispose: vi.fn() };
    viewer.robot = robot;

    const viewMode = TestBed.inject(ArmViewModeService);
    viewMode.set('side');
    viewer.toggleCameraView();

    expect(viewer.controls.target.toArray()).toEqual([0.2, 0.3, 0.4]);
  });

  it('should initialize on the J4-pivot-centered SIDE view', () => {
    const viewer = fixture.componentInstance as unknown as {
      three: typeof Three;
      camera: Three.PerspectiveCamera | null;
      controls: { target: Three.Vector3; update: () => void; dispose: () => void } | null;
      frameInitialView: (robot: Three.Object3D) => void;
    };
    const robot = new Three.Object3D() as Three.Object3D & {
      links: Record<string, Three.Object3D>;
    };
    const j4Pivot = new Three.Object3D();
    j4Pivot.position.set(0.2, 0.3, 0.4);
    robot.add(j4Pivot);
    robot.links = { j4_pivot_link: j4Pivot };
    robot.updateMatrixWorld(true);

    viewer.three = Three;
    viewer.camera = new Three.PerspectiveCamera();
    viewer.controls = { target: new Three.Vector3(), update: vi.fn(), dispose: vi.fn() };
    viewer.frameInitialView(robot);

    expect(viewer.controls.target.toArray()).toEqual([0.2, 0.3, 0.4]);
    expect(viewer.camera.position.x).toBeLessThan(0.2);
    expect(viewer.camera.position.y).toBeGreaterThan(0.3);
    expect(viewer.camera.position.z).toBeCloseTo(0.4);
    expect(TestBed.inject(ArmViewModeService).view()).toBe('side');
  });
});
