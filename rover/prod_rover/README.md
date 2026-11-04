# Production rover

`prod_rover` owns the production Rover Control implementation. It has no
dependency on `mock_rover`.

```bash
ros2 run prod_rover rover_control
```

Its FMA acknowledgement remains the temporary development behavior until real
arm and drivetrain mode transitions are integrated.
