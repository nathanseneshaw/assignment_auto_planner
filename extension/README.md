# Assignment Planner Sync — Browser Extension

Loads Blackboard / Canvas session cookies from your active tab and sends them to the Assignment Planner backend so it can sync courses and assignments without launching its own browser.

## Sideload (Chrome / Edge / Brave)

1. Open `chrome://extensions`
2. Toggle **Developer mode** on (top right)
3. Click **Load unpacked**
4. Select this `extension/` folder
5. Pin the extension to your toolbar so the icon is visible

## Use

1. Open Blackboard or Canvas in a normal tab and log in.
2. Click the Assignment Planner Sync icon — popup says "Detected Blackboard" / "Detected Canvas".
3. Click **Sync this site**.
4. The app opens in a new tab with the imported session.

## Icons

Drop 16/32/48/128 px PNGs at `icons/icon-{16,32,48,128}.png` before sideloading. (Manifest references them; missing icons will only show a default puzzle piece.)
