# 🚙 Deakin Rover 2027

Software and operator-interface development for the Deakin Competitive Robotics Club's 2027 rover.

The project is under active development. The current focus is a browser-based Mission Control interface alongside rover-side software and documentation.

## Operations deployment

The BaseStation PC is the operations appliance. It runs the GUI, ROSbridge,
MoveIt, ECAM services, and camera gateway. Driver, Arm, and ECAM PCs open a
browser only.

```powershell
cd basestation
copy .env.example .env
# Configure the Rover and BaseStation static LAN addresses.
docker compose -f docker-compose.yml up --build
```

Open `http://basestation.local/driver`, `/arm`, or `/ecam`. Use the documented
BaseStation fixed IP if `basestation.local` cannot be resolved.

## Local development

Create the shared camera network once:

```powershell
docker network create chasmata-local-media
```

Then run each stack in its own PowerShell terminal:

**Mock rover**

```powershell
cd rover/mock_rover
docker compose up --build
```

**Base station**

```powershell
cd basestation
docker compose -f docker-compose.local.yml up --build
```

**GUI**

```powershell
cd gui
npm start
```

## 🗂️ Repository layout

```text
gui/    Browser-based operator Mission Control interface
rover/  Rover-side software
  control/     Low-level hardware control and safety
  autonomous/  Navigation, perception, and task autonomy
  shared/      Shared rover-side interfaces and utilities
docs/   Project-wide documentation and competition references
```

## 🖥️ Operator GUI

The GUI is the browser-based Mission Control interface for rover operators. It provides a shared shell with dedicated Driver, Arm, and ECAM views, and is being developed alongside the rover-side control and autonomy software.

For GUI installation, development commands, architecture, and ROS integration details, see the [GUI README](gui/README.md).

## 🎛️ Control

## 🤖 Autonomy

## 📚 Project documentation

- [GUI documentation](gui/README.md)
- [Control documentation](rover/control/README.md)
- [Autonomy documentation](rover/autonomous/README.md)
- [Operator SOP (v0.1)](docs/operations/sop.md)
- [Operator QRH (v0.1)](docs/operations/qrh.md)

## 🚧 Status

The project is under active development. GUI, Control, and Autonomy interfaces are being developed in parallel, with rover integration and physical validation still required.
