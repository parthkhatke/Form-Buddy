# Form Buddy Privacy Policy

Last updated: June 11, 2026

Form Buddy is a Chrome extension that fills web forms using details you save. This policy explains what data the extension handles and where it goes. The short version: everything stays in your browser.

## What Form Buddy stores

- **Profile details you enter** (first name, last name, email, phone, city) and any custom fields you create (a label, a value and matching keywords).
- **Per-site corrections.** When you correct or fill a field after an autofill, Form Buddy remembers that field's label and your value for that website, so the next visit fills correctly.
- **Usage history.** A list of the last 50 sites you filled, with a timestamp and field count, plus daily counters of fields and forms filled.

## Where the data lives

All data is stored locally in your browser using Chrome's `chrome.storage.local`. It never leaves your device.

- Form Buddy has **no server** and makes **zero network requests**.
- There is no account, no sign-in, no analytics, no tracking and no third-party code.
- Your data is never sold, shared or transmitted to anyone, including the developer.

## What Form Buddy never collects

- **Passwords.** Fields of type `password` are never filled, read or stored.
- **Payment details.** Credit card fields are never stored.
- **Browsing content.** The extension does not read or store page content beyond the form fields it fills, and per-site memory only records values you typed yourself.

## Permissions explained

| Permission | Why it is needed |
|---|---|
| `storage` | Save your profile, custom fields, per-site memory, history and stats locally |
| `activeTab` / host access | Find and fill form fields on the page you trigger autofill on |
| `scripting` | Reserved for injecting the fill engine where required |

## Data removal

- Clear a single site's memory from the History tab.
- Remove all data at any time by uninstalling the extension; Chrome deletes all locally stored extension data on uninstall.

## Export

You can export your profile to a JSON file on your own device and re-import it. That file is created locally and is under your control.

## Changes

If this policy changes, the updated version will be published at this same URL with a new date.

## Contact

Questions: open an issue at https://github.com/parthkhatke/Form-Buddy/issues
