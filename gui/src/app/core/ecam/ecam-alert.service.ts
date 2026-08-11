import { Service, computed, signal } from '@angular/core';

import { ECAM_MESSAGE_CATALOG } from './ecam-message-catalog';
import {
  EcamAlert,
  EcamAlertCode,
  EcamAlertSeverity,
  RaiseEcamAlertOptions,
} from './ecam-alert.types';

const SEVERITY_PRIORITY: Readonly<Record<EcamAlertSeverity, number>> = {
  fault: 0,
  warning: 1,
  attention: 2,
};

/**
 * Application-wide ECAM alert state.
 *
 * Any feature can raise or clear an alert by code. This service resolves its
 * wording and severity from the catalogue, deduplicates repeated reports, and
 * exposes one consistently ordered active-alert list to every operator view.
 */
@Service()
export class EcamAlertService {
  private readonly activeAlertsState = signal<ReadonlyMap<EcamAlertCode, EcamAlert>>(
    new Map(),
  );

  readonly activeAlerts = computed(() =>
    [...this.activeAlertsState().values()].sort((left, right) => {
      const severityDifference =
        SEVERITY_PRIORITY[left.severity] - SEVERITY_PRIORITY[right.severity];

      if (severityDifference !== 0) return severityDifference;
      return left.firstSeenAt - right.firstSeenAt;
    }),
  );

  readonly hasActiveAlerts = computed(() => this.activeAlerts().length > 0);

  /** Raise an alert, or refresh the matching active alert without duplicating it. */
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
  }

  /** Clear a recovered condition. Clearing an inactive code is safe and ignored. */
  clear(code: EcamAlertCode): void {
    this.activeAlertsState.update((alerts) => {
      if (!alerts.has(code)) return alerts;

      const nextAlerts = new Map(alerts);
      nextAlerts.delete(code);
      return nextAlerts;
    });
  }

  /** Clear every active alert, intended for controlled reset and test scenarios. */
  clearAll(): void {
    this.activeAlertsState.set(new Map());
  }
}
