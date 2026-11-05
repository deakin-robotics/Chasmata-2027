FROM ros:jazzy-ros-base

SHELL ["/bin/bash", "-c"]

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        python3-colcon-common-extensions \
        ros-jazzy-ament-cmake-gtest \
        ros-jazzy-control-msgs \
        ros-jazzy-controller-manager \
        ros-jazzy-controller-manager-msgs \
        ros-jazzy-diagnostic-updater \
        ros-jazzy-hardware-interface \
        ros-jazzy-joint-state-broadcaster \
        ros-jazzy-joint-trajectory-controller \
        ros-jazzy-launch-xml \
        ros-jazzy-rosbridge-server \
        ros-jazzy-rosidl-default-generators \
        ros-jazzy-robot-state-publisher \
        ros-jazzy-can-msgs \
        ros-jazzy-urdf \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY interfaces/telemetry_interfaces /workspace/src/telemetry_interfaces
COPY rover/shared/ecam_alerts /workspace/src/ecam_alerts
COPY rover/prod_rover /workspace/src/prod_rover
COPY rover/control/arm/rover_ws/src/arm_interfaces /workspace/src/arm_interfaces
COPY rover/control/arm/rover_ws/src/dcr_arm_driver /workspace/src/dcr_arm_driver
COPY rover/control/arm/rover_ws/src/nobleo_socketcan_bridge /workspace/src/nobleo_socketcan_bridge

RUN source /opt/ros/jazzy/setup.bash \
    && colcon build --symlink-install

ENTRYPOINT ["/bin/bash", "-lc"]
CMD ["source /opt/ros/jazzy/setup.bash && source /workspace/install/setup.bash && ros2 launch prod_rover rover.launch.xml"]
