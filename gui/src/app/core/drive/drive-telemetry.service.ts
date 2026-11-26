import { OnDestroy, Service, signal } from '@angular/core';

@Service()
export class DriveTelemetryService implements OnDestroy {
  private readonly state = signal<Readonly<Record<string, number>> | null>(null);
  readonly wheelVelocities = this.state.asReadonly();
  private readonly commandState = signal<Readonly<Record<string, number>> | null>(null);
  readonly wheelCommands = this.commandState.asReadonly();
  private readonly temperatureState = signal<Readonly<Record<number, number>>>({});
  readonly rawTemperatures = this.temperatureState.asReadonly();
  private readonly currentState = signal<Readonly<Record<number, number>>>({});
  readonly rawCurrents = this.currentState.asReadonly();
  private readonly odometryState = signal<{ x: number; speed: number } | null>(null);
  readonly odometry = this.odometryState.asReadonly();
  private readonly linearCommandState = signal<number | null>(null);
  readonly linearCommand = this.linearCommandState.asReadonly();
  private odometryExpiry: ReturnType<typeof setTimeout> | undefined;
  private linearCommandExpiry: ReturnType<typeof setTimeout> | undefined;
  private readonly currentExpiry = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly temperatureExpiry = new Map<number, ReturnType<typeof setTimeout>>();
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private commandExpiry: ReturnType<typeof setTimeout> | undefined;

  setJointState(names: unknown, velocities: unknown): void {
    if (!Array.isArray(names) || !Array.isArray(velocities) || names.length === 0 || names.length !== velocities.length) return;
    const values: Record<string, number> = {};
    names.forEach((name, index) => {
      const value = velocities[index];
      if (typeof name === 'string' && typeof value === 'number' && Number.isFinite(value)) values[name] = value;
    });
    if (Object.keys(values).length === 0) return;
    this.state.set(values);
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = setTimeout(() => { this.state.set(null); this.expiry = undefined; }, 1500);
  }

  setCommands(names: unknown, velocities: unknown): void {
    if (!Array.isArray(names) || !Array.isArray(velocities) || names.length === 0 || names.length !== velocities.length) return;
    const values: Record<string, number> = {};
    names.forEach((name, index) => {
      const value = velocities[index];
      if (typeof name === 'string' && typeof value === 'number' && Number.isFinite(value)) values[name] = value;
    });
    if (Object.keys(values).length === 0) return;
    this.commandState.set(values);
    if (this.commandExpiry) clearTimeout(this.commandExpiry);
    this.commandExpiry = setTimeout(() => { this.commandState.set(null); }, 1500);
  }

  setTemperature(data: unknown): void {
    if (!Array.isArray(data) || data.length !== 2) return;
    const [wheel, raw] = data;
    if (typeof wheel !== 'number' || !Number.isInteger(wheel) || wheel < 0 || wheel > 3 ||
        typeof raw !== 'number' || !Number.isInteger(raw)) return;
    const previous = this.temperatureExpiry.get(wheel);
    if (previous) clearTimeout(previous);
    if (raw < 0) {
      this.temperatureState.update((values) => { const next = { ...values }; delete next[wheel]; return next; });
      this.temperatureExpiry.delete(wheel);
      return;
    }
    this.temperatureState.update((values) => ({ ...values, [wheel]: raw }));
    this.temperatureExpiry.set(wheel, setTimeout(() => {
      this.temperatureState.update((values) => { const next = { ...values }; delete next[wheel]; return next; });
      this.temperatureExpiry.delete(wheel);
    }, 10000));
  }

  setCurrent(data: unknown): void {
    if (!Array.isArray(data) || data.length !== 2) return;
    const [wheel, raw] = data;
    if (typeof wheel !== 'number' || !Number.isInteger(wheel) || wheel < 0 || wheel > 3 ||
        typeof raw !== 'number' || !Number.isInteger(raw)) return;
    const previous = this.currentExpiry.get(wheel);
    if (previous) clearTimeout(previous);
    if (raw < 0) {
      this.currentState.update((values) => { const next = { ...values }; delete next[wheel]; return next; });
      this.currentExpiry.delete(wheel);
      return;
    }
    this.currentState.update((values) => ({ ...values, [wheel]: raw }));
    this.currentExpiry.set(wheel, setTimeout(() => {
      this.currentState.update((values) => { const next = { ...values }; delete next[wheel]; return next; });
      this.currentExpiry.delete(wheel);
    }, 10000));
  }

  setOdometry(message: unknown): void {
    if (!message || typeof message !== 'object') return;
    const odom = message as { pose?: { pose?: { position?: { x?: unknown } } }; twist?: { twist?: { linear?: { x?: unknown } } } };
    const x = odom.pose?.pose?.position?.x;
    const speed = odom.twist?.twist?.linear?.x;
    if (typeof x !== 'number' || !Number.isFinite(x) || typeof speed !== 'number' || !Number.isFinite(speed)) return;
    this.odometryState.set({ x, speed });
    if (this.odometryExpiry) clearTimeout(this.odometryExpiry);
    this.odometryExpiry = setTimeout(() => { this.odometryState.set(null); }, 1500);
  }

  setLinearCommand(message: unknown): void {
    if (!message || typeof message !== 'object') return;
    const speed = (message as { twist?: { linear?: { x?: unknown } } }).twist?.linear?.x;
    if (typeof speed !== 'number' || !Number.isFinite(speed)) return;
    this.linearCommandState.set(speed);
    if (this.linearCommandExpiry) clearTimeout(this.linearCommandExpiry);
    this.linearCommandExpiry = setTimeout(() => { this.linearCommandState.set(null); }, 1500);
  }

  clear(): void {
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = undefined;
    if (this.commandExpiry) clearTimeout(this.commandExpiry);
    this.commandExpiry = undefined;
    this.commandState.set(null);
    for (const timer of this.temperatureExpiry.values()) clearTimeout(timer);
    this.temperatureExpiry.clear();
    this.temperatureState.set({});
    for (const timer of this.currentExpiry.values()) clearTimeout(timer);
    this.currentExpiry.clear();
    this.currentState.set({});
    if (this.odometryExpiry) clearTimeout(this.odometryExpiry);
    if (this.linearCommandExpiry) clearTimeout(this.linearCommandExpiry);
    this.odometryExpiry = this.linearCommandExpiry = undefined;
    this.odometryState.set(null);
    this.linearCommandState.set(null);
    this.state.set(null);
  }

  ngOnDestroy(): void { this.clear(); }
}
