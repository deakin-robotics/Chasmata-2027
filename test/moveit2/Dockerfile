FROM ros:jazzy-ros-base

SHELL ["/bin/bash", "-c"]

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3-colcon-common-extensions \
        ros-jazzy-moveit \
        ros-jazzy-moveit-configs-utils \
        ros-jazzy-moveit-ros-planning-interface \
        ros-jazzy-robot-state-publisher \
        ros-jazzy-tf2-ros \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY test/moveit2/arm_moveit_config /workspace/src/arm_moveit_config
COPY test/moveit2/arm_moveit_demo /workspace/src/arm_moveit_demo
COPY test/moveit2/arm_moveit_bridge /workspace/src/arm_moveit_bridge

RUN source /opt/ros/jazzy/setup.bash \
    && colcon build --symlink-install

ENTRYPOINT ["/bin/bash", "-lc"]
CMD ["source /opt/ros/jazzy/setup.bash && source /workspace/install/setup.bash && ros2 launch arm_moveit_config moveit.launch.py"]
