import { OnDestroy, Service, signal } from '@angular/core';

@Service()
export class DriveTelemetryService implements OnDestroy {
  private readonly state = signal<Readonly<Record<string, number>> | null>(null);
  readonly wheelVelocities = this.state.asReadonly();
  private readonly commandState = signal<Readonly<Record<string, number>> | null>(null);
  readonly wheelCommands = this.commandState.asReadonly();
  private readonly temperatureState = signal<Readonly<Record<number, number>>>({});
  readonly rawTemperatures = this.temperatureState.asReadonly();
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
    }, 8000));
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
    this.state.set(null);
  }

  ngOnDestroy(): void { this.clear(); }
}
