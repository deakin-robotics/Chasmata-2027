FROM ros:jazzy-ros-base

SHELL ["/bin/bash", "-c"]

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        python3-colcon-common-extensions \
        ros-jazzy-hardware-interface ros-jazzy-pluginlib ros-jazzy-can-msgs ros-jazzy-urdf ros-jazzy-ament-cmake-gtest \
        ros-jazzy-control-msgs \
        ros-jazzy-controller-manager-msgs \
        ros-jazzy-launch-xml \
        ros-jazzy-rosbridge-server \
        ros-jazzy-rosidl-default-generators \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY interfaces/telemetry_interfaces /workspace/src/telemetry_interfaces
COPY rover/shared/ecam_alerts /workspace/src/ecam_alerts
COPY rover/control/arm/rover_ws/src/arm_interfaces /workspace/src/arm_interfaces
COPY rover/control/arm/rover_ws/src/dcr_arm_driver /workspace/src/dcr_arm_driver
COPY rover/rover /workspace/src/rover

RUN source /opt/ros/jazzy/setup.bash \
    && colcon build --symlink-install

ENTRYPOINT ["/bin/bash", "-lc"]
CMD ["source /opt/ros/jazzy/setup.bash && source /workspace/install/setup.bash && ros2 launch rover rover.launch.xml"]
