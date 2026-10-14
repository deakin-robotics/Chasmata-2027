# Time at which this combined ECAM snapshot was created.
builtin_interfaces/Time timestamp
# Aggregator that created this snapshot.
string authority
# Latest complete alert-code snapshot from each reporting source.
telemetry_interfaces/EcamAlertSourceSnapshot[] sources
