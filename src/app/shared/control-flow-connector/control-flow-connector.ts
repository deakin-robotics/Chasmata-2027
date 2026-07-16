import { Component, input } from '@angular/core';

export type ControlFlowConnectorVariant =
  | 'vertical'
  | 'horizontal'
  | 'top-right'
  | 'top-left'
  | 'bottom-right'
  | 'bottom-left';

export type ControlFlowConnectorTone =
  | 'neutral'
  | 'info'
  | 'normal'
  | 'caution'
  | 'critical';

/** Renders a directional SVG line used to show control prerequisites. */
@Component({
  selector: 'app-control-flow-connector',
  templateUrl: './control-flow-connector.html',
  styleUrl: './control-flow-connector.scss',
})
export class ControlFlowConnector {
  readonly variant = input.required<ControlFlowConnectorVariant>();
  readonly tone = input<ControlFlowConnectorTone>('neutral');
}
