import { Service, computed, effect, inject, signal } from '@angular/core';
import { Topic } from 'roslib';

import { BaseStationConnection } from '../ros/base-station-connection';
import { RosConnection } from '../ros/ros-connection';
import { RosHeartbeatMonitor } from '../ros/ros-heartbeat-monitor';
import { ECAM_MESSAGE_CATALOG } from './ecam-message-catalog';
import { EcamAlertReporterService } from './ecam-alert-reporter.service';
import { EcamAlert, EcamAlertCode, EcamAlertReporterSource, EcamAlertSeverity } from './ecam-alert.types';

const SEVERITY_PRIORITY: Readonly<Record<EcamAlertSeverity, number>> = {
  fault: 0,
  warning: 1,
  attention: 2,
};
const COMBINED_TOPIC = '/ecam/alerts';
const COMBINED_MESSAGE_TYPE = 'telemetry_interfaces/msg/EcamAlerts';
const REPORTER_SOURCES: readonly EcamAlertReporterSource[] = [
  'driver',
  'ecam',
  'arm',
  'basestation',
  'rover',
];
const ECAM_SNAPSHOT_QOS = {
  history: 'keep_last',
  depth: 1,
  reliability: 'reliable',
  durability: 'transient_local',
} as const;

type AggregateAuthority = 'rover' | 'basestation';

interface RosTime {
  sec?: unknown;
  nanosec?: unknown;
}

interface EcamAlertSourceSnapshotMessage {
  source?: unknown;
  active_codes?: unknown;
}

interface EcamAlertsMessage {
  authority?: unknown;
  timestamp?: RosTime;
  sources?: unknown;
}

/** Consumes the shared ECAM snapshot for the ECAM display only. */
@Service()
export class EcamAlertConsumerService {
  private readonly reporter = inject(EcamAlertReporterService);
  private readonly roverConnection = inject(RosConnection);
  private readonly baseStationConnection = inject(BaseStationConnection);
  private readonly heartbeatMonitor = inject(RosHeartbeatMonitor);

  private readonly sharedAlertsState = signal<ReadonlyMap<EcamAlertCode, EcamAlert>>(new Map());
  private sharedAuthority: AggregateAuthority | null = null;

  readonly activeAlerts = computed(() => {
    const alerts = new Map(this.sharedAlertsState());

    for (const localAlert of this.reporter.localAlerts()) {
      const sharedAlert = alerts.get(localAlert.code);
      const reporterSources = new Set([
        ...(sharedAlert?.reporterSources ?? []),
        ...localAlert.reporterSources,
      ]);
      alerts.set(localAlert.code, {
        ...(sharedAlert ?? {}),
        ...localAlert,
        firstSeenAt: Math.min(sharedAlert?.firstSeenAt ?? localAlert.firstSeenAt, localAlert.firstSeenAt),
        lastUpdatedAt: Math.max(
          sharedAlert?.lastUpdatedAt ?? localAlert.lastUpdatedAt,
          localAlert.lastUpdatedAt,
        ),
        reporterSources: REPORTER_SOURCES.filter((source) => reporterSources.has(source)),
      });
    }

    return [...alerts.values()].sort((left, right) => {
      const severityDifference =
        SEVERITY_PRIORITY[left.severity] - SEVERITY_PRIORITY[right.severity];
      return severityDifference !== 0 ? severityDifference : left.firstSeenAt - right.firstSeenAt;
    });
  });

  readonly hasActiveAlerts = computed(() => this.activeAlerts().length > 0);

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

  private subscribeAggregate(client: NonNullable<ReturnType<RosConnection['client']>>): Topic {
    const topic = new Topic({
      ros: client,
      name: COMBINED_TOPIC,
      messageType: COMBINED_MESSAGE_TYPE,
      queue_length: 1,
    });
    const sendWithReconnect = topic.callForSubscribeAndAdvertise;
    topic.callForSubscribeAndAdvertise = (message) =>
      sendWithReconnect({ ...message, qos: ECAM_SNAPSHOT_QOS } as unknown as typeof message);
    return topic;
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
    const activeCodeReporters = new Map<EcamAlertCode, Set<EcamAlertReporterSource>>();

    for (const snapshot of sourceSnapshots) {
      if (
        !snapshot ||
        typeof snapshot !== 'object' ||
        !REPORTER_SOURCES.includes(snapshot.source as EcamAlertReporterSource) ||
        !Array.isArray(snapshot.active_codes)
      ) {
        continue;
      }
      for (const code of snapshot.active_codes) {
        if (typeof code === 'string' && Object.hasOwn(ECAM_MESSAGE_CATALOG, code)) {
          const alertCode = code as EcamAlertCode;
          const reporters = activeCodeReporters.get(alertCode) ?? new Set<EcamAlertReporterSource>();
          reporters.add(snapshot.source as EcamAlertReporterSource);
          activeCodeReporters.set(alertCode, reporters);
        }
      }
    }

    const previousAlerts = this.sharedAlertsState();
    const nextAlerts = new Map<EcamAlertCode, EcamAlert>();
    for (const [code, reporters] of activeCodeReporters) {
      const existing = previousAlerts.get(code);
      nextAlerts.set(code, {
        ...ECAM_MESSAGE_CATALOG[code],
        detail: null,
        firstSeenAt: existing?.firstSeenAt ?? timestamp,
        lastUpdatedAt: timestamp,
        reporterSources: REPORTER_SOURCES.filter((source) => reporters.has(source)),
      });
    }

    this.sharedAuthority = authority;
    this.sharedAlertsState.set(nextAlerts);
  }

  private timeToMilliseconds(value: RosTime | undefined): number | null {
    if (!value || typeof value.sec !== 'number' || typeof value.nanosec !== 'number') {
      return null;
    }
    if (!Number.isFinite(value.sec) || !Number.isFinite(value.nanosec)) return null;
    return value.sec * 1000 + value.nanosec / 1_000_000;
  }
}
