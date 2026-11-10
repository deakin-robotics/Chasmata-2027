# FROM dustynv/ros:jazzy-desktop-r36.4.0-cu128-24.04
FROM osrf/ros:jazzy-desktop-full

# Add ubuntu user with same UID and GID as your host system, if it doesn't already exist
# Since Ubuntu 24.04, a non-root user is created by default with the name vscode and UID=1000
ARG USERNAME=ubuntu
ARG USER_UID=1000
ARG USER_GID=$USER_UID
RUN if ! id -u $USER_UID >/dev/null 2>&1; then \
    groupadd --gid $USER_GID $USERNAME && \
    useradd -s /bin/bash --uid $USER_UID --gid $USER_GID -m $USERNAME; \
    fi
# Refresh expired ROS2 GPG key (key F42ED6FBAB17C654 expires in dustynv base images)
RUN sudo curl -sSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.asc \
    | sudo gpg --dearmor \
    | sudo tee /usr/share/keyrings/ros-archive-keyring.gpg > /dev/null
# Add sudo support for the non-root user
RUN apt-get update && \
    apt-get install -y sudo && \
    echo "$USERNAME ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/$USERNAME && \
    chmod 0440 /etc/sudoers.d/$USERNAME

# Switch from root to user
USER $USERNAME

# Add user to video group to allow access to webcam
RUN sudo usermod --append --groups video $USERNAME

# Update all packages
RUN sudo apt-get update && sudo apt-get upgrade -y

# Install Git
RUN sudo apt-get install -y git

# Rosdep update
RUN rosdep update

# Source the ROS setup file
# RUN echo "source /opt/ros/${ROS_DISTRO}/install/setup.bash" >> ~/.bashrc
RUN echo "source /opt/ros/${ROS_DISTRO}/setup.bash" >> ~/.bashrc

################################
## ADD ANY CUSTOM SETUP BELOW ##
################################
# Install additional ROS packages from source using dusty-nv's build helper.
# apt-get install ros-jazzy-* does not work in dustynv base images because

RUN sudo apt-get update && sudo apt-get install -y \
    ros-jazzy-ros2-control \
    ros-jazzy-ros2-controllers \
    ros-jazzy-joint-state-publisher \
    ros-jazzy-robot-state-publisher \
    ros-jazzy-xacro \
    ros-jazzy-rosbridge-server \
    ros-jazzy-image-transport \
    ros-jazzy-urdf-tutorial \
    ros-jazzy-moveit\
    libmodbus-dev \
    python3-pip \
    python3-numpy \
    python3-yaml \
    wireless-tools \
    net-tools \
    iputils-ping \
    psmisc \
    v4l-utils


# RUN echo "source /opt/ros/${ROS_DISTRO}/setup.bash" >> ~/.bashrc

ENV PIP_BREAK_SYSTEM_PACKAGES=1

RUN sudo python3 -m pip install minimalmodbus --index-url https://pypi.org/simple --break-system-packages
RUN sudo python3 -m pip install ikpy --index-url https://pypi.org/simple --break-system-packages