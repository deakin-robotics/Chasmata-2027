import { Service } from '@angular/core';

import { RosbridgeConnection } from './rosbridge-connection';

/** Owns the GUI's independent connection to the BaseStation ROSbridge. */
@Service()
export class BaseStationConnection extends RosbridgeConnection {}
