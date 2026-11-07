# Known Issues

## CLI Issues
- CLI may not display properly initially due to punycode warning
- Some actions may result in infinite loading messages when failing
- Random undefined texts appearing in CLI selections

## CLI Role Management
- The CLI role commands call `/api/v1/auth/roles` and `/api/v1/auth/user/:id/roles` endpoints that the server does not implement yet

## Windows-Specific Issues
- When using PM2 to run the project, blank CMD screens might appear randomly
- This issue is specific to Windows environments and does not affect other operating systems

## Reporting Issues
If you encounter any of these issues or find new ones, please report them in our issue tracker.
We are actively working on resolving these problems for future releases.
