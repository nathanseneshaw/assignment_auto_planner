# Assignment Auto-Planner - Blackboard Sync Extension

A Chrome extension that automatically syncs your Blackboard courses and assignments with the Assignment Auto-Planner app.

## Features

- **Automatic Detection**: Detects when you open Blackboard and syncs automatically
- **Background Sync**: Syncs periodically (every 15 minutes) when Blackboard is open
- **Smart Caching**: Avoids re-syncing if you've synced recently (within 30 minutes)
- **One-Click Import**: Automatically opens the app and imports your data
- **Last Synced Display**: Shows when data was last synced in both the extension and the app

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the `browser-extension` folder from this project
5. The extension icon will appear in your toolbar

## Usage

### Automatic Syncing (Recommended)

1. **Login to Blackboard** in your browser as normal
2. The extension will automatically detect Blackboard and start syncing
3. Look for the badge on the extension icon:
   - `...` = Currently syncing
   - `✓` = Sync complete (shown briefly)
4. Click the extension icon to view synced data and send to the app

### Manual Syncing

1. Navigate to any Blackboard page while logged in
2. Click the extension icon
3. Click **"Sync Now"** to refresh data
4. Click **"Send to Assignment Planner"** to import

### Context Menu

Right-click the extension icon for quick actions:
- **Sync Blackboard Now**: Force a new sync from any open Blackboard tab

## What Gets Synced

### Courses
- Course name and code
- Instructor name (when available)
- Term/semester
- Blackboard course ID

### Assignments
- Assignment title
- Description (if available)
- Due dates
- Attached images
- Assignment type

## Settings

Click the extension icon and expand **Settings** to configure:
- **App URL**: Where to send the data (default: `http://localhost:5173`)

## How It Works

1. The extension monitors your browser tabs for Blackboard URLs
2. When Blackboard is detected, it uses your existing login session to fetch data
3. Data is scraped from the DOM and via authenticated requests
4. Synced data is cached locally in the browser extension storage
5. When you click "Send to App", it opens the Assignment Planner and auto-imports

## Troubleshooting

### Extension not detecting Blackboard
- Make sure you're logged into Blackboard
- Try navigating to your Blackboard homepage
- Click "Sync Now" in the extension popup

### No courses found
- Ensure you're enrolled in courses for the current term
- Locked/unavailable courses are automatically skipped
- Check that your Blackboard session hasn't expired

### Data not importing to app
- Make sure the Assignment Auto-Planner app is running (`npm run dev`)
- Check the App URL in extension settings (default: `http://localhost:5173`)

### Badge shows "..." for too long
- The sync may be taking longer due to many courses
- Open the extension popup to see progress
- If stuck, try refreshing Blackboard and clicking "Sync Now"

## Privacy & Security

- Your Blackboard credentials are **never stored** by this extension
- The extension uses your existing browser session (cookies)
- All data stays local between your browser and the Assignment Planner app
- No data is sent to external servers

## Supported Blackboard Sites

This extension works with **any Blackboard instance**, including:

- Blackboard Learn (Classic and Ultra UI)
- Any school's hosted Blackboard (e.g., `learn.university.edu`, `elearning.school.edu`)
- Blackboard.com hosted instances

The extension automatically detects Blackboard pages by looking for common URL patterns and page elements, so it should work with your school's Blackboard without any configuration.
