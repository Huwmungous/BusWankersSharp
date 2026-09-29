BUS WANKERS LAUNCHER
====================

Opens the Glastonbury ticket page in EVERY browser installed on this computer
(Chrome, Edge, Firefox, Brave, Opera, Vivaldi, Safari...) at the sale time, on true
(NTP) time - not whatever this computer's clock thinks. Every browser is a separate
place in the queue.

The Launcher tab of the Bus Wankers page shows the exact command for your settings
(with a Copy button). The short version:

    BusWankersLauncher --url "https://glastonbury.seetickets.com/" --at 2026-10-01T09:00

--at is UK time. Try it first: it opens the ticket page 30 seconds from now.

    BusWankersLauncher --rehearse 30

Run --help for everything else, or --list to see which browsers it can find.


WINDOWS
-------
1. Unzip the download somewhere (Desktop is fine).
2. Open a Command Prompt or PowerShell in that folder and run the command above
   (BusWankersLauncher.exe ...). Or just double-click BusWankersLauncher.exe and
   answer the two questions.
3. Windows may say "Windows protected your PC" (the file is unsigned). Choose
   More info, then Run anyway.

MAC
---
1. Unzip the download.
2. Open Terminal in that folder and run, once:
       chmod +x BusWankersLauncher
       xattr -d com.apple.quarantine BusWankersLauncher
3. Then run:  ./BusWankersLauncher --url "..." --at 2026-10-01T09:00
   (Use the osx-arm64 download on an Apple silicon Mac, osx-x64 on an Intel one.)
4. The first time it opens each browser macOS may ask whether Terminal may control it.
   Allow it - and do this during the rehearsal, not on the day.

LINUX
-----
1. Unzip the download.
2. chmod +x BusWankersLauncher
3. ./BusWankersLauncher --url "..." --at 2026-10-01T09:00


ON THE DAY
----------
- Do a rehearsal first (--rehearse 30) and accept any cookie banner the ticket site
  shows in each browser, so there is nothing to click through on the day.
- Start it well before the sale (10 minutes is plenty) and leave its window open until
  you are through: on Linux and macOS, closing the terminal can close the browsers it
  started.
- It starts each browser about 45 seconds early on a blank page, so the real jump is a
  quick hand-off. Keep the computer awake and on mains power.
- Other computers, phones and tablets: use the launch link from the page's Launcher tab.
  On Android the page can open other browsers, but only when you tap - see the Launcher tab.
