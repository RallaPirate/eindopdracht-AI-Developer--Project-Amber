Initial prompt (to demonstrate working with plan mode)
------------------------------------------------------
Context:
This is the first prompt for a web-based application. Your objective is not to build the application itself, but to build the reusable desktop shell that all future functionality will live inside. Do not add visual elements, interactions, animations or functionality that are not explicitly requested in this prompt or the project rules.
Refer to the `.cursor/rules/` directory for architecture, coding standards and UI philosophy.
Refer to BOOT-SEQUENCE.md for the flow of our app. 

---
Objective:
Build a fake desktop shell within the browser that serves as the foundation of the BioReserve OS application. 
This shell is intended to remain in place throughout the remainder of the project. Future milestones will add functionality inside the existing architecture rather than replacing it. 

---
Implementation steps:
1. Create the boot sequence described in BOOT-SEQUENCE.md.
- the login screen is displayed on a black background, as a single dialog box with blue titlebar. It should not be perfectly centered, but slightly above centre (like an old dialog box). The titlebar will display ‘Authentication.exe’.  The close button ‘X’ in the top right corner needs to be greyed out and unclickable. In the window, we have a form with two input fields:
email and password, 
followed by a Google Oauth button. At the bottom of the window we have two buttons: 
Create User and Execute. 
Both buttons should look like a Windows 95/98 button.
Create User: The button should launch when clicked, or when the keys ALT+C are hit. This button won’t do anything yet.
Execute: The button should launch when clicked, or when the ALT+E keys are hit. This button continues the boot sequence defined in `BOOT-SEQUENCE.md` and proceeds to the desktop loading screen.
- the desktop loading screen will be `public\images\loading-screen.png` scaled to fill the screen. Overlay a dark green loading bar near the bottom of the viewport and animate it filling slowly.

2. Implement the desktop environment described below.  
The main page will look like an old mid-’90s operating system, inspired by Windows ‘95.  As background you can use `public\images\background-desktop.png`. Fit this to the screen size for desktops. Implement the desktop shell according to the project architecture defined in the Cursor rules.
The desktop will contain five icons. Use the corresponding image assets from `public\icons\`. The icons will be arranged from the top left corner downwards, in a grid, with four in the first column and one in the second column. The icons will be (in order): Reports.exe; Archive.exe; Species_Database.exe; Assistant.exe; Personnel.exe
-Each icon represents a future application. Create a separate placeholder application component for each one. For now, clicking them should just open empty windows. The windows should be movable and capable of overlapping each other. Bringing a window to the foreground when clicked is sufficient.
-The titlebars should contain the title of the corresponding program.
-Also I would like a button in the taskbar to appear while a window is opened: clicking this button will bring the window forwards again. The button should contain the title of the corresponding program.
-Opening the same icon multiple times should not create duplicate windows. 
-None of the windows contain real functionality yet. 


3. At the bottom of the screen we will have a taskbar. Again, inspired by Windows.
-A start menu to the left, to the right the language setting, a sound on/off toggle, and a date and time. 
- The start menu should open a fake start menu with the following options: Current user; Change user; Reboot. Change user should return to the login screen, while Reboot should start the entire BOOT-SEQUENCE again. 
- The language setting at the bottom right should open a small menu with the options ‘English’ and ‘Dutch (Nederlands)’.
- The time at the bottom right of the screen should display the user’s local time, and date, formatted like dd//mm//yyyy but the displayed year should always be rendered as 1993. So, we get dd//mm//1993. Do not modify the underlying Date object.

---

If anything is unclear, ask clarification before implementation. 

-------------------------------------------------------------------------

Cursor response: 

A few behaviors aren’t spelled out in the prompt or BOOT-SEQUENCE.md. Please confirm these so the plan matches what you want:

1. Login form (Authentication.exe)
Create User is a no-op. For this milestone, should email, password, and the Google OAuth button also be UI-only, with Execute always continuing to the desktop loading screen? Or should Execute require non-empty fields / real auth?

2. Taskbar extras
For Current user, language (EN/NL), and sound: UI shell only this milestone (language may store a preference with no translations; sound is visual toggle only)? And should Current user show a placeholder name (e.g. typed email or "Operator"), or do nothing when clicked?

3. Program windows
Should the title-bar X close a program and remove its taskbar button (reopen via icon), or stay disabled like the login dialog?

Reply with your choices and I’ll draft the implementation plan.

------------------------------------------------------------------------------------

My response: 

1. There should be no real authentication in this milestone. The email and password fields and the Google OAuth button are UI-only. Execute should always continue to the desktop loading screen.

2. Language may store the selected preference so it can be connected to translations later. Sound should be a visual toggle that stores a boolean so it can be connected to actual sounds later. Current user may display a placeholder name; use the entered email address when available, otherwise display “Operator”.

3. The title-bar X should close the program window and remove its taskbar button. The program can then be reopened from its desktop icon.

-------------------------------------------------------------------------------------

***Prompt Resulted in desktop_shell_foundation_00bc7780.plan.md to find in `.cursor/plans/` ***