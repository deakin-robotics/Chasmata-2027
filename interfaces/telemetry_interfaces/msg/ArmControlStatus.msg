bool hardware_active
bool estop_clear
bool feedback_fresh
bool motor_status_safe
bool motion_inhibited
bool controller_ready
string reason
# Direct-control readiness and joint configuration, in matching array order.
bool direct_ready
string[] joint_names
uint32[] joint_can_ids
float64[] joint_max_velocity_rpm
uint64[] direct_request_ids
