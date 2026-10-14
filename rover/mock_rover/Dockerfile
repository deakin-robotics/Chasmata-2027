FROM ros:jazzy-ros-base

SHELL ["/bin/bash", "-c"]

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3-colcon-common-extensions \
        ros-jazzy-control-msgs \
        ros-jazzy-rosbridge-server \
        ros-jazzy-rosidl-default-generators \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY interfaces/telemetry_interfaces /workspace/src/telemetry_interfaces
COPY rover/shared/ecam_alerts /workspace/src/ecam_alerts
COPY rover/mock_rover/package.xml rover/mock_rover/setup.cfg rover/mock_rover/setup.py /workspace/src/mock_rover/
COPY rover/mock_rover/launch /workspace/src/mock_rover/launch
COPY rover/mock_rover/mock_rover /workspace/src/mock_rover/mock_rover
COPY rover/mock_rover/resource /workspace/src/mock_rover/resource

RUN source /opt/ros/jazzy/setup.bash \
    && colcon build --symlink-install

ENTRYPOINT ["/bin/bash", "-lc"]
CMD ["source /opt/ros/jazzy/setup.bash && source /workspace/install/setup.bash && ros2 launch mock_rover mock_rover.launch.py"]
