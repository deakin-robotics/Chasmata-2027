FROM ros:jazzy-ros-base

SHELL ["/bin/bash", "-c"]

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3-colcon-common-extensions \
        ros-jazzy-rosbridge-server \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY . /workspace/src/mock_rover

RUN source /opt/ros/jazzy/setup.bash \
    && colcon build --symlink-install

ENTRYPOINT ["/bin/bash", "-lc"]
CMD ["source /opt/ros/jazzy/setup.bash && source /workspace/install/setup.bash && ros2 launch mock_rover mock_rover.launch.py"]
