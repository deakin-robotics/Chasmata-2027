# Rover bringup

`rover_bringup` owns the shared Rover Control node, Rover ECAM aggregation,
and ROSbridge. It is the supported Rover stack entry point.

```bash
ros2 launch rover_bringup rover.launch.xml mode:=dev
ros2 launch rover_bringup rover.launch.xml mode:=prod
```

`dev` also starts the mock rover. `prod` currently starts shared Rover services
only; its FMA acknowledgement remains the temporary development behavior until
real arm and drivetrain mode transitions are integrated.
