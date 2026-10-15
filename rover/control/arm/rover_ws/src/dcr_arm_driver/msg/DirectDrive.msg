# Select the command source for one joint by its CAN ID.
uint8 CONTROLLER=0
uint8 POSITION=1
uint8 SPEED=2
uint32 id
uint8 mode
# POSITION: degrees; SPEED: RPM (CAN payload = value * 100).
# Speed magnitude is limited by that joint's configured max_velocity.
# Ignored for CONTROLLER.
float64 value
