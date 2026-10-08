# End effector command
# Maps directly to the EE CAN commands (CAN ID 0x07):
#   0xA0 -> speed control
#   0xA1 -> position control
#   0xA2 -> laser control

uint8 CMD_SPEED=0
uint8 CMD_POSITION=1
uint8 CMD_LASER=2

uint8 command
uint8 value
