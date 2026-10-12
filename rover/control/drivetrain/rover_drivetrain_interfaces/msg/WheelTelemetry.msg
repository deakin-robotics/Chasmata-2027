# Read-only log record for one wheel drive, for GUI display and logging.
# This is NOT a command. All motor commands go through ros2_control only.
#
# Every zero/default value means "unknown" or "not attempted", never success,
# so a field the publisher did not fill can never be read as a working motor.
# ROS defaults float fields to 0.0, which looks like a real speed: always check
# the matching *_valid flag before using any value.

# Direction values. Software meaning only; not BLD-305S control-word values.
uint8 DIRECTION_UNKNOWN=0
uint8 DIRECTION_STOPPED=1
uint8 DIRECTION_FORWARD=2
uint8 DIRECTION_REVERSE=3

# Outcome of the most recent wire exchange of one kind (read or write).
uint8 RESULT_NOT_ATTEMPTED=0   # nothing was sent
uint8 RESULT_ACKNOWLEDGED=1    # valid Modbus reply received; NOT proof the wheel moved
uint8 RESULT_FAILED=2          # sent, but no valid reply (see last_error_code)
uint8 RESULT_SKIPPED=3         # not sent: an earlier exchange this cycle failed (AD-14)
uint8 RESULT_REFUSED=4         # not sent: software gate refused it (e.g. not active)

# Communication health, counted per cycle (AD-15).
uint8 COMM_UNKNOWN=0
uint8 COMM_HEALTHY=1
uint8 COMM_DEGRADED=2
uint8 COMM_LOST=3

# --- Identity --------------------------------------------------------------
string joint_name              # empty if the publisher does not know the mapping
string bus                     # "left" or "right"
uint8 address                  # Modbus slave ID, 1..4

# --- Commanded: what ros2_control asked for. Logged here, never sent from here.
bool commanded_valid           # false: no command known; ignore the fields below
float64 commanded_speed_rad_s  # meaningless unless commanded_valid; publishers set NaN
uint8 commanded_direction      # DIRECTION_*
bool commanded_raw_valid       # false until speed scaling is verified (AD-23)
uint16 commanded_raw_speed     # raw value written to the drive's speed register

# --- Measured: read back from the drive. ------------------------------------
bool measured_speed_valid      # false until register and scaling are verified (AD-23)
float64 measured_speed_rad_s   # meaningless unless measured_speed_valid; publishers set NaN
uint8 measured_direction       # DIRECTION_*; UNKNOWN unless measured
bool measured_raw_speed_valid  # true only when the raw read below was acknowledged
uint16 measured_raw_speed      # raw actual-speed register (0x005F, provisional)
bool raw_fault_valid           # fault register is unknown today; stays false
uint16 raw_fault
bool raw_temperature_valid     # raw register counts, not SI units
uint16 raw_temperature
bool raw_current_valid
uint16 raw_current
bool raw_voltage_valid
uint16 raw_voltage

# --- Communication: what actually happened on the wire. --------------------
uint8 last_write_result        # RESULT_*
uint8 last_read_result         # RESULT_*
uint8 last_error_code          # Bld305sDriver::ErrorCode of the last failure; 0 = none
string detail                  # human-readable note for the log
uint8 comm_state               # COMM_*
uint32 consecutive_failed_cycles
