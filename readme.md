# Custom Chrome Tab Extension

A minimal and productive new tab experience for Chrome users. This extension provides a clean dashboard with real-time clock, Google search integration, daily task management, quick access shortcuts, and customizable website tiles.

## Preview

<table>
  <tr>
    <td><img src="screenshots/theme1.png" alt="Full Preview 1" width="100%"></td>
    <td><img src="screenshots/theme2.png" alt="Full Preview 2" width="100%"></td>
  </tr>
  <tr>
    <td><img src="screenshots/theme3.png" alt="Full Preview 3" width="100%"></td>
    <td><img src="screenshots/theme4.png" alt="Full Preview 4" width="100%"></td>
  </tr>
</table>


## Features

- **Live Digital Clock** - Real-time clock with automatic date updates
- **Google Search Integration** - Search directly from the new tab page
- **Google Account Quick Links** - Dropdown showing all signed-in Google accounts with one-click access to Gmail, Drive, Meet, Docs, and Sheets
- **Custom Website Shortcuts** - Add personalized tiles with favicon support
- **Customizable Themes** - Choose from 20 background images with automatic light/dark text adaptation
- **Responsive Design** - Optimized for desktop and mobile devices

## Installation

### Option 1: Download ZIP

1. Click the **Code** button and select **Download ZIP**
2. Extract the downloaded file to a local directory
3. Open Chrome and navigate to `chrome://extensions/`
4. Enable **Developer mode** in the top-right corner
5. Click **Load unpacked** and select the extracted folder
6. Open a new tab to start using the extension

### Option 2: Clone Repository

```bash
git clone https://github.com/your-username/custom-chrome-tab.git
```

Follow steps 3-6 from Option 1 above.

## Using Mail Dropdown

Click the envelope icon in the top-right corner to open a dropdown showing all Google accounts signed into your browser. Each account shows quick links to:

- **Gmail** - Opens inbox for that account
- **Drive** - Opens Google Drive
- **Meet** - Opens Google Meet
- **Docs** - Opens Google Docs
- **Sheets** - Opens Google Sheets

Click "+ Add Gmail" at the bottom of the dropdown to sign in to an additional Google account.

## Development

### Project Structure

```
my_chrome_home/
├── background/
│   └── background.js
├── fonts/
├── icons/
├── screenshots/
├── tab/
│   ├── index.html
│   ├── utils.js
│   ├── scripts/
│   │   ├── clock.js
│   │   ├── mail.js
│   │   ├── search.js
│   │   ├── shortcuts.js
│   │   └── theme.js
│   └── styles/
│       ├── base.css
│       ├── clock.css
│       ├── layout.css
│       ├── mail.css
│       ├── modal.css
│       ├── search.css
│       ├── shortcuts.css
│       └── theme.css
├── manifest.json
└── readme.md
```

### Technology Stack

- **JavaScript**: Vanilla ES6+ with modular architecture
- **CSS**: Grid and Flexbox for responsive layouts
- **Storage**: LocalStorage for client-side data persistence
- **Chrome APIs**: Extension-specific functionality

### Contributing

We welcome contributions to improve the extension. Consider these enhancement areas:

- AI-powered shortcut suggestions
- Weather widget integration
- Cloud synchronization options
- Categorized shortcut organization

### Development Workflow

1. Fork the repository
2. Create a feature branch from main
3. Implement changes with appropriate testing
4. Submit a pull request with detailed description

## License

MIT License — Free for personal and commercial use. You may use, modify, and distribute this project without restriction. Attribution is appreciated but not required.