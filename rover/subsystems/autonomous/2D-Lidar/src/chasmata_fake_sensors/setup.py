from setuptools import find_packages, setup

package_name = 'chasmata_fake_sensors'

setup(
    name=package_name,
    version='0.0.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='scar',
    maintainer_email='scar@todo.todo',
    description='TODO: Package description',
    license='TODO: License declaration',
    extras_require={
        'test': [
            'pytest',
        ],
    },
    entry_points={
        'console_scripts': [
            'fake_sensors     = chasmata_fake_sensors.fake_sensors:main',
            'obstacle_server  = chasmata_fake_sensors.obstacle_server:main',
        ],
    },
)
