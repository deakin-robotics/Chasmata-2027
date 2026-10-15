import { Service } from '@angular/core';

import { RosbridgeConnection } from './rosbridge-connection';

/** Owns the GUI's direct connection to the Rover ROSbridge. */
@Service()
export class RosConnection extends RosbridgeConnection {}

export type { RosConnectionStatus } from './rosbridge-connection';
