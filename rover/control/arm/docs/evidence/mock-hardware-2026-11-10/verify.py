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
bridge=None
try:
    bridge=start('bridge',['python3',os.environ.get('VERIFY_BRIDGE','/source/microcontroller/mock_hardware/usb_mock_bridge.py'),'--ros-args','-p','port:=/dev/ttyUSB0'])
    assert wait(lambda:'Set drivetrain serial_device' in (OUT/'bridge.log').read_text()),'Bridge failed to start'
    port=re.search(r'Set drivetrain serial_device to: (\S+)',(OUT/'bridge.log').read_text()).group(1)
    check('bridge startup',True,{'port':port,'usb':'/dev/ttyUSB0','baud':500000})
    with serial.Serial(port,38400,timeout=.5) as p:
        for id in range(1,5):
            trans(p,id,6,0x56,100+id)
            stored=trans(p,id,3,0x56,1);actual=trans(p,id,3,0x5f,1)
            check(f'drive {id} raw write/read',stored==actual==100+id,{'stored':stored,'actual':actual})
        spin(.65)
        for id in range(1,5):
            actual=trans(p,id,3,0x5f,1)
            check(f'drive {id} firmware watchdog',actual==0,{'actual_after_650ms':actual})
            trans(p,id,6,0x56,0)
    arm=start('arm',['ros2','launch','dcr_arm_driver','arm_control.launch.py'])
    assert wait(lambda:len(stat1)==6 and len(stat2)==6 and len(joint)==6,20),'Missing arm telemetry'
    check('all six arm feedback channels',healthy(),{'positions':joint.copy(),'temperatures':{i:m.temp for i,m in stat1.items()},'bus_volts':{i:m.busv for i,m in stat2.items()},'reason':state.reason if state else 'no status'})
    check('startup motion inhibited',state is not None and not state.estop_clear and state.motion_inhibited,{'reason':state.reason})
    ctl=n.create_client(ListControllers,'/controller_manager/list_controllers');assert ctl.wait_for_service(timeout_sec=10)
    cs=future(ctl.call_async(ListControllers.Request()))
    deadline=time.monotonic()+10
    while not all(any(c.name==name and c.state=='active' for c in cs.controller) for name in ['arm_controller','joint_state_broadcaster']) and time.monotonic()<deadline:
        spin(.2);cs=future(ctl.call_async(ListControllers.Request()))
    check('arm controllers active',all(any(c.name==name and c.state=='active' for c in cs.controller) for name in ['arm_controller','joint_state_broadcaster']),{c.name:c.state for c in cs.controller})
    estop.publish(Bool(data=False));spin(.5)
    assert action.wait_for_server(timeout_sec=10)
    priming=trajectory([0]*6,1);spin(.3)
    check('zero trajectory and rearm',priming.status==4 and priming.result.error_code==0,{'status':priming.status,'code':priming.result.error_code,'reason':state.reason,'controller_ready':state.controller_ready})
    outcome=trajectory([.1,.15,.2,.1,.15,.2],2);spin(.3)
    check('trajectory command capture',True,{i:[bytes(m.data[:m.dlc]).hex() for t,m in tx if m.id==i and m.dlc==5][-3:] for i in range(1,7)})
    err={name:abs(joint[name]-v) for name,v in zip(names,[.1,.15,.2,.1,.15,.2])}
    check('six-joint trajectory',outcome.status==4 and outcome.result.error_code==0 and max(err.values())<.02,{'status':outcome.status,'code':outcome.result.error_code,'positions_rad':joint.copy(),'max_error_rad':max(err.values()),'error':outcome.result.error_string})
    for id in range(1,7):command(id,1,10+id)
    spin(1)
    check('direct command capture',True,{i:[bytes(m.data[:m.dlc]).hex() for t,m in tx if m.id==i and m.dlc==5][-3:] for i in range(1,7)})
    check('six-joint direct position',all(abs(stat1[i].angle-(10+i))<.2 for i in range(1,7)),{i:m.angle for i,m in stat1.items()})
    command(1,2,3);spin(.3)
    check('direct speed',abs(stat1[1].speed-3)<.1,{'speed_rpm':stat1[1].speed})
    estop.publish(Bool(data=True));spin(.4)
    check('estop stops all joints',all(abs(m.speed)<.05 for m in stat1.values()) and not state.estop_clear and state.motion_inhibited,{i:m.speed for i,m in stat1.items()})
    estop.publish(Bool(data=False));spin(.4)
    check('estop clear does not resume direct speed',abs(stat1[1].speed)<.05 and state.motion_inhibited,{'speed_rpm':stat1[1].speed,'reason':state.reason})
    command(1,2,3);spin(.25)
    check('explicit direct rearm',abs(stat1[1].speed-3)<.1,{'speed_rpm':stat1[1].speed})
    os.kill(bridge.pid,signal.SIGSTOP);spin(.7)
    recent=[m for t,m in tx if t>time.monotonic()-.2 and m.dlc==5 and m.data[0] in (0xc1,0xc2)]
    check('feedback loss inhibits and commands zero',not state.feedback_fresh and state.motion_inhibited and len(recent)>20 and all(m.data[0]==0xc1 and bytes(m.data[1:5])==bytes(4) for m in recent),{'reason':state.reason,'command_count':len(recent)})
    os.kill(bridge.pid,signal.SIGCONT);assert wait(healthy,10);spin(.5)
    check('feedback recovery does not resume speed',abs(stat1[1].speed)<.05 and state.motion_inhibited,{'speed_rpm':stat1[1].speed,'reason':state.reason})
    diag=start('diagnostics',['ros2','launch','rover_drivetrain_control','diagnostics.launch.py','enable_readonly_probe:=true',f'serial_device:={port}','baud_rate:=38400','parity:=N','data_bits:=8','stop_bits:=1'])
    svc=n.create_client(ReadMotorDiagnostic,'/drivetrain_diagnostics/read_motor_diagnostic');assert svc.wait_for_service(timeout_sec=10)
    for id in range(1,5):
        vals=[]
        for selector in (1,2,3):
            reply=future(svc.call_async(ReadMotorDiagnostic.Request(bus='drivetrain',address=id,register_selector=selector)))
            vals.append({'success':reply.success,'value':reply.raw_value,'detail':reply.detail})
        check(f'drive {id} ROS diagnostics alongside arm',all(v['success'] for v in vals) and [v['value'] for v in vals]==[25,0,2400],vals)
    stop(diag)
    # Check stability at the default arm loop rate with the bridge running.
    spin(2)
    begin=time.monotonic();spin(10)
    hist=[x for x in status_history if x[0]>=begin]
    gaps={str(key):max((b-a for a,b in zip(ts,ts[1:])),default=0) for key,allts in rx_times.items() if (ts:=[t for t in allts if t>=begin])}
    check('steady arm feedback at 50 Hz',len(hist)>100 and all(fresh and safe for _,fresh,safe,_ in hist),{'status_samples':len(hist),'max_feedback_gap_s':max(gaps.values()),'per_channel_max_gap_s':gaps,'bad_samples':[x for x in hist if not (x[1] and x[2])]})
    config=yaml.safe_load(Path('/source/rover/control/drivetrain/rover_drivetrain_control/config/drivetrain_hardware.example.yaml').read_text());config['serial_device']=port
    (OUT/'drivetrain.yaml').write_text(yaml.safe_dump(config))
    drive=start('drivetrain',['ros2','launch','rover_drivetrain_control','drivetrain.launch.py',f'hardware_config:={OUT}/drivetrain.yaml'])
    spin(10)
    log=(OUT/'drivetrain.log').read_text()
    check('drivetrain activation gate', 'initialization sequence and velocity conversion are not implemented' in log,log[-6000:])
    stop(drive)
except Exception as error:
    check('integration harness completion',False,str(error));traceback.print_exc()
finally:
    if bridge and bridge.poll() is None:os.kill(bridge.pid,signal.SIGCONT)
    estop.publish(Bool(data=True));spin(.3)
    for p in reversed(processes):stop(p)
    (OUT/'results.json').write_text(json.dumps(results,indent=2))
    (OUT/'status-history.json').write_text(json.dumps(status_history))
    n.destroy_node();rclpy.shutdown()
    print(f"RESULT: {sum(r['passed'] for r in results)}/{len(results)} checks passed",flush=True)
