# Read-only drivetrain log snapshot for the GUI. Publication rate, topic name and
# publisher still need operator-interface sign-off.
builtin_interfaces/Time stamp
bool hardware_active           # true only while the ros2_control hardware is ACTIVE
WheelTelemetry[] wheels        # only wheels the publisher has real information about
