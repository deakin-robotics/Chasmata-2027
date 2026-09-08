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

import { ArmIkCoordinator } from '../../../core/arm/arm-ik-coordinator';
import { RosConnection } from '../../../core/ros/ros-connection';
import { UnavailableOverlay } from '../../../shared/unavailable-overlay/unavailable-overlay';

const ARM_URDF_URL = '/assets/kinematics/arm.urdf';
const ARM_MODEL_COLOR = '#697482';
const ARM_TARGET_COLOR = '#62a8e5';

type ViewerStatus = 'unavailable' | 'loading' | 'ready' | 'error';
type ThreeModule = typeof import('three');

/** Renders the arm URDF in a Three.js scene. */
@Component({
  selector: 'app-arm-model-viewer',
  imports: [MatIconModule, UnavailableOverlay],
  templateUrl: './arm-model-viewer.html',
  styleUrl: './arm-model-viewer.scss',
})
export class ArmModelViewer implements AfterViewInit, OnDestroy {
  private readonly armIkCoordinator = inject(ArmIkCoordinator);
  private readonly rosConnection = inject(RosConnection);

  @ViewChild('sceneHost', { static: true })
  private readonly sceneHost?: ElementRef<HTMLDivElement>;

  readonly status = signal<ViewerStatus>('unavailable');
  readonly statusMessage = signal('Unavailable');
  readonly viewerStatusLabel = computed(() => {
    switch (this.status()) {
      case 'loading':
        return 'LOADING';
      case 'ready':
        return 'READY';
      case 'error':
        return 'ERROR';
      default:
        return 'UNAVAILABLE';
    }
  });
  readonly ikStatus = this.armIkCoordinator.status;
  readonly ikStatusLabel = this.armIkCoordinator.statusLabel;
  readonly rosConnected = this.rosConnection.isConnected;

  private three: ThreeModule | null = null;
  private loader: URDFLoader | null = null;
  private orbitControlsConstructor: typeof OrbitControls | null = null;
  private scene: Three.Scene | null = null;
  private camera: Three.PerspectiveCamera | null = null;
  private renderer: Three.WebGLRenderer | null = null;
  private controls: OrbitControls | null = null;
  private robot: URDFRobot | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private animationFrame: number | null = null;
  private targetMarker: Three.Mesh | null = null;
  private groundGrid: Three.GridHelper | null = null;
  private initializing = false;
  private destroyed = false;

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

  private readonly targetPositionEffect = effect(() => {
    const position = this.armIkCoordinator.position();
    const jointAngles = this.armIkCoordinator.jointAngles();
    const ikStatus = this.armIkCoordinator.status();
    this.targetMarker?.position.set(...position);
    if (ikStatus === 'valid') this.applyJointAngles(jointAngles);
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
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  private initializeScene(): boolean {
    const host = this.sceneHost?.nativeElement;
    const three = this.three;
    const OrbitControlsConstructor = this.orbitControlsConstructor;
    if (!host || !three || !OrbitControlsConstructor) return false;

    if (typeof WebGLRenderingContext === 'undefined') {
      this.status.set('error');
      this.statusMessage.set('3D rendering unavailable');
      return false;
    }

    try {
      const scene = new three.Scene();
      const camera = new three.PerspectiveCamera(35, 1, 0.01, 100);
      const renderer = new three.WebGLRenderer({ antialias: true, alpha: true });
      const controls = new OrbitControlsConstructor(camera, renderer.domElement);

      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      renderer.outputEncoding = three.sRGBEncoding;

      camera.position.set(1.5, 1.2, 1.5);
      camera.lookAt(0, 0.5, 0);

      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = false;
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
      return true;
    } catch {
      this.status.set('error');
      this.statusMessage.set('3D rendering unavailable');
      return false;
    }
  }

  private async initializeViewer(): Promise<void> {
    if (!this.rosConnected()) return;

    if (typeof WebGLRenderingContext === 'undefined') {
      this.status.set('error');
      this.statusMessage.set('3D rendering unavailable');
      return;
    }

    try {
      const [three, controlsModule, urdfModule] = await Promise.all([
        import('three'),
        import('three/examples/jsm/controls/OrbitControls.js'),
        import('urdf-loader'),
      ]);

      if (this.destroyed || !this.rosConnected()) return;

      this.three = three;
      this.orbitControlsConstructor = controlsModule.OrbitControls;
      this.loader = new urdfModule.default();

      await this.armIkCoordinator.load(ARM_URDF_URL);

      if (this.destroyed || !this.rosConnected()) return;

      if (!this.initializeScene()) return;

      this.observeResize();
      this.loadArmModel();
      this.animate();
    } catch {
      if (this.destroyed || !this.rosConnected()) return;

      this.status.set('error');
      this.statusMessage.set('3D viewer failed to initialize');
    }
  }

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

  private observeResize(): void {
    const host = this.sceneHost?.nativeElement;
    if (!host) return;

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.resizeScene);
      this.resizeObserver.observe(host);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.resizeScene);
    }
  }

  private loadArmModel(): void {
    const scene = this.scene;
    const loader = this.loader;
    if (!scene || !loader) return;

    loader.load(
      ARM_URDF_URL,
      (robot) => {
        if (this.destroyed || !this.rosConnected() || !this.scene) return;

        this.robot = robot;
        robot.rotation.x = -Math.PI / 2;
        this.styleRobot(robot);
        scene.add(robot);
        this.addGroundGrid(robot);
        this.frameRobot(robot);
        this.addTargetMarker(robot);
        if (this.ikStatus() === 'valid') {
          this.applyJointAngles(this.armIkCoordinator.jointAngles());
        }
        this.status.set('ready');
        this.statusMessage.set('Ready');
      },
      undefined,
      () => {
        if (this.destroyed || !this.rosConnected()) return;

        this.status.set('error');
        this.statusMessage.set('Unable to load arm model');
      },
    );
  }

  private addTargetMarker(robot: URDFRobot): void {
    const three = this.three;
    if (!three) return;

    const marker = new three.Mesh(
      new three.SphereGeometry(0.035, 20, 12),
      new three.MeshBasicMaterial({
        color: new three.Color(ARM_TARGET_COLOR).convertSRGBToLinear(),
      }),
    );
    marker.name = 'arm-position-target';
    marker.position.set(...this.armIkCoordinator.position());
    robot.add(marker);
    this.targetMarker = marker;
  }

  private applyJointAngles(jointAngles: Readonly<Record<string, number>> | null): void {
    if (!jointAngles || !this.robot) return;

    for (const [name, angle] of Object.entries(jointAngles)) {
      if (Number.isFinite(angle)) this.robot.setJointValue(name, angle);
    }

    this.robot.updateMatrixWorld(true);
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

  private addGroundGrid(robot: URDFRobot): void {
    const scene = this.scene;
    const three = this.three;
    if (!scene || !three) return;

    robot.updateMatrixWorld(true);
    const bounds = new three.Box3().setFromObject(robot);
    const size = bounds.getSize(new three.Vector3());
    const gridSize = Math.max(size.x, size.z, 1.4);
    const grid = new three.GridHelper(gridSize, 14, 0x405064, 0x263341);

    grid.position.y = bounds.min.y;
    scene.add(grid);
    this.groundGrid = grid;
  }

  private frameRobot(robot: URDFRobot): void {
    const camera = this.camera;
    const controls = this.controls;
    const three = this.three;
    if (!camera || !controls || !three) return;

    robot.updateMatrixWorld(true);
    let bounds = new three.Box3().setFromObject(robot);
    const centre = bounds.getCenter(new three.Vector3());

    robot.position.x -= centre.x;
    robot.position.y -= bounds.min.y;
    robot.position.z -= centre.z;
    robot.updateMatrixWorld(true);

    bounds = new three.Box3().setFromObject(robot);
    const size = bounds.getSize(new three.Vector3());
    const height = Math.max(size.y, 0.1);
    const distance = Math.max(size.x, size.y, size.z) * 1.3;
    const target = new three.Vector3(0, height * 0.45, 0);

    camera.near = Math.max(distance / 100, 0.001);
    camera.far = Math.max(distance * 20, 10);
    camera.position.set(-distance * 0.95, distance * 0.85, distance * 1.15);
    camera.lookAt(target);
    controls.target.copy(target);
    controls.update();
    camera.updateProjectionMatrix();
  }

  private animate(): void {
    if (!this.renderer || !this.scene || !this.camera) return;

    this.animationFrame = window.requestAnimationFrame(() => this.animate());
    this.controls?.update();
    this.renderer.render(this.scene, this.camera);
  }

  private disposeRobot(): void {
    const three = this.three;
    if (!three) return;

    this.robot?.traverse((object) => {
      if (!('geometry' in object) || !('material' in object)) return;

      const mesh = object as Three.Mesh;

      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => material.dispose());
    });
  }

  private disposeViewer(): void {
    this.armIkCoordinator.reset();

    if (this.animationFrame !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(this.animationFrame);
    }
    this.animationFrame = null;

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.resizeScene);
    }

    this.controls?.dispose();
    this.controls = null;
    this.disposeRobot();
    this.robot = null;

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
  }
}
