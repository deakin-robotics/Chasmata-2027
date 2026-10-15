import { Service, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { Topic } from 'roslib';

import { BaseStationConnection } from '../ros/base-station-connection';
import { RosConnection } from '../ros/ros-connection';
import { RosHeartbeatMonitor } from '../ros/ros-heartbeat-monitor';
import { ECAM_MESSAGE_CATALOG } from './ecam-message-catalog';
import {
  EcamAlert,
  EcamAlertCode,
  EcamAlertReporterSource,
  EcamAlertSeverity,
  RaiseEcamAlertOptions,
} from './ecam-alert.types';

const SEVERITY_PRIORITY: Readonly<Record<EcamAlertSeverity, number>> = {
  fault: 0,
  warning: 1,
  attention: 2,
};
const SOURCE_TOPIC = '/ecam/alerts/source';
const COMBINED_TOPIC = '/ecam/alerts';
const SOURCE_MESSAGE_TYPE = 'telemetry_interfaces/msg/EcamAlertSourceSnapshot';
const COMBINED_MESSAGE_TYPE = 'telemetry_interfaces/msg/EcamAlerts';
const GUI_SOURCES = ['driver', 'ecam', 'arm'] as const;
const ECAM_SNAPSHOT_QOS = {
  history: 'keep_last',
  depth: 1,
  reliability: 'reliable',
  durability: 'transient_local',
} as const;

type GuiEcamSource = Extract<EcamAlertReporterSource, 'driver' | 'ecam' | 'arm'>;
type AggregateAuthority = 'rover' | 'basestation';

interface RosTime {
  sec?: unknown;
  nanosec?: unknown;
}

interface EcamAlertSourceSnapshotMessage {
  source?: unknown;
  timestamp?: RosTime;
  active_codes?: unknown;
}

interface EcamAlertsMessage {
  authority?: unknown;
  timestamp?: RosTime;
  sources?: unknown;
}

/** Shared ECAM source reporter and combined-alert state for this GUI route. */
@Service()
export class EcamAlertService {
  private readonly router = inject(Router);
  private readonly roverConnection = inject(RosConnection);
  private readonly baseStationConnection = inject(BaseStationConnection);
  private readonly heartbeatMonitor = inject(RosHeartbeatMonitor);

  private readonly activeAlertsState = signal<ReadonlyMap<EcamAlertCode, EcamAlert>>(new Map());
  private readonly sharedAlertsState = signal<ReadonlyMap<EcamAlertCode, EcamAlert>>(new Map());
  private readonly activeSourceState = signal<GuiEcamSource>(this.sourceFromUrl(this.router.url));
  private readonly sourceCodesState = signal<
    ReadonlyMap<GuiEcamSource, ReadonlySet<EcamAlertCode>>
  >(new Map());
  private readonly sourcePublisherRevision = signal(0);
  private sourcePublisher: Topic | null = null;
  private sharedAuthority: AggregateAuthority | null = null;
  private roverWasAvailable = false;
  private roverHeartbeatAlertRaised = false;
  private baseStationWasAvailable = false;
  private baseStationHeartbeatAlertRaised = false;

  readonly activeAlerts = computed(() => {
    const alerts = new Map(this.sharedAlertsState());
    for (const [code, alert] of this.activeAlertsState()) alerts.set(code, alert);

    return [...alerts.values()].sort((left, right) => {
      const severityDifference =
        SEVERITY_PRIORITY[left.severity] - SEVERITY_PRIORITY[right.severity];

      if (severityDifference !== 0) return severityDifference;
      return left.firstSeenAt - right.firstSeenAt;
    });
  });

  readonly hasActiveAlerts = computed(() => this.activeAlerts().length > 0);

  private readonly sourceTransportEffect = effect((onCleanup) => {
    const roverAvailable = this.heartbeatMonitor.roverAvailable();
    const roverConnected = this.roverConnection.isConnected();
    const baseStationConnected = this.baseStationConnection.isConnected();
    const roverClient = this.roverConnection.client();
    const baseStationClient = this.baseStationConnection.client();
    const client =
      roverAvailable && roverConnected && roverClient
        ? roverClient
        : baseStationConnected
          ? baseStationClient
          : null;

    if (!client) {
      this.sourcePublisher = null;
      this.sourcePublisherRevision.update((revision) => revision + 1);
      return;
    }

    const topic = new Topic({
      ros: client,
      name: SOURCE_TOPIC,
      messageType: SOURCE_MESSAGE_TYPE,
      latch: true,
      queue_size: 1,
    });
    this.applySnapshotQos(topic);
    topic.advertise();
    this.sourcePublisher = topic;
    this.sourcePublisherRevision.update((revision) => revision + 1);

    onCleanup(() => {
      topic.unadvertise();
      if (this.sourcePublisher === topic) this.sourcePublisher = null;
      this.sourcePublisherRevision.update((revision) => revision + 1);
    });
  });

  private readonly sourceSnapshotEffect = effect(() => {
    this.sourcePublisherRevision();
    const sourceCodes = this.sourceCodesState();
    const activeSource = this.activeSourceState();
    const topic = this.sourcePublisher;
    if (!topic) return;

    const snapshots = new Map(sourceCodes);
    if (!snapshots.has(activeSource)) snapshots.set(activeSource, new Set());
    const timestamp = this.currentRosTime();
    for (const [source, codes] of snapshots) {
      topic.publish({ source, timestamp, active_codes: [...codes].sort() });
    }
  });

  private readonly roverAggregateEffect = effect((onCleanup) => {
    const client = this.roverConnection.client();
    if (!client || !this.roverConnection.isConnected()) return;

    const topic = this.subscribeAggregate(client);
    const callback = (message: unknown) => this.handleAggregate(message);
    topic.subscribe(callback);
    onCleanup(() => topic.unsubscribe(callback));
  });

  private readonly baseStationAggregateEffect = effect((onCleanup) => {
    const client = this.baseStationConnection.client();
    if (!client || !this.baseStationConnection.isConnected()) return;

    const topic = this.subscribeAggregate(client);
    const callback = (message: unknown) => this.handleAggregate(message);
    topic.subscribe(callback);
    onCleanup(() => topic.unsubscribe(callback));
  });

  private readonly roverHeartbeatAlertEffect = effect(() => {
    const available = this.heartbeatMonitor.roverAvailable();
    if (available === this.roverWasAvailable) return;

    const wasAvailable = this.roverWasAvailable;
    this.roverWasAvailable = available;

    untracked(() => {
      if (wasAvailable) {
        this.raise('ROVER_HEARTBEAT_LOST');
        this.roverHeartbeatAlertRaised = true;
      } else if (this.roverHeartbeatAlertRaised) {
        this.clear('ROVER_HEARTBEAT_LOST');
        this.roverHeartbeatAlertRaised = false;
      }
    });
  });

  private readonly baseStationHeartbeatAlertEffect = effect(() => {
    const available = this.heartbeatMonitor.baseStationAvailable();
    if (available === this.baseStationWasAvailable) return;

    const wasAvailable = this.baseStationWasAvailable;
    this.baseStationWasAvailable = available;

    untracked(() => {
      if (wasAvailable) {
        this.raise('BASE_STATION_HEARTBEAT_LOST');
        this.baseStationHeartbeatAlertRaised = true;
      } else if (this.baseStationHeartbeatAlertRaised) {
        this.clear('BASE_STATION_HEARTBEAT_LOST');
        this.baseStationHeartbeatAlertRaised = false;
      }
    });
  });

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.setActiveSource(this.sourceFromUrl(event.urlAfterRedirects));
      }
    });
  }

  /** Raise an alert and publish the updated complete snapshot for this GUI source. */
  raise(code: EcamAlertCode, options: RaiseEcamAlertOptions = {}): void {
    const definition = ECAM_MESSAGE_CATALOG[code];
    const now = Date.now();
    const existing = this.activeAlertsState().get(code);
    const alert: EcamAlert = {
      ...definition,
      detail: options.detail?.trim() || null,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastUpdatedAt: now,
    };

    this.activeAlertsState.update((alerts) => {
      const nextAlerts = new Map(alerts);
      nextAlerts.set(code, alert);
      return nextAlerts;
    });
    this.updateSourceCodes(this.activeSourceState(), (codes) => codes.add(code));
  }

  /** Clear a recovered condition from this GUI's source snapshot. */
  clear(code: EcamAlertCode): void {
    this.activeAlertsState.update((alerts) => {
      if (!alerts.has(code)) return alerts;

      const nextAlerts = new Map(alerts);
      nextAlerts.delete(code);
      return nextAlerts;
    });

    this.sourceCodesState.update((sources) => {
      let changed = false;
      const nextSources = new Map(sources);
      for (const [source, currentCodes] of sources) {
        if (!currentCodes.has(code)) continue;
        const nextCodes = new Set(currentCodes);
        nextCodes.delete(code);
        nextSources.set(source, nextCodes);
        changed = true;
      }
      if (!changed) return sources;
      return nextSources;
    });
  }

  /** Clear every alert raised by this GUI; alerts reported by other sources remain. */
  clearAll(): void {
    this.activeAlertsState.set(new Map());
    const clearedSources = new Map<GuiEcamSource, ReadonlySet<EcamAlertCode>>();
    for (const source of this.sourceCodesState().keys()) clearedSources.set(source, new Set());
    clearedSources.set(this.activeSourceState(), new Set());
    this.sourceCodesState.set(clearedSources);
  }

  private subscribeAggregate(client: NonNullable<ReturnType<RosConnection['client']>>): Topic {
    const topic = new Topic({
      ros: client,
      name: COMBINED_TOPIC,
      messageType: COMBINED_MESSAGE_TYPE,
      queue_length: 1,
    });
    this.applySnapshotQos(topic);
    return topic;
  }

  private applySnapshotQos(topic: Topic): void {
    const sendWithReconnect = topic.callForSubscribeAndAdvertise;
    topic.callForSubscribeAndAdvertise = (message) =>
      sendWithReconnect({ ...message, qos: ECAM_SNAPSHOT_QOS } as unknown as typeof message);
  }

  private handleAggregate(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const message = value as EcamAlertsMessage;
    if (message.authority !== 'rover' && message.authority !== 'basestation') return;

    const authority = message.authority as AggregateAuthority;
    const roverAvailable = this.heartbeatMonitor.roverAvailable();
    if (authority === 'basestation' && roverAvailable) return;
    if (authority === 'rover' && !roverAvailable && this.sharedAuthority === 'basestation') return;

    const timestamp = this.timeToMilliseconds(message.timestamp) ?? Date.now();
    const sourceSnapshots = Array.isArray(message.sources)
      ? (message.sources as EcamAlertSourceSnapshotMessage[])
      : [];
    const activeCodes = new Set<EcamAlertCode>();

    for (const snapshot of sourceSnapshots) {
      if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.active_codes)) {
        continue;
      }
      for (const code of snapshot.active_codes) {
        if (typeof code === 'string' && Object.hasOwn(ECAM_MESSAGE_CATALOG, code)) {
          activeCodes.add(code as EcamAlertCode);
        }
      }
    }

    const previousAlerts = this.sharedAlertsState();
    const nextAlerts = new Map<EcamAlertCode, EcamAlert>();
    for (const code of activeCodes) {
      const existing = previousAlerts.get(code);
      nextAlerts.set(code, {
        ...ECAM_MESSAGE_CATALOG[code],
        detail: null,
        firstSeenAt: existing?.firstSeenAt ?? timestamp,
        lastUpdatedAt: timestamp,
      });
    }

    this.sharedAuthority = authority;
    this.sharedAlertsState.set(nextAlerts);
  }

  private setActiveSource(source: GuiEcamSource): void {
    const previousSource = this.activeSourceState();
    if (source === previousSource) return;

    const currentCodes = new Set(this.activeAlertsState().keys());
    this.sourceCodesState.update((sources) => {
      const nextSources = new Map(sources);
      nextSources.set(previousSource, new Set());
      nextSources.set(source, currentCodes);
      return nextSources;
    });
    this.activeSourceState.set(source);
  }

  private updateSourceCodes(
    source: GuiEcamSource,
    update: (codes: Set<EcamAlertCode>) => void,
  ): void {
    this.sourceCodesState.update((sources) => {
      const nextSources = new Map(sources);
      const codes = new Set(nextSources.get(source) ?? []);
      update(codes);
      nextSources.set(source, codes);
      return nextSources;
    });
  }

  private sourceFromUrl(url: string): GuiEcamSource {
    const route = url.split(/[?#]/, 1)[0].split('/').filter(Boolean)[0];
    return GUI_SOURCES.includes(route as GuiEcamSource) ? (route as GuiEcamSource) : 'ecam';
  }

  private currentRosTime(): { sec: number; nanosec: number } {
    const milliseconds = Date.now();
    return {
      sec: Math.floor(milliseconds / 1000),
      nanosec: (milliseconds % 1000) * 1_000_000,
    };
  }

  private timeToMilliseconds(value: RosTime | undefined): number | null {
    if (!value || typeof value.sec !== 'number' || typeof value.nanosec !== 'number') {
      return null;
    }
    if (!Number.isFinite(value.sec) || !Number.isFinite(value.nanosec)) return null;
    return value.sec * 1000 + value.nanosec / 1_000_000;
  }
}
