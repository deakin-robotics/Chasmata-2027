import os, sys, time, signal, subprocess, json, re, struct, traceback
from pathlib import Path
from collections import defaultdict
import serial, rclpy, yaml
from rclpy.node import Node
from rclpy.action import ActionClient
from rclpy.qos import qos_profile_sensor_data
from can_msgs.msg import Frame
from arm_interfaces.msg import MotorStat1, MotorStat2
from sensor_msgs.msg import JointState
from telemetry_interfaces.msg import ArmControlStatus
from dcr_arm_driver.msg import DirectDrive
from std_msgs.msg import Bool
from control_msgs.action import FollowJointTrajectory
from trajectory_msgs.msg import JointTrajectoryPoint
from controller_manager_msgs.srv import ListControllers
from rover_drivetrain_interfaces.srv import ReadMotorDiagnostic

OUT=Path(os.environ.get('VERIFY_OUT','/tmp/evidence')); OUT.mkdir(exist_ok=True)
processes=[]; results=[]
def start(name,cmd):
    log=open(OUT/(name+'.log'),'w')
    p=subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    processes.append(p); return p

def stop(p):
    if p.poll() is None:
        os.killpg(p.pid,signal.SIGCONT); os.killpg(p.pid,signal.SIGINT)
        try:p.wait(timeout=8)
        except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGTERM); p.wait(timeout=5)

def check(name,ok,detail):
    row={'name':name,'passed':bool(ok),'detail':detail};results.append(row)
    print(json.dumps(row),flush=True)

def crc(b):
    c=65535
    for x in b:
        c^=x
        for _ in range(8):c=(c>>1)^(0xa001 if c&1 else 0)
    return struct.pack('<H',c)

def trans(p,id,fn,addr,val):
    req=struct.pack('>BBHH',id,fn,addr,val); req+=crc(req)
    p.write(req); res=p.read(8 if fn==6 else 7)
    assert res and crc(res)==b'\0\0',f'Bad/absent reply {res.hex()} to {req.hex()}'
    if fn==6:assert res==req; return val
    assert res[:3]==bytes([id,3,2]); return int.from_bytes(res[3:5],'big')

rclpy.init(); n=Node('mock_hardware_verification')
stat1={};stat2={};joint={};state=None;tx=[];rx_times=defaultdict(list);status_history=[]
def s1(m):stat1[m.id]=m
def s2(m):stat2[m.id]=m
def js(m):joint.update(zip(m.name,m.position))
def st(m):
    global state
    state=m; status_history.append((time.monotonic(),m.feedback_fresh,m.motor_status_safe,m.reason))
def rx(m):rx_times[(m.id,int(m.data[0]))].append(time.monotonic())
subs=[n.create_subscription(MotorStat1,'/motor_stat_1',s1,100),n.create_subscription(MotorStat2,'/motor_stat_2',s2,100),n.create_subscription(JointState,'/arm/joint_states',js,qos_profile_sensor_data),n.create_subscription(ArmControlStatus,'/arm/control/status',st,10),n.create_subscription(Frame,'/socketcan_bridge/tx',lambda m:tx.append((time.monotonic(),m)),1000),n.create_subscription(Frame,'/socketcan_bridge/rx',rx,1000)]
estop=n.create_publisher(Bool,'/estop',10); direct=n.create_publisher(DirectDrive,'/arm/direct_drive',10)
def spin(sec):
    end=time.monotonic()+sec
    while time.monotonic()<end:rclpy.spin_once(n,timeout_sec=min(.01,max(0,end-time.monotonic())))
def wait(pred,timeout=10):
    end=time.monotonic()+timeout
    while not pred() and time.monotonic()<end:spin(.02)
    return bool(pred())
def future(f,timeout=10):
    assert wait(f.done,timeout),'ROS request timed out'
    return f.result()
def command(id,mode,val):direct.publish(DirectDrive(id=id,mode=mode,value=float(val)));spin(.15)
def healthy():return state is not None and state.feedback_fresh and state.motor_status_safe
names=['base_joint','shoulder_joint','elbow_joint','yaw_joint','pitch_joint','roll_joint']
action=ActionClient(n,FollowJointTrajectory,'/arm_controller/follow_joint_trajectory')
def trajectory(values,duration=2):
    goal=FollowJointTrajectory.Goal();goal.trajectory.joint_names=names
    pt=JointTrajectoryPoint(positions=[float(v) for v in values]);pt.time_from_start.sec=duration
    goal.trajectory.points=[pt];goal.goal_time_tolerance.sec=2
    handle=future(action.send_goal_async(goal));assert handle.accepted,'Trajectory rejected'
    return future(handle.get_result_async(),duration+8)
from std_srvs.srv import Trigger
heartbeat_clear = True
heartbeat_enabled = True
held = {}
def tick():
    if heartbeat_enabled: estop.publish(Bool(data=not heartbeat_clear))
    for m in held.values(): direct.publish(m)
timer=n.create_timer(.05,tick)
rearm=n.create_client(Trigger,'/arm/rearm')
def arm_rearm():
    spin(.7)
    assert rearm.wait_for_service(timeout_sec=5)
    result=future(rearm.call_async(Trigger.Request()))
    assert result.success,result.message
    spin(.2)
bridge=None
try:
    bridge=start('bridge',['python3','/source/microcontroller/mock_hardware/usb_mock_bridge.py','--ros-args','-p','port:=/dev/ttyUSB0'])
    assert wait(lambda:'Set drivetrain serial_device' in (OUT/'bridge.log').read_text())
    # Enable only this simulator-specific copy. The checked-in URDF stays gated.
    src=Path('/source/rover/control/arm/rover_ws/src/dcr_arm_driver/urdf/robot_arm.urdf').read_text()
    (OUT/'mock.urdf').write_text(src.replace('<param name="motion_enabled">false','<param name="motion_enabled">true'))
    arm=start('arm',['ros2','launch','dcr_arm_driver','arm_control.launch.py',f'urdf:={OUT}/mock.urdf'])
    assert wait(lambda:len(joint)==6 and healthy(),20),'No healthy feedback'
    assert action.wait_for_server(timeout_sec=15)
    spin(1)
    check('startup latched',state.motion_inhibited,{'reason':state.reason})
    arm_rearm()
    result=trajectory([.1]*6,3);spin(.5)
    error=max(abs(joint[name]-.1) for name in names)
    check('six joint trajectory with tolerances',result.status==4 and error<.02,{'code':result.result.error_code,'error':error,'positions':joint.copy(),'reason':state.reason})
    held[1]=DirectDrive(id=1,mode=2,value=3.)
    spin(.6)
    check('streamed direct speed',abs(stat1[1].speed-3)<.1,{'speed':stat1[1].speed,'reason':state.reason})
    held.clear();spin(.65)
    check('operator silence stops and latches',state.motion_inhibited and abs(stat1[1].speed)<.05,{'reason':state.reason,'speed':stat1[1].speed})
    arm_rearm();held[1]=DirectDrive(id=1,mode=2,value=3.);spin(.4)
    heartbeat_clear=False;held.clear();spin(.4)
    check('estop stops',abs(stat1[1].speed)<.05 and state.motion_inhibited,{'speed':stat1[1].speed})
    heartbeat_clear=True;spin(.6)
    held[1]=DirectDrive(id=1,mode=2,value=3.);spin(.3)
    check('new command cannot clear latch',abs(stat1[1].speed)<.05,{'speed':stat1[1].speed})
    held.clear();arm_rearm()
    heartbeat_enabled=False;spin(.7)
    check('safety heartbeat loss stops',not state.estop_clear and state.motion_inhibited,{'reason':state.reason})
    heartbeat_enabled=True;arm_rearm()
    stop(bridge);spin(.7)
    check('CAN-like feedback loss latches',not state.feedback_fresh and state.motion_inhibited,{'reason':state.reason})
    bridge=start("bridge-reconnected",["python3","/source/microcontroller/mock_hardware/usb_mock_bridge.py","--ros-args","-p","port:=/dev/ttyUSB0"]);assert wait(healthy,15);spin(.5)
    check('reconnection remains latched',state.motion_inhibited and abs(stat1[1].speed)<.05,{'reason':state.reason})
    arm_rearm()
    # A fake frozen joint must not allow a goal to succeed. Explicit E-stop
    # holds all joints; action remains subject to configured goal/path limits.
    heartbeat_clear=False;spin(.2)
    result=trajectory([.5]*6,2)
    check('inhibited trajectory aborts',result.status==6 and result.result.error_code!=0,{'status':result.status,'code':result.result.error_code})
except Exception as error:
    check('completion',False,str(error));traceback.print_exc()
finally:
    heartbeat_clear=False;held.clear()
    if bridge and bridge.poll() is None:os.kill(bridge.pid,signal.SIGCONT)
    spin(.3)
    for p in reversed(processes):stop(p)
    (OUT/'results.json').write_text(json.dumps(results,indent=2))
    timer.cancel();n.destroy_node();rclpy.shutdown()
    sys.exit(0 if results and all(r['passed'] for r in results) else 1)
