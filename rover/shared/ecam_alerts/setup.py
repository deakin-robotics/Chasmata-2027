from setuptools import find_packages, setup


package_name = 'ecam_alerts'

setup(
    name=package_name,
    version='0.1.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        (
            'share/ament_index/resource_index/packages',
            ['resource/' + package_name],
        ),
        ('share/' + package_name, ['package.xml']),
        (
            'share/' + package_name + '/launch',
            ['launch/ecam_alert_aggregator.launch.py'],
        ),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    entry_points={
        'console_scripts': [
            'ecam_alert_aggregator = ecam_alerts.aggregator:main',
        ],
    },
)
