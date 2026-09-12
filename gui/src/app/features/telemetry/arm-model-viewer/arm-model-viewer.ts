import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type * as Three from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type URDFLoader from 'urdf-loader';
import type { URDFRobot } from 'urdf-loader/src/URDFClasses';

import { ArmIkCoordinator } from '../../../core/arm/ik/arm-ik-coordinator';
import { ArmPosition } from '../../../core/arm/ik/arm-ik-types';
import { ArmTelemetryService } from '../../../core/arm/telemetry/arm-telemetry.service';
import { ArmViewModeService } from '../../../core/arm/arm-view-mode';
import { ArmControlModeService } from '../../../core/control/arm/arm-control-mode';
import { GamepadInput } from '../../../core/gamepad/gamepad-input';
import { RosConnection } from '../../../core/ros/ros-connection';
import { UnavailableOverlay } from '../../../shared/unavailable-overlay/unavailable-overlay';

const ARM_URDF_URL = '/assets/kinematics/arm.urdf';
const ARM_MODEL_COLOR = '#697482';
const ARM_TARGET_COLOR = '#62a8e5';
const ARM_ACTUAL_COLOR = '#62c77a';
const GRID_SIZE = 1.4;
const INITIAL_VIEW_DISTANCE_SCALE = 1.5;
const CAMERA_VIEW_DISTANCE_SCALE = 1.75;
const RIGHT_BUMPER_BUTTON_INDEX = 5;
const ARM_TELEMETRY_STALE_AFTER_MS = 500;
const ARM_TARGET_REACHED_TOLERANCE = 0.01;
const ARM_TARGET_MARKER_FADE_IN_MS = 100;
const ARM_TARGET_MARKER_FADE_OUT_MS = 250;

type ViewerStatus = 'unavailable' | 'loading' | 'waiting-telemetry' | 'ready' | 'error';
type ThreeModule = typeof import('three');

/** Renders the arm URDF and rover feedback in a Three.js scene. */
@Component({
  selector: 'app-arm-model-viewer',
  imports: [MatIconModule, UnavailableOverlay],
  templateUrl: './arm-model-viewer.html',
  styleUrl: './arm-model-viewer.scss',
})
export class ArmModelViewer implements AfterViewInit, OnDestroy {
  private readonly armIkCoordinator = inject(ArmIkCoordinator);
  private readonly armTelemetry = inject(ArmTelemetryService);
  private readonly armViewMode = inject(ArmViewModeService);
  private readonly armControlMode = inject(ArmControlModeService);
  private readonly gamepad = inject(GamepadInput);
  private readonly rosConnection = inject(RosConnection);

  @ViewChild('sceneHost', { static: true })
  private readonly sceneHost?: ElementRef<HTMLDivElement>;

  readonly status = signal<ViewerStatus>('unavailable');
  readonly statusMessage = signal('Unavailable');
  readonly telemetryStale = signal(false);
  readonly viewerStatusLabel = computed(() => {
    switch (this.status()) {
      case 'loading':
        return 'LOADING';
      case 'waiting-telemetry':
        return 'WAITING FOR TELEMETRY';
      case 'ready':
        return this.telemetryStale() ? 'STALE' : 'READY';
      case 'error':
        return 'ERROR';
      default:
        return 'UNAVAILABLE';
    }
  });
  readonly ikStatus = this.armIkCoordinator.status;
  readonly ikStatusLabel = this.armIkCoordinator.statusLabel;
  readonly orientationMode = this.armIkCoordinator.orientationMode;
  readonly executionStatus = this.armIkCoordinator.executionStatus;
  readonly executionStatusLabel = computed(() => {
    switch (this.executionStatus()) {
      case 'planning':
        return 'PLANNING';
      case 'executing':
        return 'EXECUTING';
      case 'succeeded':
        return 'DONE';
      case 'canceled':
        return 'CANCELED';
      case 'failed':
        return 'FAILED';
      default:
        return 'WAITING';
    }
  });
  readonly rosConnected = this.rosConnection.isConnected;

  private three: ThreeModule | null = null;
  private loader: URDFLoader | null = null;
  private orbitControlsConstructor: typeof OrbitControls | null = null;
  private scene: Three.Scene | null = null;
  private camera: Three.PerspectiveCamera | null = null;
  private renderer: Three.WebGLRenderer | null = null;
  private controls: OrbitControls | null = null;
  private robot: URDFRobot | null = null;
  private pendingRobot: URDFRobot | null = null;
  private groundGrid: Three.GridHelper | null = null;
  private targetMarker: Three.Mesh | null = null;
  private actualMarker: Three.Mesh | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private telemetryStaleTimer: ReturnType<typeof setTimeout> | null = null;
  private animationFrame: number | null = null;
  private rightBumperPressed = false;
  private initializing = false;
  private destroyed = false;
  private targetMarkerFadeStartedAtMs: number | null = null;
  private targetMarkerFadeStartOpacity = 1;
  private targetMarkerFadeTargetOpacity = 1;

  private readonly connectionEffect = effect(() => {
    if (this.rosConnected()) {
      this.status.set('loading');
      this.statusMessage.set('Loading arm model');
      this.startViewer();
      return;
    }

    this.disposeViewer();
    this.status.set('unavailable');
    this.statusMessage.set('Unavailable');
  });

  private readonly targetEffect = effect(() => {
    const targetPosition = this.armIkCoordinator.position();
    if (targetPosition) this.updateTargetMarkerPosition(targetPosition);

    this.tryRenderPendingRobot();
  });

  private readonly armModeEffect = effect(() => {
    this.armControlMode.mode();
    this.updateTargetMarkerVisibility();
  });

  private readonly telemetryEffect = effect(() => {
    const actualJointAngles = this.armTelemetry.actualJointAngles();

    this.tryRenderPendingRobot();

    if (!actualJointAngles || !this.robot) return;

    this.applyActualJointAngles(actualJointAngles);
    this.refreshTelemetryWatchdog();
  });

  private readonly rightBumperEffect = effect(() => {
    const snapshot = this.gamepad.snapshot();
    const pressed = (snapshot?.buttons[RIGHT_BUMPER_BUTTON_INDEX] ?? 0) > 0.5;

    if (pressed && !this.rightBumperPressed && this.robot) {
      this.toggleCameraView();
    }

    this.rightBumperPressed = pressed;
  });

  ngAfterViewInit(): void {
    this.startViewer();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.disposeViewer();
  }

  private readonly resizeScene = (): void => {
    const host = this.sceneHost?.nativeElement;
    const renderer = this.renderer;
    const camera = this.camera;
    if (!host || !renderer || !camera) return;

    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    renderer.setSize(width, height, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  private startViewer(): void {
    if (
      !this.rosConnected() ||
      this.destroyed ||
      this.initializing ||
      this.renderer ||
      !this.sceneHost
    ) {
      return;
    }

    this.initializing = true;
    void this.initializeViewer().finally(() => {
      this.initializing = false;
    });
  }

  private async initializeViewer(): Promise<void> {
    try {
      if (typeof WebGLRenderingContext === 'undefined') {
        throw new Error('3D rendering unavailable');
      }

      const [three, controlsModule, urdfModule] = await Promise.all([
        import('three'),
        import('three/examples/jsm/controls/OrbitControls.js'),
        import('urdf-loader'),
      ]);

      if (this.destroyed || !this.rosConnected()) return;

      this.three = three;
      this.orbitControlsConstructor = controlsModule.OrbitControls;
      this.loader = new urdfModule.default();
      this.createScene();
      this.observeResize();
      this.animate();

      await this.armIkCoordinator.load(ARM_URDF_URL);
      if (this.destroyed || !this.rosConnected()) return;

      if (!this.armIkCoordinator.position()) {
        this.status.set('waiting-telemetry');
        this.statusMessage.set('Waiting for arm telemetry');
      }
      this.loadArmModel();
    } catch {
      if (this.destroyed || !this.rosConnected()) return;

      this.disposeViewer();
      this.status.set('error');
      this.statusMessage.set('3D viewer failed to initialize');
    }
  }

  private createScene(): void {
    const host = this.sceneHost?.nativeElement;
    const three = this.three;
    const OrbitControlsConstructor = this.orbitControlsConstructor;
    if (!host || !three || !OrbitControlsConstructor) {
      throw new Error('3D viewer dependencies are unavailable');
    }

    const scene = new three.Scene();
    const camera = new three.PerspectiveCamera(35, 1, 0.01, 100);
    const renderer = new three.WebGLRenderer({ antialias: true, alpha: true });
    const controls = new OrbitControlsConstructor(camera, renderer.domElement);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = three.sRGBEncoding;

    camera.position.set(1.5, 1.2, 1.5);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);

    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.35;
    controls.maxDistance = 5;

    scene.add(new three.AmbientLight(0xffffff, 1));

    const keyLight = new three.DirectionalLight(0xffffff, 1.4);
    keyLight.position.set(2, 3, 3);
    scene.add(keyLight);

    const fillLight = new three.DirectionalLight(0x9fc7ff, 0.6);
    fillLight.position.set(-2, 1, -2);
    scene.add(fillLight);

    renderer.domElement.setAttribute('aria-hidden', 'true');
    host.appendChild(renderer.domElement);

    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.resizeScene();

    // The host can receive its final grid size only after this view has been
    // inserted into the dashboard. Resize again after that layout pass.
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(this.resizeScene);
    }
  }

  private observeResize(): void {
    const host = this.sceneHost?.nativeElement;
    if (!host) return;

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.resizeScene);
      this.resizeObserver.observe(host);
      return;
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.resizeScene);
    }
  }

  private loadArmModel(): void {
    const loader = this.loader;
    if (!loader) return;

    loader.load(
      ARM_URDF_URL,
      (robot) => this.onArmModelLoaded(robot),
      undefined,
      () => {
        if (this.destroyed || !this.rosConnected()) return;

        this.status.set('error');
        this.statusMessage.set('Unable to load arm model');
      },
    );
  }

  private onArmModelLoaded(robot: URDFRobot): void {
    if (this.destroyed || !this.rosConnected() || !this.scene) {
      this.disposeRobot(robot);
      return;
    }

    this.pendingRobot = robot;
    this.tryRenderPendingRobot();
  }

  private tryRenderPendingRobot(): void {
    const robot = this.pendingRobot;
    const actualJointAngles = this.armTelemetry.actualJointAngles();

    if (
      !robot ||
      !this.scene ||
      !this.armIkCoordinator.position() ||
      !actualJointAngles ||
      !this.hasPivotJointState(actualJointAngles)
    ) {
      return;
    }

    this.pendingRobot = null;
    this.robot = robot;
    robot.rotation.x = -Math.PI / 2;
    this.styleRobot(robot);
    this.scene.add(robot);

    this.applyActualJointAngles(actualJointAngles);

    this.frameInitialView(robot);
    this.addGroundGrid(robot);
    this.addTargetMarker(robot);
    this.addActualMarker(robot);

    this.status.set('ready');
    this.statusMessage.set('Ready');
    this.telemetryStale.set(false);
    this.refreshTelemetryWatchdog();
  }

  private frameInitialView(robot: URDFRobot): void {
    const camera = this.camera;
    const controls = this.controls;
    const three = this.three;
    if (!camera || !controls || !three) return;

    robot.updateMatrixWorld(true);
    const bounds = this.getModelBounds(robot);
    const size = bounds.getSize(new three.Vector3());
    const distance = Math.max(size.x, size.y, size.z, 0.1) * INITIAL_VIEW_DISTANCE_SCALE;
    const target = this.getBaseVisualPosition(robot);

    camera.near = Math.max(distance / 100, 0.001);
    camera.far = Math.max(distance * 20, 10);
    camera.up.set(0, 1, 0);
    camera.position.set(
      target.x - distance * 0.95,
      target.y + distance * 0.85,
      target.z + distance * 1.15,
    );
    camera.lookAt(target);
    controls.target.copy(target);
    controls.update();
    camera.updateProjectionMatrix();
    this.armViewMode.set('side');
  }

  private toggleCameraView(): void {
    const robot = this.robot;
    const camera = this.camera;
    const controls = this.controls;
    const three = this.three;
    if (!robot || !camera || !controls || !three) return;

    const target = this.getEndEffectorPosition(robot);
    if (!target) return;

    const bounds = this.getModelBounds(robot);
    const size = bounds.getSize(new three.Vector3());
    const distance = Math.max(size.x, size.y, size.z, 0.1) * CAMERA_VIEW_DISTANCE_SCALE;
    const nextView = this.armViewMode.toggle();

    camera.near = Math.max(distance / 100, 0.001);
    camera.far = Math.max(distance * 20, 10);

    if (nextView === 'top') {
      camera.up.set(0, 0, -1);
      camera.position.set(target.x, target.y + distance, target.z);
    } else {
      camera.up.set(0, 1, 0);
      camera.position.set(target.x - distance, target.y + distance * 0.2, target.z);
    }

    camera.lookAt(target);
    controls.target.copy(target);
    controls.update();
    camera.updateProjectionMatrix();
  }

  private getBaseVisualPosition(robot: URDFRobot): Three.Vector3 {
    const three = this.three;
    const baseLink = robot.links['base_link'] ?? robot;
    const baseVisual = baseLink.children.find((child) => child.type === 'URDFVisual');
    const position = new three!.Vector3();
    (baseVisual ?? baseLink).getWorldPosition(position);
    return position;
  }

  private getEndEffectorPosition(robot: URDFRobot): Three.Vector3 | null {
    const endEffector = robot.links['ee_link'];
    if (!endEffector || !this.three) return null;

    robot.updateMatrixWorld(true);
    const position = new this.three.Vector3();
    endEffector.getWorldPosition(position);
    return position;
  }

  private getModelBounds(robot: URDFRobot): Three.Box3 {
    const three = this.three;
    const bounds = new three!.Box3();

    robot.traverse((object) => {
      if (object === this.targetMarker || object === this.actualMarker) return;
      if (!('geometry' in object) || !('material' in object)) return;

      const mesh = object as Three.Mesh;
      mesh.geometry.computeBoundingBox();
      if (!mesh.geometry.boundingBox) return;

      bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
    });

    return bounds.isEmpty() ? new three!.Box3().setFromObject(robot) : bounds;
  }

  private addGroundGrid(robot: URDFRobot): void {
    const scene = this.scene;
    const three = this.three;
    if (!scene || !three) return;

    const grid = new three.GridHelper(GRID_SIZE, 14, 0x405064, 0x263341);
    const bounds = this.getModelBounds(robot);
    const basePosition = this.getBaseVisualPosition(robot);
    grid.position.set(basePosition.x, bounds.min.y, basePosition.z);
    scene.add(grid);
    this.groundGrid = grid;
  }

  private addTargetMarker(robot: URDFRobot): void {
    const three = this.three;
    const targetPosition = this.armIkCoordinator.position();
    if (!three || !targetPosition) return;

    const marker = new three.Mesh(
      new three.SphereGeometry(0.035, 20, 12),
      new three.MeshBasicMaterial({
        color: new three.Color(ARM_TARGET_COLOR).convertSRGBToLinear(),
        transparent: true,
      }),
    );
    marker.name = 'arm-position-target';
    robot.add(marker);
    this.targetMarker = marker;
    this.targetMarkerFadeStartedAtMs = null;
    this.targetMarkerFadeStartOpacity = 1;
    this.targetMarkerFadeTargetOpacity = 1;
    this.updateTargetMarkerPosition(targetPosition);
  }

  private addActualMarker(robot: URDFRobot): void {
    const three = this.three;
    if (!three) return;

    const marker = new three.Mesh(
      new three.SphereGeometry(0.035, 20, 12),
      new three.MeshBasicMaterial({
        color: new three.Color(ARM_ACTUAL_COLOR).convertSRGBToLinear(),
      }),
    );
    marker.name = 'arm-position-actual';
    robot.add(marker);
    this.actualMarker = marker;
    this.updateActualMarkerPosition(robot);
  }

  private applyActualJointAngles(jointAngles: Readonly<Record<string, number>>): void {
    if (!this.robot) return;

    for (const [name, angle] of Object.entries(jointAngles)) {
      if (Number.isFinite(angle)) this.robot.setJointValue(name, angle);
    }

    this.robot.updateMatrixWorld(true);
    this.updateActualMarkerPosition(this.robot);
  }

  private hasPivotJointState(jointAngles: Readonly<Record<string, number>>): boolean {
    return ['base_joint', 'shoulder_joint', 'elbow_joint'].every((name) =>
      Number.isFinite(jointAngles[name]),
    );
  }

  private updateTargetMarkerPosition(targetPosition: ArmPosition): void {
    const marker = this.targetMarker;
    if (!marker) return;

    // The coordinator target is already expressed in the robot's URDF-local
    // base frame. The robot root rotation is applied automatically when the
    // marker is rendered, so converting it from world space would rotate it a
    // second time.
    marker.position.set(...targetPosition);
    this.updateTargetMarkerVisibility();
  }

  private refreshTelemetryWatchdog(): void {
    if (!this.robot || !this.rosConnected()) return;

    this.telemetryStale.set(false);
    this.clearTelemetryWatchdog();
    this.telemetryStaleTimer = setTimeout(() => {
      if (this.robot && this.rosConnected()) this.telemetryStale.set(true);
    }, ARM_TELEMETRY_STALE_AFTER_MS);
  }

  private updateActualMarkerPosition(robot: URDFRobot): void {
    const marker = this.actualMarker;
    const targetLink = robot.links[this.armIkCoordinator.targetFrame()];
    if (!marker || !targetLink) return;

    robot.updateMatrixWorld(true);
    const position = new this.three!.Vector3();
    targetLink.getWorldPosition(position);
    robot.worldToLocal(position);
    marker.position.copy(position);
    this.updateTargetMarkerVisibility();
  }

  private updateTargetMarkerVisibility(): void {
    const targetMarker = this.targetMarker;
    const actualMarker = this.actualMarker;
    if (!targetMarker || !actualMarker) return;

    const targetPosition = this.armIkCoordinator.position();
    const targetOpacity =
      this.armControlMode.isPosition() &&
      targetPosition &&
      targetMarker.position.distanceTo(actualMarker.position) > ARM_TARGET_REACHED_TOLERANCE
        ? 1
        : 0;

    if (this.targetMarkerFadeTargetOpacity === targetOpacity) return;

    const material = targetMarker.material as Three.MeshBasicMaterial;
    this.targetMarkerFadeStartOpacity = material.opacity;
    this.targetMarkerFadeTargetOpacity = targetOpacity;
    this.targetMarkerFadeStartedAtMs = performance.now();
    targetMarker.visible = true;
  }

  private animateTargetMarker(now = performance.now()): void {
    const marker = this.targetMarker;
    const fadeStartedAtMs = this.targetMarkerFadeStartedAtMs;
    if (!marker || fadeStartedAtMs === null) return;

    const material = marker.material as Three.MeshBasicMaterial;
    const fadeDurationMs =
      this.targetMarkerFadeTargetOpacity > this.targetMarkerFadeStartOpacity
        ? ARM_TARGET_MARKER_FADE_IN_MS
        : ARM_TARGET_MARKER_FADE_OUT_MS;
    const progress = Math.min((now - fadeStartedAtMs) / fadeDurationMs, 1);
    material.opacity =
      this.targetMarkerFadeStartOpacity +
      (this.targetMarkerFadeTargetOpacity - this.targetMarkerFadeStartOpacity) * progress;

    if (progress < 1) return;

    this.targetMarkerFadeStartedAtMs = null;
    marker.visible = this.targetMarkerFadeTargetOpacity > 0;
  }

  private styleRobot(robot: URDFRobot): void {
    const three = this.three;
    if (!three) return;

    robot.traverse((object) => {
      if (!('geometry' in object) || !('material' in object)) return;

      const mesh = object as Three.Mesh;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const styledMaterials = materials.map(
        () =>
          new three.MeshLambertMaterial({
            color: new three.Color(ARM_MODEL_COLOR).convertSRGBToLinear(),
          }),
      );

      materials.forEach((material) => material.dispose());
      mesh.material = Array.isArray(mesh.material) ? styledMaterials : styledMaterials[0];
    });
  }

  private animate(): void {
    if (!this.renderer || !this.scene || !this.camera) return;

    this.animationFrame = window.requestAnimationFrame(() => this.animate());
    this.controls?.update();
    this.animateTargetMarker();
    this.renderer.render(this.scene, this.camera);
  }

  private disposeViewer(): void {
    this.armIkCoordinator.reset();
    this.clearTelemetryWatchdog();
    this.telemetryStale.set(false);
    this.armViewMode.reset();
    this.rightBumperPressed = false;

    if (this.animationFrame !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(this.animationFrame);
    }
    this.animationFrame = null;

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (typeof window !== 'undefined') window.removeEventListener('resize', this.resizeScene);

    this.controls?.dispose();
    this.controls = null;
    this.disposeRobot(this.robot);
    this.disposeRobot(this.pendingRobot);
    this.robot = null;
    this.pendingRobot = null;

    if (this.groundGrid) {
      this.groundGrid.geometry.dispose();
      const materials = Array.isArray(this.groundGrid.material)
        ? this.groundGrid.material
        : [this.groundGrid.material];
      materials.forEach((material) => material.dispose());
      this.groundGrid = null;
    }

    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.targetMarker = null;
    this.actualMarker = null;
    this.targetMarkerFadeStartedAtMs = null;
    this.targetMarkerFadeStartOpacity = 1;
    this.targetMarkerFadeTargetOpacity = 1;
  }

  private clearTelemetryWatchdog(): void {
    if (this.telemetryStaleTimer === null) return;

    clearTimeout(this.telemetryStaleTimer);
    this.telemetryStaleTimer = null;
  }

  private disposeRobot(robot: URDFRobot | null): void {
    robot?.traverse((object) => {
      if (!('geometry' in object) || !('material' in object)) return;

      const mesh = object as Three.Mesh;
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => material.dispose());
    });
  }
}
