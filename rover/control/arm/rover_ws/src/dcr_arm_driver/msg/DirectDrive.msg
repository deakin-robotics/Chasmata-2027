# Select the command source for one joint by its CAN ID.
uint8 CONTROLLER=0
uint8 POSITION=1
uint8 SPEED=2
uint32 id
uint8 mode
# POSITION: degrees; SPEED: motor speed units (CAN payload = value * 100).
# Ignored for CONTROLLER.
float64 value
