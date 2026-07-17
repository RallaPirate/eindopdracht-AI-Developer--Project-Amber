# BioReserve OS Boot Sequence

## Purpose

The boot sequence introduces BioReserve OS before user authentication.

Its purpose is to establish the atmosphere of a professional biological reserve workstation, communicate the fictional world, and transition naturally into the login screen.

The boot sequence should feel believable rather than cinematic.

---

## Startup flow

The application should follow this sequence when the website is opened.

Browser opens
↓

Pop-up for full-screen mode shows
↓

Boot sequence
↓

Login screen
↓

User authentication
↓

Desktop loading screen
↓

Desktop environment


Logging off should return directly to the login screen without replaying the boot sequence.

A reboot of the system should replay the complete boot sequence

---

## Visual style

- Use the `VT323` font throughout the boot sequence.
- Present the boot sequence on a black background.
- Use warm off-white text.
- Display lines sequentially to simulate a real '90s workstation boot process.
- Timing should feel authentic.
- The boot sequence may be skipped by user input (enter key or mouse click).

---

## Pop-up message

Display the following text in the pop-up:

```
BioReserve Systems

For the best workstation experience,
BioReserve OS is designed to run in fullscreen mode.

[ Enter Fullscreen ]
[ Continue Windowed ]
```

Selecting Enter Fullscreen should request browser fullscreen mode. Selecting Continue Windowed should immediately continue the startup sequence.
---

## Boot messages

Display the following text exactly.

```text
══════════════════════════════════════════════════════════════════════

                  BioReserve Systems
        Internal Operating Environment (IOE)

                     PROJECT: AMBER

             Authorisation Level: ████████████

══════════════════════════════════════════════════════════════════════

Initialising workstation hardware.......................OK
CPU: Intel 486DX2-66
Memory Test: 8192 KB....................................PASSED
Video Adapter: SVGA.....................................ONLINE

Loading operating environment...........................OK
Mounting local file system..............................OK
Loading device drivers..................................OK
Initialising network interface..........................OK

Connecting to corporate network.........................OK

AUTH-SRV-01.............................................ONLINE
ARCHIVE-01..............................................ONLINE
MAIL-SRV-01.............................................ONLINE
GENOME-SRV-02...........................................ONLINE

Connecting to Legacy Compute Cluster....................OK

CRAY-XMP-01.............................................ONLINE
CRAY-XMP-02.............................................ONLINE
CRAY-XMP-03.............................................ONLINE

Legacy Interface........................................READ ONLY

Loading Species Registry.................................OK
Loading Personnel Database..............................OK
Loading Veterinary Records..............................OK
Synchronising Observation Cameras.......................OK
Synchronising Enclosure Telemetry.......................OK
Checking Environmental Controls.........................OK
Checking Auxiliary Generators...........................OK
Checking Perimeter Fencing..............................OK

Access Main Program
Access Main Security
Access Main Security Grid

Security Grid...........................................ACTIVE
Fence Voltage...........................................STABLE
Perimeter Integrity.....................................CONFIRMED
Motion Detection Array..................................ONLINE

Loading BioReserve OS...........................OK
Loading desktop environment.............................OK



System Ready.
```

---

## Behaviour

The boot sequence is presentation only.

No simulated system check should affect application behaviour.

All messages are fictional world-building.

The boot sequence should complete before the login window becomes available.

---

## Out of scope

The boot sequence should not:

- perform real hardware checks;
- replay during user switching;
